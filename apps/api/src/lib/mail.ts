import { Resend } from "resend";
import { getSecret, getSettings, onSettingsChange } from "@/server/settings";

/** Rebuilt when an admin changes the key (Settings → Notifications); `.env` is the default. */
let resend: Resend | null = null;
let resendKey = "";
onSettingsChange(() => {
  const key = getSecret("resendApiKey");
  if (key === resendKey) return;
  resendKey = key;
  resend = key ? new Resend(key) : null;
});

export type Mail = { to: string; subject: string; html: string; text?: string };

export const mailEnabled = () => resend !== null;

/** Sends through Resend; without a key (local dev) the mail is printed instead. */
export async function sendMail(mail: Mail) {
  if (!resend) {
    console.info(`[mail] to=${mail.to} subject="${mail.subject}"\n${mail.text ?? mail.html}`);
    return;
  }
  const { error } = await resend.emails.send({ from: getSettings().mail.from, ...mail });
  if (error) console.error("[mail]", error);
}

/** Like `sendMail`, but reports failure (Settings → Notifications → Send test email). */
export async function sendMailOrThrow(mail: Mail) {
  if (!resend) throw new Error("No Resend API key set");
  const { error } = await resend.emails.send({ from: getSettings().mail.from, ...mail });
  if (error) throw new Error(error.message);
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
