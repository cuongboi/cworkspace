import { Resend } from "resend";
import { env } from "@/env";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export type Mail = { to: string; subject: string; html: string; text?: string };

/** Sends through Resend; without `RESEND_API_KEY` (local dev) the mail is printed instead. */
export async function sendMail(mail: Mail) {
  if (!resend) {
    console.info(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text ?? mail.html}`);
    return;
  }
  const { error } = await resend.emails.send({ from: env.MAIL_FROM, ...mail });
  if (error) console.error("[mail]", error);
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
