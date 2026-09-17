import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  TextInput,
  ScrollView,
  Platform,
  AppState,
} from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import {
  createGame,
  roll,
  move,
  legalMoves,
  timeout,
  seatColor,
  type GameState,
  type Transition,
} from "../../packages/game-engine";
import { restoreGame } from "../../packages/game-engine/restore";
import { CUSTOM_RULES, STANDARD_RULES } from "../../packages/rulesets";
import { Board, COLORS } from "./components/Board";
const STORAGE = "ludo-platform:pass-play:v1";
function randomIndex(faces: number[]) {
  const max = Math.floor(256 / faces.length) * faces.length;
  let value: number;
  do {
    value = Crypto.getRandomBytes(1)[0];
  } while (value >= max);
  return value % faces.length;
}
function PlayerApp() {
  const { width, height } = useWindowDimensions(),
    insets = useSafeAreaInsets();
  const [state, setState] = useState<GameState | null>(null),
    stateRef = useRef<GameState | null>(null),
    busy = useRef(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [count, setCount] = useState(2),
    [custom, setCustom] = useState(true),
    [notice, setNotice] = useState("Roll a six to leave your yard."),
    [confirmNew, setConfirmNew] = useState(false);
  const [names, setNames] = useState([
    "You",
    "Player 2",
    "Player 3",
    "Player 4",
  ]);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<any[]>([]);
  const sessionRef = useRef("");
  const transcript = useRef<any[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(STORAGE)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw);
          const restored = restoreGame(saved.state);
          stateRef.current = restored;
          sessionRef.current = saved.id;
          transcript.current = saved.events || [];
          setState(restored);
          setNotice("Your local game has been restored.");
        }
      })
      .catch(() =>
        setError(
          "This saved game could not be restored. Start a new game to continue.",
        ),
      )
      .finally(() => setReady(true));
    AsyncStorage.getItem("ludo-platform:history:v1")
      .then((raw) => raw && setHistory(JSON.parse(raw)))
      .catch(() => {});
  }, []);
  const commit = async (result: Transition) => {
    const events = [
      ...transcript.current,
      ...result.events.map((event, i) => ({
        sequence: transcript.current.length + i + 1,
        event,
      })),
    ];
    await AsyncStorage.setItem(
      STORAGE,
      JSON.stringify({
        id: sessionRef.current,
        state: result.state,
        events,
        source: "PASS_PLAY",
      }),
    );
    transcript.current = events;
    stateRef.current = result.state;
    setState(result.state);
    const rolled = result.events.find((e) => e.type === "DICE_ROLLED");
    const killed = result.events.find((e) => e.type === "TOKEN_KILLED");
    setNotice(
      killed
        ? "Capture! Your opponent returns to their yard."
        : result.state.phase === "COMPLETED"
          ? "Game complete. Result saved on this device."
          : result.state.die
            ? `Rolled ${result.state.die}. Choose a highlighted token.`
            : result.events.some((e) => e.type === "BONUS_ROLL")
              ? "Bonus roll — your turn continues."
              : `${rolled ? `Rolled ${rolled.face}. No legal move. ` : ""}${result.state.players[result.state.activeSeat].id} to roll.`,
    );
    if (result.state.phase === "COMPLETED") {
      const record = {
        id: sessionRef.current,
        source: "PASS_PLAY",
        finishOrder: result.state.finishOrder,
        finishedAt: new Date().toISOString(),
      };
      const saved = JSON.parse(
        (await AsyncStorage.getItem("ludo-platform:history:v1")) || "[]",
      );
      const updated = [
        record,
        ...saved.filter((r: any) => r.id !== record.id),
      ].slice(0, 100);
      await AsyncStorage.setItem(
        "ludo-platform:history:v1",
        JSON.stringify(updated),
      );
      setHistory(updated);
    }
  };
  const act = async (action: "roll" | "move" | "timeout", token?: number) => {
    if (
      busy.current ||
      !stateRef.current ||
      stateRef.current.phase !== "PLAYING"
    )
      return;
    busy.current = true;
    setError("");
    try {
      const current = stateRef.current,
        time = Date.now();
      const result =
        action === "timeout"
          ? timeout(current, current.turnId, time)
          : action === "roll"
            ? roll(
                current,
                current.players[current.activeSeat].id,
                randomIndex,
                time,
              )
            : move(
                current,
                current.players[current.activeSeat].id,
                token!,
                time,
              );
      await commit(result);
    } catch (e: any) {
      setError(
        e.message === "TURN_EXPIRED"
          ? "Turn expired. Updating the board…"
          : "Could not save that action. Please retry.",
      );
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (
        stateRef.current?.phase === "PLAYING" &&
        time >= stateRef.current.deadline
      )
        void act("timeout");
    }, 500);
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") {
        setNow(Date.now());
        if (
          stateRef.current?.phase === "PLAYING" &&
          Date.now() >= stateRef.current.deadline
        )
          void act("timeout");
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready]);
  const start = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const chosen = names
        .slice(0, count)
        .map((n, i) => n.trim() || `Player ${i + 1}`);
      if (new Set(chosen).size !== chosen.length)
        throw new Error("Use a different name for each player.");
      const next = createGame(
        chosen,
        custom ? CUSTOM_RULES : STANDARD_RULES,
        Date.now(),
      );
      sessionRef.current = Crypto.randomUUID();
      transcript.current = [];
      await commit({
        state: next,
        events: [{ type: "MATCH_STARTED", source: "PASS_PLAY" }],
      });
      setConfirmNew(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      busy.current = false;
    }
  };
  const desktop = width >= 1050,
    size = Math.max(
      180,
      Math.min(
        desktop ? width - 620 : width - 32,
        height - insets.top - insets.bottom - 270,
        650,
      ),
    );
  const movable = state?.die ? legalMoves(state, state.die) : [],
    active = state?.players[state.activeSeat],
    color = state
      ? COLORS[seatColor(state.activeSeat, state.players.length)]
      : COLORS[0];
  return (
    <View
      style={[
        s.screen,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <StatusBar style="dark" />
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>LUDO PLATFORM</Text>
          <Text style={s.brand}>A little rivalry. A lot of play.</Text>
        </View>
        <View style={s.modeBadge}>
          <View style={s.dot} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New game or return to current game"
            onPress={() => state && setConfirmNew(true)}
            style={{ minHeight: 48, justifyContent: "center" }}
          >
            <Text style={s.modeText}>
              {state ? "New game" : "On this device"}
            </Text>
          </Pressable>
        </View>
      </View>
      {!ready ? (
        <Text style={s.subtitle}>Restoring your game…</Text>
      ) : !state || confirmNew ? (
        <ScrollView contentContainerStyle={s.setup}>
          <Text style={s.eyebrow}>PASS & PLAY</Text>
          <Text style={s.title}>Bring everyone{"\n"}to the board.</Text>
          <Text style={s.subtitle}>
            One device. Two to four players. Every move saved.
          </Text>
          <View style={s.row}>
            {[2, 3, 4].map((n) => (
              <Pressable
                key={n}
                onPress={() => setCount(n)}
                accessibilityRole="button"
                style={[s.choice, count === n && s.selected]}
              >
                <Text style={[s.choiceText, count === n && s.selectedText]}>
                  {n} players
                </Text>
              </Pressable>
            ))}
          </View>
          {names.slice(0, count).map((name, i) => (
            <TextInput
              key={i}
              accessibilityLabel={`Player ${i + 1} name`}
              value={name}
              maxLength={30}
              onChangeText={(value) =>
                setNames((previous) =>
                  previous.map((n, j) => (i === j ? value : n)),
                )
              }
              style={s.input}
            />
          ))}
          <Pressable
            onPress={() => setCustom(!custom)}
            accessibilityRole="switch"
            accessibilityState={{ checked: custom }}
            style={s.ruleCard}
          >
            <Text style={s.choiceText}>
              {custom ? "Custom filtered dice" : "Standard random dice"}
            </Text>
            <Text style={s.small}>
              {custom
                ? "No own-token stacking. After two sixes, the next roll excludes six. Outcomes are filtered, not a uniform die."
                : "Uniform six-sided dice. Exact home entry. Safe-cell protection."}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={start}
            style={s.primary}
          >
            <Text style={s.primaryText}>Start the game →</Text>
          </Pressable>
          {confirmNew && (
            <Pressable onPress={() => setConfirmNew(false)} style={s.choice}>
              <Text>Return to current game</Text>
            </Pressable>
          )}
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
          {history.length > 0 && (
            <Text style={s.small}>
              {history.length} completed{" "}
              {history.length === 1 ? "game" : "games"} saved on this device.
            </Text>
          )}
        </ScrollView>
      ) : (
        <View style={[s.gameLayout, desktop && s.desktop]}>
          {desktop && (
            <View style={s.side}>
              <Text style={s.eyebrow}>THE TABLE</Text>
              <Text style={s.title}>Good moves.{"\n"}Great company.</Text>
              <Text style={s.subtitle}>Play together, one turn at a time.</Text>
              <Text style={s.small}>
                Pass-and-Play results are saved locally. They do not affect a
                competitive global rating.
              </Text>
            </View>
          )}
          <View style={s.stage}>
            <View style={[s.seats, { width: size }]}>
              {state.players.map((player, seat) => (
                <View
                  key={player.id}
                  style={[
                    s.seat,
                    {
                      borderColor:
                        seat === state.activeSeat
                          ? COLORS[seatColor(seat, state.players.length)]
                          : "transparent",
                    },
                  ]}
                >
                  <View
                    style={[
                      s.seatIcon,
                      {
                        backgroundColor:
                          COLORS[seatColor(seat, state.players.length)],
                      },
                    ]}
                  >
                    <Text style={s.seatNumber}>{seat + 1}</Text>
                  </View>
                  <View style={{ flexShrink: 1 }}>
                    <Text numberOfLines={1} style={s.playerName}>
                      {player.id}
                    </Text>
                    <Text style={s.small}>
                      {player.tokens.filter((t) => t === 56).length}/4 home
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <Board
              state={state}
              size={size}
              movable={movable}
              onToken={(token) => void act("move", token)}
            />
            <View style={[s.controls, { width: Math.max(size, 280) }]}>
              <View style={s.turn}>
                <View>
                  <Text style={s.eyebrow}>
                    {state.phase === "COMPLETED"
                      ? "MATCH COMPLETE"
                      : "YOUR TURN"}
                  </Text>
                  <Text style={[s.current, { color }]}>
                    {state.phase === "COMPLETED"
                      ? `${state.finishOrder[0]} wins!`
                      : active?.id}
                  </Text>
                </View>
                {state.phase === "PLAYING" && (
                  <Text accessibilityLabel="Seconds remaining" style={s.timer}>
                    {Math.min(
                      state.rules.turnSeconds,
                      Math.max(0, Math.ceil((state.deadline - now) / 1000)),
                    )}
                    s
                  </Text>
                )}
              </View>
              {state.phase === "COMPLETED" ? (
                <Pressable
                  onPress={() => setConfirmNew(true)}
                  style={s.primary}
                >
                  <Text style={s.primaryText}>Play again →</Text>
                </Pressable>
              ) : (
                <View style={s.row}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      state.die ? `Rolled ${state.die}` : "Roll dice"
                    }
                    disabled={state.die !== null}
                    onPress={() => void act("roll")}
                    style={[
                      s.die,
                      { backgroundColor: state.die ? "#E4EAE4" : "#203E35" },
                    ]}
                  >
                    <Text
                      style={[
                        s.dieText,
                        { color: state.die ? "#203E35" : "white" },
                      ]}
                    >
                      {state.die || "⚄"}
                    </Text>
                    <Text
                      style={{
                        color: state.die ? "#203E35" : "white",
                        fontSize: 12,
                        fontWeight: "600",
                      }}
                    >
                      {state.die ? "Rolled" : "Roll dice"}
                    </Text>
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={s.small}>
                      {state.die
                        ? "Choose your token"
                        : "Roll, then choose a token."}
                    </Text>
                    <View style={s.row}>
                      {[0, 1, 2, 3].map((token) => (
                        <Pressable
                          key={token}
                          accessibilityRole="button"
                          accessibilityLabel={`Move token ${token + 1}`}
                          disabled={!movable.includes(token)}
                          onPress={() => void act("move", token)}
                          style={[
                            s.tokenChoice,
                            {
                              backgroundColor: movable.includes(token)
                                ? color
                                : "#ECEEE8",
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontSize: 18,
                              fontWeight: "700",
                              color: movable.includes(token)
                                ? "#FFF"
                                : "#929A94",
                            }}
                          >
                            {token + 1}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>
              )}
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={2}
                style={s.notice}
              >
                {error || notice}
              </Text>
            </View>
          </View>
          {desktop && (
            <View style={s.side}>
              <Text style={s.eyebrow}>MATCH DETAILS</Text>
              <Text style={s.sectionTitle}>A fair place to play.</Text>
              <Text style={s.subtitle}>
                {state.rules.dicePolicy === "CUSTOM_FILTERED"
                  ? "Custom filtered dice"
                  : "Standard random dice"}
              </Text>
              <Text style={s.small}>
                Exact roll to reach home. Safe cells protect tokens from
                capture. Turn limit: {state.rules.turnSeconds} seconds.
              </Text>
              <Pressable onPress={() => setConfirmNew(true)} style={s.choice}>
                <Text>New game</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <PlayerApp />
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F3EC" },
  header: {
    height: 72,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#DFE3D9",
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#63766B",
  },
  brand: { fontSize: 14, fontWeight: "600", color: "#203E35", marginTop: 5 },
  modeBadge: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#2A8A66" },
  modeText: { fontSize: 11, color: "#63766B" },
  setup: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 24,
    gap: 16,
  },
  title: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "700",
    color: "#203E35",
    letterSpacing: -1,
  },
  subtitle: { fontSize: 15, lineHeight: 24, color: "#69776C" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  choice: {
    padding: 15,
    borderWidth: 1,
    borderColor: "#CDD6C8",
    borderRadius: 12,
    alignItems: "center",
  },
  selected: { backgroundColor: "#203E35", borderColor: "#203E35" },
  choiceText: { fontSize: 14, fontWeight: "600", color: "#203E35" },
  selectedText: { color: "#FFF" },
  input: {
    backgroundColor: "#FFFEFA",
    borderWidth: 1,
    borderColor: "#D4DBCF",
    borderRadius: 12,
    padding: 15,
    fontSize: 16,
    color: "#203E35",
  },
  ruleCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#E7EBDD",
    gap: 8,
  },
  primary: {
    backgroundColor: "#203E35",
    padding: 17,
    borderRadius: 14,
    alignItems: "center",
  },
  primaryText: { color: "#FFF", fontWeight: "700", fontSize: 16 },
  small: { fontSize: 11, lineHeight: 17, color: "#6E7C71" },
  error: { color: "#A03535", fontSize: 13 },
  gameLayout: { flex: 1, alignItems: "center", justifyContent: "center" },
  desktop: { flexDirection: "row", gap: 32, paddingHorizontal: 30 },
  side: { width: 230, gap: 22 },
  stage: { alignItems: "center", gap: 8 },
  seats: {
    flexDirection: "row",
    gap: 4,
    justifyContent: "space-between",
    marginBottom: 2,
  },
  seat: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    padding: 5,
    borderWidth: 1.5,
    borderRadius: 12,
  },
  seatIcon: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  seatNumber: { fontSize: 12, fontWeight: "800", color: "#FFF" },
  playerName: { fontSize: 11, fontWeight: "700", color: "#203E35" },
  controls: { gap: 8, paddingHorizontal: 4 },
  turn: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  current: { fontSize: 20, fontWeight: "700", marginTop: 2 },
  timer: {
    fontSize: 20,
    fontWeight: "700",
    color: "#203E35",
    fontVariant: ["tabular-nums"],
  },
  die: {
    width: 92,
    height: 76,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  dieText: { fontSize: 31, fontWeight: "700" },
  tokenChoice: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { fontSize: 11, lineHeight: 16, color: "#63766B", height: 32 },
  sectionTitle: { fontSize: 22, fontWeight: "600", color: "#203E35" },
});
