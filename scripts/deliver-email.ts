import "dotenv/config";
import nodemailer from "nodemailer";
import { createDatabase } from "../packages/database";
import { deliverOne } from "../packages/notifications/outbox";
if (
  !process.env.PLATFORM_DATABASE_URL ||
  !process.env.SMTP_URL ||
  !process.env.MAIL_FROM ||
  !process.env.APP_URL
)
  throw new Error(
    "Configure database, SMTP_URL, MAIL_FROM and APP_URL before running email delivery",
  );
const db = createDatabase(process.env.PLATFORM_DATABASE_URL),
  smtp = nodemailer.createTransport(process.env.SMTP_URL);
try {
  await deliverOne(
    db,
    {
      send: async (message) => {
        await smtp.sendMail({
          from: process.env.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
      },
    },
    process.env.APP_URL,
  );
} finally {
  await db.end();
  smtp.close();
}
