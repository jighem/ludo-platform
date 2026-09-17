import { ResultService } from "../../packages/results";
import { MatchService } from "../../packages/match-engine";
import { LeagueService } from "../../packages/league-engine";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { AuthService, type Identity } from "../../packages/auth/service";
import { DomainError } from "../../packages/auth/passwords";
import { enforceRate } from "../../packages/auth/rate-limit";
import { type Database } from "../../packages/database";
export interface AuthRequest extends Request {
  identity?: Identity;
  sessionToken?: string;
}
export const asyncRoute =
  (fn: (req: AuthRequest, res: Response) => Promise<unknown>) =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
export function createApp(db: Database, appUrl: string) {
  const app = express(),
    auth = new AuthService(db),
    origin = new URL(appUrl).origin;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const requestOrigin = req.get("origin");
      if (
        (requestOrigin && requestOrigin !== origin) ||
        (!requestOrigin && req.cookies?.ludo_session)
      )
        return res.status(403).json({ error: "ORIGIN_REJECTED" });
    }
    next();
  });
  // Explicit next() wrapper: async route handlers own responses, middleware must advance.
  const authenticated = (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    req.sessionToken =
      req.get("authorization")?.replace(/^Bearer /, "") ||
      req.cookies?.ludo_session ||
      "";
    auth
      .authenticate(req.sessionToken!)
      .then((user) => {
        req.identity = user;
        next();
      })
      .catch(next);
  };
  const limited =
    (limit: number) => (req: Request, res: Response, next: NextFunction) => {
      enforceRate(db, `auth:${req.path}:${req.ip}`, limit, 900)
        .then(() => next())
        .catch(next);
    };
  app.get(
    "/api/v2/health",
    asyncRoute(async (_req, res) => {
      await db.query("SELECT 1");
      res.json({ status: "ok" });
    }),
  );
  app.post(
    "/api/v2/auth/register",
    limited(10),
    asyncRoute(async (req, res) => {
      res.status(201).json(await auth.register(req.body));
    }),
  );
  app.post(
    "/api/v2/auth/login",
    limited(30),
    asyncRoute(async (req, res) => {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";
      await enforceRate(db, `login:email:${email}`, 15, 900);
      const result = await auth.login(req.body?.email, req.body?.password);
      res.cookie("ludo_session", result.token, {
        httpOnly: true,
        secure: origin.startsWith("https:"),
        sameSite: "strict",
        maxAge: 7 * 86400000,
        path: "/",
      });
      res.json({
        user: result.user,
        ...(req.body?.client === "native" ? { token: result.token } : {}),
      });
    }),
  );
  app.get(
    "/api/v2/auth/me",
    authenticated,
    asyncRoute(async (req, res) => {
      const [profiles] = await db.query<any[]>(
        "SELECT player_id,display_name,avatar_url FROM user_profiles WHERE user_id=?",
        [req.identity!.id],
      );
      res.json({ user: req.identity, profile: profiles[0] });
    }),
  );
  app.post(
    "/api/v2/auth/logout",
    authenticated,
    asyncRoute(async (req, res) => {
      await auth.logout(req.sessionToken!);
      res.clearCookie("ludo_session", { path: "/" });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/v2/auth/verify",
    limited(30),
    asyncRoute(async (req, res) => {
      await auth.consumeToken(req.body?.token, "VERIFY_EMAIL");
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/v2/auth/resend-verification",
    authenticated,
    limited(5),
    asyncRoute(async (req, res) => {
      await auth.resendVerification(req.identity!);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/v2/auth/forgot-password",
    limited(10),
    asyncRoute(async (req, res) => {
      await auth.requestRecovery(req.body?.email);
      res.json({
        message: "If the account exists, a recovery email will be sent.",
      });
    }),
  );
  app.post(
    "/api/v2/auth/reset-password",
    limited(15),
    asyncRoute(async (req, res) => {
      await auth.consumeToken(
        req.body?.token,
        "RESET_PASSWORD",
        req.body?.password,
      );
      res.json({ ok: true });
    }),
  );
  const leagues = new LeagueService(db);
  app.get(
    "/api/v2/leagues",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json({ leagues: await leagues.list(req.identity!.id) }),
    ),
  );
  app.post(
    "/api/v2/leagues",
    authenticated,
    asyncRoute(async (req, res) =>
      res
        .status(201)
        .json(
          await leagues.create(
            req.identity!.id,
            req.body?.name,
            req.body?.visibility,
          ),
        ),
    ),
  );
  app.post(
    "/api/v2/invitations/accept",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json(await leagues.accept(req.identity!.id, req.body?.code)),
    ),
  );
  app.get(
    "/api/v2/leagues/:leagueId/members",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json({
        members: await leagues.members(req.identity!.id, req.params.leagueId),
      }),
    ),
  );
  app.post(
    "/api/v2/leagues/:leagueId/invitations",
    authenticated,
    asyncRoute(async (req, res) => {
      const invitee = req.body?.userId;
      if (
        invitee !== undefined &&
        (typeof invitee !== "string" || invitee.length !== 36)
      )
        throw new DomainError("INVALID_INVITEE");
      res
        .status(201)
        .json(
          await leagues.invite(
            req.identity!.id,
            req.params.leagueId,
            invitee ?? null,
          ),
        );
    }),
  );
  app.post(
    "/api/v2/leagues/:leagueId/join-requests",
    authenticated,
    asyncRoute(async (req, res) => {
      await leagues.requestJoin(req.identity!.id, req.params.leagueId);
      res.status(201).json({ ok: true });
    }),
  );
  app.post(
    "/api/v2/leagues/:leagueId/join-requests/:userId/decision",
    authenticated,
    asyncRoute(async (req, res) => {
      await leagues.decideJoin(
        req.identity!.id,
        req.params.leagueId,
        req.params.userId,
        req.body?.approved,
      );
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/v2/leagues/:leagueId/members/:userId",
    authenticated,
    asyncRoute(async (req, res) => {
      await leagues.setMember(
        req.identity!.id,
        req.params.leagueId,
        req.params.userId,
        req.body?.role,
        req.body?.status,
      );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/v2/leagues/:leagueId/scoring",
    authenticated,
    asyncRoute(async (req, res) => {
      await leagues.configureScoring(
        req.identity!.id,
        req.params.leagueId,
        req.body,
      );
      res.status(201).json({ ok: true });
    }),
  );
  const matches = new MatchService(db);
  app.post(
    "/api/v2/matches",
    authenticated,
    asyncRoute(async (req, res) => {
      if (
        req.body?.leagueId !== undefined &&
        typeof req.body.leagueId !== "string"
      )
        throw new DomainError("INVALID_LEAGUE");
      res
        .status(201)
        .json(
          await matches.create(
            req.identity!.id,
            req.body?.players,
            req.body?.rulesetVersionId,
            req.body?.leagueId,
          ),
        );
    }),
  );
  app.get(
    "/api/v2/matches/:matchId",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json(
        await matches.snapshot(
          req.identity!.id,
          req.params.matchId,
          Number(req.query.after ?? 0),
        ),
      ),
    ),
  );
  app.post(
    "/api/v2/matches/:matchId/check-in",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json(await matches.checkIn(req.identity!.id, req.params.matchId)),
    ),
  );
  app.post(
    "/api/v2/matches/:matchId/commands",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json(
        await matches.command(req.identity!.id, req.params.matchId, req.body),
      ),
    ),
  );
  const results = new ResultService(db);
  app.get(
    "/api/v2/leagues/:leagueId/standings",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json({
        standings: await results.standings(
          req.identity!.id,
          req.params.leagueId,
        ),
      }),
    ),
  );
  app.post(
    "/api/v2/leagues/:leagueId/manual-results",
    authenticated,
    asyncRoute(async (req, res) => {
      if (typeof req.body?.rulesetVersionId !== "string")
        throw new DomainError("INVALID_RULESET");
      res
        .status(201)
        .json(
          await results.manual(
            req.identity!.id,
            req.params.leagueId,
            req.body.rulesetVersionId,
            req.body?.placements,
            req.body?.reason,
          ),
        );
    }),
  );
  app.get(
    "/api/v2/leagues/:leagueId/results/:matchId/history",
    authenticated,
    asyncRoute(async (req, res) =>
      res.json({
        history: await results.history(
          req.identity!.id,
          req.params.leagueId,
          req.params.matchId,
        ),
      }),
    ),
  );
  app.post(
    "/api/v2/leagues/:leagueId/results/:matchId/revisions",
    authenticated,
    asyncRoute(async (req, res) =>
      res
        .status(201)
        .json(
          await results.revise(
            req.identity!.id,
            req.params.leagueId,
            req.params.matchId,
            req.body?.expectedRevision,
            req.body?.approval,
            req.body?.reason,
            req.body?.placements,
          ),
        ),
    ),
  );
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      error instanceof DomainError
        ? error.status
        : error.type === "entity.too.large"
          ? 413
          : error instanceof SyntaxError
            ? 400
            : 500;
    res.status(status).json({
      error:
        error instanceof DomainError
          ? error.code
          : status === 500
            ? "INTERNAL_ERROR"
            : "INVALID_REQUEST",
    });
  });
  return app;
}
