import { ActivityHandling, GoogleGenAI, Modality, TurnCoverage } from "@google/genai";
import {
  CAPTION_LANGUAGES,
  type CaptionLang,
  otherCaptionLang,
} from "@app/shared/realtime-events";
import { Elysia, t } from "elysia";
import { env } from "@/env";
import { forbidden, tooManyRequests, upstreamError } from "@/lib/errors";
import { rateLimit } from "@/server/rate-limit";
import { callGlossary, isInLiveCall } from "@/websocket/calls";
import { authMacro } from "../plugins/auth";

const LANGS = Object.keys(CAPTION_LANGUAGES) as [CaptionLang, ...CaptionLang[]];

// sessions must be opened within a minute; a token itself lives 30 minutes (the browser rotates
// sessions well before that: Transcribe Live streams at most 10 minutes per session)
const NEW_SESSION_MS = 60_000;
const SESSION_MS = 30 * 60_000;

const genai = env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: env.GEMINI_API_KEY, httpOptions: { apiVersion: "v1alpha" } })
  : null;

// The browser marks utterances itself (activityStart/End). A new utterance must not interrupt
// the transcript or translation of the previous one.
const realtimeInputConfig = {
  automaticActivityDetection: { disabled: true },
  activityHandling: ActivityHandling.NO_INTERRUPTION,
  turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
};

function translateInstruction(to: CaptionLang, glossary: string[]) {
  const from = CAPTION_LANGUAGES[otherCaptionLang(to)];
  return [
    `You are a live interpreter in a meeting. Every message is a transcript in ${from}.`,
    `Translate it into ${CAPTION_LANGUAGES[to]} and say only the translation, nothing else:`,
    "no greetings, answers, comments or questions of your own, even if the message asks one.",
    ...(glossary.length ? [`Keep these terms unchanged: ${glossary.join(", ")}.`] : []),
  ].join(" ");
}

async function grant(model: string, config: Record<string, unknown>, uses: number) {
  const now = Date.now();
  const token = await genai!.authTokens.create({
    config: {
      uses,
      expireTime: new Date(now + SESSION_MS).toISOString(),
      newSessionExpireTime: new Date(now + NEW_SESSION_MS).toISOString(),
      liveConnectConstraints: { model, config },
      lockAdditionalFields: [],
    },
  });
  return { token: token.name!, model, config, uses, expiresAt: now + SESSION_MS };
}

/**
 * POST /api/calls/:callId/caption-tokens → two Gemini Live ephemeral tokens for a participant
 * who speaks and reads `lang`, each locked to one model and config:
 *   transcribe: our own microphone → text in `lang` (Transcribe Live, SMART, call glossary)
 *   translate:  other speakers' caption text (the other language of the pair) → text in `lang`
 * Audio and text go from the browser straight to Gemini, never through this process.
 */
export const captionsRoute = new Elysia({ name: "routes.captions" }).use(authMacro).post(
  "/api/calls/:callId/caption-tokens",
  async ({ params, body, user, set }) => {
    if (!genai) throw upstreamError("Live captions are not configured");
    if (!isInLiveCall(params.callId, user.id)) throw forbidden("Join the call to use captions");
    if (!rateLimit(`caption-tokens:${user.id}`, 20, 60_000))
      throw tooManyRequests("Too many caption sessions");

    const glossary = callGlossary(params.callId);
    try {
      const [transcribe, translate] = await Promise.all([
        grant(
          env.GEMINI_TRANSCRIBE_MODEL,
          {
            responseModalities: [Modality.TEXT],
            realtimeInputConfig,
            inputAudioTranscription: {
              // the speaker may switch to the other language of the pair
              languageCodes: [body.lang, otherCaptionLang(body.lang)],
              mode: "SMART",
              ...(glossary.length ? { customVocabulary: glossary } : {}),
            },
          },
          1,
        ),
        grant(
          env.GEMINI_TRANSLATE_MODEL,
          {
            // the Live model only answers with audio; the browser keeps only its transcript
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            systemInstruction: translateInstruction(body.lang, glossary),
          },
          1,
        ),
      ]);
      set.headers["cache-control"] = "private, no-store";
      return { data: { transcribe, translate } };
    } catch (err) {
      console.error("[captions] token", err);
      throw upstreamError("Could not start live captions");
    }
  },
  {
    auth: true,
    params: t.Object({ callId: t.String({ maxLength: 64 }) }),
    body: t.Object({ lang: t.UnionEnum(LANGS) }),
    detail: { tags: ["Calls"], summary: "Ephemeral Gemini Live tokens for call captions" },
  },
);
