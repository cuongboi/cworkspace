import { ActivityHandling, GoogleGenAI, Modality, TurnCoverage } from "@google/genai";
import {
  CAPTION_LANGUAGES,
  type CaptionLang,
  MAX_MESH_PARTICIPANTS,
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
/** one translate session per other speaker in the call */
const TRANSLATE_USES = MAX_MESH_PARTICIPANTS - 1;

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
 *   translate:  another speaker's audio → text in `lang` (Live Translate, source auto-detected;
 *               one use per other speaker)
 * Audio goes from the browser straight to Gemini, never through this process.
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
              languageCodes: [body.lang],
              mode: "SMART",
              ...(glossary.length ? { customVocabulary: glossary } : {}),
            },
          },
          1,
        ),
        grant(
          env.GEMINI_TRANSLATE_MODEL,
          {
            // Live Translate always speaks the translation; the browser keeps only its transcript
            responseModalities: [Modality.AUDIO],
            realtimeInputConfig,
            translationConfig: { targetLanguageCode: body.lang, echoTargetLanguage: false },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          TRANSLATE_USES,
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
