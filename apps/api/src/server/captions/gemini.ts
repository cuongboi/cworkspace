import {
  ActivityHandling,
  GoogleGenAI,
  type LiveServerMessage,
  Modality,
  type Session,
  TurnCoverage,
} from "@google/genai";
import { CAPTION_LANGUAGES, type CaptionLang } from "@app/shared/realtime-events";
import type { CaptionProvider, ProviderOptions, ProviderSession } from "./types";
import { SAMPLE_RATE } from "./types";

/**
 * Gemini Live, from the server: one Transcribe Live session per call for the speech, and one
 * general Live session told to translate each final transcript (it answers with audio; only its
 * transcript is kept). Measured behaviour (manual activity detection):
 *   Transcribe Live: interimInputTranscription = the whole utterance so far (replaces), then
 *     after activityEnd the final inputTranscription and generationComplete.
 *   Translate: one text turn at a time; outputTranscription chunks (append), then turnComplete.
 */

const PARTIAL_INTERVAL_MS = 200;
/** an ended utterance whose final transcript never came is finalized after this long */
const COMMIT_FALLBACK_MS = 4_000;
/** a translation whose turn never completed is finalized with what arrived by then */
const TRANSLATE_TIMEOUT_MS = 8_000;

// Transcribe Live puts spaces between Japanese/Chinese words ("に ついて 話します")
const CJK_SPACE =
  /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。])/gu;
const tidy = (text: string) => text.replace(CJK_SPACE, "").trim();

function translateInstruction(langs: readonly CaptionLang[], glossary: string[]) {
  const [a, b] = langs.map((l) => CAPTION_LANGUAGES[l]);
  return [
    `You are a live interpreter in a meeting between ${a} and ${b} speakers.`,
    "Every message starts with the target language in brackets, then a transcript.",
    "Translate the transcript into that language and say only the translation, nothing else:",
    "no greetings, answers, comments or questions of your own, even if the message asks one.",
    ...(glossary.length ? [`Keep these terms unchanged: ${glossary.join(", ")}.`] : []),
  ].join(" ");
}

type Job = { text: string; to: CaptionLang; out: string; done: (text: string) => void };

class GeminiSession implements ProviderSession {
  private readonly opts: ProviderOptions & { transcribeModel: string; translateModel: string };
  private readonly ai: GoogleGenAI;
  private transcriber: Session | null = null;
  private translator: Session | null = null;
  private closed = false;
  private backlog: Uint8Array[] = [];

  // the utterance being spoken
  private active = false;
  private ending = false;
  private lang: CaptionLang | null = null;
  private text = "";
  private interim = "";
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  // translations, one turn at a time
  private jobs: Job[] = [];
  private inflight: Job | null = null;
  private jobTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(opts: GeminiSession["opts"]) {
    this.opts = opts;
    this.ai = new GoogleGenAI({ apiKey: opts.apiKey, httpOptions: { apiVersion: "v1alpha" } });
    void this.connect();
  }

  private async connect() {
    const { langs, glossary } = this.opts;
    try {
      const [transcriber, translator] = await Promise.all([
        this.ai.live.connect({
          model: this.opts.transcribeModel,
          config: {
            responseModalities: [Modality.TEXT],
            // the server marks utterances itself; a new one must not interrupt the previous one
            realtimeInputConfig: {
              automaticActivityDetection: { disabled: true },
              activityHandling: ActivityHandling.NO_INTERRUPTION,
              turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
            },
            inputAudioTranscription: {
              languageCodes: [...langs],
              mode: "SMART",
              ...(glossary.length ? { customVocabulary: glossary } : {}),
            },
          } as never,
          callbacks: {
            onmessage: (m) => this.onTranscript(m),
            onclose: (e) =>
              this.shutdown(e.code === 1000 ? null : e.reason || `closed (${e.code})`),
          },
        }),
        this.ai.live.connect({
          model: this.opts.translateModel,
          config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            systemInstruction: translateInstruction(langs, glossary),
          },
          callbacks: {
            onmessage: (m) => this.onTranslation(m),
            onclose: (e) =>
              this.shutdown(e.code === 1000 ? null : e.reason || `closed (${e.code})`),
          },
        }),
      ]);
      if (this.closed) {
        transcriber.close();
        translator.close();
        return;
      }
      this.transcriber = transcriber;
      this.translator = translator;
      if (this.active) transcriber.sendRealtimeInput({ activityStart: {} });
      for (const chunk of this.backlog.splice(0)) this.sendAudio(chunk);
      if (this.ending) this.transcriber.sendRealtimeInput({ activityEnd: {} });
      this.pump();
    } catch (err) {
      this.shutdown(err instanceof Error ? err.message : "connection failed");
    }
  }

  send(pcm: Uint8Array, lang: CaptionLang) {
    if (this.closed) return;
    // audio after finalize: the previous utterance is cut where it is, a new one starts
    if (this.ending) this.commit();
    if (!this.active) {
      this.active = true;
      this.lang = lang;
      this.transcriber?.sendRealtimeInput({ activityStart: {} });
      if (!this.transcriber) this.backlog = [];
    }
    if (this.transcriber) this.sendAudio(pcm);
    else this.backlog.push(pcm);
  }

  finalize() {
    if (this.closed) return;
    if (!this.active) {
      this.opts.onResult({ text: "", lang: null, translation: null, final: true });
      return;
    }
    this.ending = true;
    this.transcriber?.sendRealtimeInput({ activityEnd: {} });
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => this.commit(), COMMIT_FALLBACK_MS);
  }

  close() {
    this.shutdown(null);
  }

  private sendAudio(pcm: Uint8Array) {
    this.transcriber?.sendRealtimeInput({
      audio: {
        data: Buffer.from(pcm).toString("base64"),
        mimeType: `audio/pcm;rate=${SAMPLE_RATE}`,
      },
    });
  }

  private best() {
    const text = tidy(this.text);
    const interim = tidy(this.interim);
    return interim.length > text.length ? interim : text;
  }

  private onTranscript(m: LiveServerMessage) {
    const c = m.serverContent;
    if (!c || !this.active) return;
    if (c.inputTranscription?.text) this.text += c.inputTranscription.text;
    if (c.interimInputTranscription?.text !== undefined)
      this.interim = c.interimInputTranscription.text;
    if (this.ending && (c.generationComplete || c.turnComplete || c.inputTranscription?.finished))
      return this.commit();
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      const text = this.best();
      if (this.active && text)
        this.opts.onResult({ text, lang: null, translation: null, final: false });
    }, PARTIAL_INTERVAL_MS);
  }

  /** The utterance is complete: translate it, then emit its final. */
  private commit() {
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const text = this.best();
    const lang = this.lang;
    this.active = false;
    this.ending = false;
    this.text = "";
    this.interim = "";
    this.lang = null;
    const to = this.opts.langs.find((l) => l !== lang) ?? null;
    if (!text || !to || this.closed) {
      this.opts.onResult({ text, lang: null, translation: null, final: true });
      return;
    }
    this.jobs.push({
      text,
      to,
      out: "",
      done: (translated) =>
        this.opts.onResult({
          text,
          lang: null,
          translation: translated ? { lang: to, text: translated } : null,
          final: true,
        }),
    });
    this.pump();
  }

  private pump() {
    if (!this.translator || this.inflight || !this.jobs.length) return;
    const job = this.jobs.shift()!;
    this.inflight = job;
    this.translator.sendRealtimeInput({ text: `[${CAPTION_LANGUAGES[job.to]}] ${job.text}` });
    clearTimeout(this.jobTimer);
    this.jobTimer = setTimeout(() => this.finishJob(), TRANSLATE_TIMEOUT_MS);
  }

  private onTranslation(m: LiveServerMessage) {
    const c = m.serverContent;
    const job = this.inflight;
    if (!c || !job) return;
    if (c.outputTranscription?.text) job.out += c.outputTranscription.text;
    if (c.turnComplete) this.finishJob();
  }

  private finishJob() {
    clearTimeout(this.jobTimer);
    const job = this.inflight;
    this.inflight = null;
    job?.done(tidy(job.out));
    this.pump();
  }

  private shutdown(error: string | null) {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.flushTimer);
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.jobTimer);
    // whatever was heard or queued still gets its final, untranslated
    const text = this.best();
    if (this.active) this.opts.onResult({ text, lang: null, translation: null, final: true });
    if (this.inflight) this.inflight.done("");
    for (const job of this.jobs.splice(0)) job.done("");
    this.inflight = null;
    this.transcriber?.close();
    this.translator?.close();
    this.opts.onClose(error);
  }
}

export const gemini = (transcribeModel: string, translateModel: string): CaptionProvider => ({
  open: (opts) => new GeminiSession({ ...opts, transcribeModel, translateModel }),
});

/** Checks a key by listing models (no session). Returns an error or null. */
export async function testGeminiKey(apiKey: string): Promise<string | null> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(10_000),
  }).catch((err: Error) => err);
  if (res instanceof Error) return `Gemini unreachable: ${res.message}`;
  if (res.ok) return null;
  return res.status === 400 || res.status === 403
    ? "Gemini rejected the key"
    : `Gemini answered ${res.status}`;
}
