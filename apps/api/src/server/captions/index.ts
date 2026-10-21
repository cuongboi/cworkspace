import type { CaptionLang } from "@app/shared/realtime-events";
import { CAPTION_PAIR } from "@app/shared/realtime-events";
import { getSecret, getSettings, onSettingsChange } from "@/server/settings";
import { gemini, testGeminiKey } from "./gemini";
import { soniox, testSonioxKey } from "./soniox";
import type { CaptionProvider, ProviderResult, ProviderSession } from "./types";

/**
 * Live captions of a call, transcribed and translated on the server by the provider chosen in
 * Settings → Integrations (Soniox or Gemini). Speakers' browsers stream 16 kHz PCM16 over `/ws`
 * while they talk; this module feeds it to the provider and hands back captions to publish.
 *
 * Providers bill by connection time, so a call has ONE provider session for all its speakers:
 *   - the floor: one speaker at a time is sent to the provider, so every utterance has a known
 *     speaker; others' audio is dropped until the holder has been silent `SILENCE_MS` and the
 *     provider finalized the utterance (overlapping speech loses words: the price of one stream),
 *   - the session opens on the first speech and closes after `IDLE_CLOSE_MS` without any.
 */

/** the holder stopped sending audio for this long: the utterance ends */
const SILENCE_MS = 700;
/** the provider never finalized: the utterance ends with what it had */
const FINAL_FALLBACK_MS = 6_000;
/** no speech in the call for this long: the provider session closes (billing stops) */
const IDLE_CLOSE_MS = 30_000;
/** audio of the holder kept while the previous utterance finalizes (100 ms chunks) */
const MAX_BUFFERED_CHUNKS = 40;
const MAX_BACKOFF_MS = 60_000;

export type CaptionSpeaker = { socketId: string; userId: string; lang: CaptionLang };

export type CaptionOutput = {
  speaker: CaptionSpeaker;
  utteranceId: string;
  /** when the utterance started (server clock) */
  ts: number;
  lang: CaptionLang;
  text: string;
  translation: { lang: CaptionLang; text: string } | null;
  final: boolean;
};

export type CaptionHooks = {
  glossary(): string[];
  publish(output: CaptionOutput): void;
  status(status: "live" | "off" | "error", error: string | null): void;
};

/** The provider configured now, or null (captions off / no key). */
function currentProvider(): { provider: CaptionProvider; apiKey: string } | null {
  const c = getSettings().caption;
  if (c.provider === "soniox") {
    const apiKey = getSecret("sonioxApiKey");
    return apiKey ? { provider: soniox(c.sonioxModel), apiKey } : null;
  }
  if (c.provider === "gemini") {
    const apiKey = getSecret("geminiApiKey");
    return apiKey
      ? { provider: gemini(c.geminiTranscribeModel, c.geminiTranslateModel), apiKey }
      : null;
  }
  return null;
}

export const captionsAvailable = () => currentProvider() !== null;

type Utterance = {
  id: string;
  ts: number;
  speaker: CaptionSpeaker;
  text: string;
  translation: CaptionOutput["translation"];
  lang: CaptionLang;
};

let seq = 0;

class CallCaptions {
  private readonly hooks: CaptionHooks;
  private session: ProviderSession | null = null;
  /** bumps on every open, so callbacks of a session we closed are ignored */
  private generation = 0;
  private holder: CaptionSpeaker | null = null;
  private current: Utterance | null = null;
  private finalizing = false;
  private buffer: Uint8Array[] = [];
  private lastAudio = 0;
  private inSend = false;
  /** the glossary changed: reopen once nobody speaks */
  private stale = false;
  private failures = 0;
  private retryAt = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(hooks: CaptionHooks) {
    this.hooks = hooks;
  }

  push(speaker: CaptionSpeaker, pcm: Uint8Array) {
    if (Date.now() < this.retryAt) return;
    if (this.holder && this.holder.socketId !== speaker.socketId) return;
    this.holder ??= speaker;
    this.holder.lang = speaker.lang;
    this.lastAudio = Date.now();
    this.armSilence();
    this.armIdle();
    if (this.finalizing) {
      if (this.buffer.length < MAX_BUFFERED_CHUNKS) this.buffer.push(pcm);
      return;
    }
    this.send(pcm);
  }

  /** The speaker muted or left: end their utterance now. */
  release(socketId: string) {
    if (this.holder?.socketId !== socketId) return;
    this.buffer = [];
    this.lastAudio = 0;
    if (this.current && !this.finalizing) this.finalize();
    else if (!this.current) this.holder = null;
  }

  glossaryChanged() {
    this.stale = true;
    this.reopenIfIdle();
  }

  close() {
    clearTimeout(this.silenceTimer);
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.idleTimer);
    this.endSession(null);
  }

  // -------------------------------------------------------------------------------------------

  private send(pcm: Uint8Array) {
    const holder = this.holder!;
    const session = this.ensureSession();
    if (!session) return;
    if (!this.current) this.begin(holder);
    this.inSend = true;
    try {
      session.send(pcm, holder.lang);
    } finally {
      this.inSend = false;
    }
  }

  private begin(speaker: CaptionSpeaker) {
    this.current = {
      id: `u${Date.now().toString(36)}${(seq++).toString(36)}`,
      ts: Date.now(),
      speaker,
      text: "",
      translation: null,
      lang: speaker.lang,
    };
  }

  private ensureSession(): ProviderSession | null {
    if (this.session) return this.session;
    const p = currentProvider();
    if (!p) {
      this.hooks.status("off", null);
      return null;
    }
    const generation = ++this.generation;
    this.stale = false;
    this.session = p.provider.open({
      apiKey: p.apiKey,
      langs: CAPTION_PAIR,
      glossary: this.hooks.glossary(),
      onResult: (r) => {
        if (generation === this.generation) this.onResult(r);
      },
      onClose: (error) => {
        if (generation === this.generation) this.endSession(error);
      },
    });
    this.hooks.status("live", null);
    return this.session;
  }

  private armSilence() {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.current && !this.finalizing) this.finalize();
      else if (!this.current && !this.finalizing) {
        this.holder = null;
        this.reopenIfIdle();
      }
    }, SILENCE_MS);
  }

  private armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.current) this.endSession(null);
    }, IDLE_CLOSE_MS);
  }

  private finalize() {
    this.finalizing = true;
    this.session?.finalize();
    clearTimeout(this.fallbackTimer);
    this.fallbackTimer = setTimeout(() => {
      const u = this.current;
      if (this.finalizing && u)
        this.onResult({ text: u.text, lang: null, translation: u.translation, final: true });
    }, FINAL_FALLBACK_MS);
  }

  private onResult(r: ProviderResult) {
    const u = this.current;
    if (!u) return;
    if (r.lang) u.lang = r.lang;
    if (r.text) u.text = r.text;
    if (r.translation) u.translation = r.translation;
    if (u.text || r.final) this.publish(u, r.final);
    if (!r.final) return;

    this.current = null;
    this.finalizing = false;
    clearTimeout(this.fallbackTimer);
    // the provider ended the utterance by itself while the holder keeps talking
    if (this.inSend && this.holder) return this.begin(this.holder);
    if (this.buffer.length && this.holder) {
      for (const chunk of this.buffer.splice(0)) this.send(chunk);
      return;
    }
    if (Date.now() - this.lastAudio >= SILENCE_MS) {
      this.holder = null;
      this.reopenIfIdle();
    }
  }

  private publish(u: Utterance, final: boolean) {
    // an empty final only closes the line a partial opened
    if (final && !u.text && !u.translation) return;
    try {
      this.hooks.publish({
        speaker: u.speaker,
        utteranceId: u.id,
        ts: u.ts,
        lang: u.lang,
        text: u.text,
        translation: u.translation?.lang === u.lang ? null : u.translation,
        final,
      });
    } catch (err) {
      console.error("[captions] publish", err);
    }
  }

  private reopenIfIdle() {
    if (this.stale && !this.holder && !this.current) this.endSession(null);
  }

  private endSession(error: string | null) {
    const session = this.session;
    this.session = null;
    this.generation++;
    const u = this.current;
    this.current = null;
    this.finalizing = false;
    this.holder = null;
    this.buffer = [];
    if (u) this.publish(u, true);
    session?.close();
    if (error) {
      console.error("[captions] provider:", error);
      this.retryAt = Date.now() + Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** this.failures++);
      this.hooks.status("error", error);
    } else {
      this.failures = 0;
      this.hooks.status("off", null);
    }
  }
}

const calls = new Map<string, CallCaptions>();

/** The caption pipeline of a live call (created on first use). */
export function callCaptions(callId: string, hooks: CaptionHooks) {
  let c = calls.get(callId);
  if (!c) {
    c = new CallCaptions(hooks);
    calls.set(callId, c);
  }
  return c;
}

export function peekCallCaptions(callId: string) {
  return calls.get(callId);
}

export function closeCallCaptions(callId: string) {
  calls.get(callId)?.close();
  calls.delete(callId);
}

// a new provider or key applies from the next utterance
let providerKey = "";
onSettingsChange((s) => {
  const key = JSON.stringify([s.caption, getSecret("sonioxApiKey"), getSecret("geminiApiKey")]);
  if (key === providerKey) return;
  providerKey = key;
  for (const c of calls.values()) c.close();
});

/** For Settings → Integrations: an error message, or null when the key works. */
export async function testCaptionKey(
  provider: "soniox" | "gemini",
  apiKey = getSecret(provider === "soniox" ? "sonioxApiKey" : "geminiApiKey"),
): Promise<string | null> {
  if (!apiKey) return "No API key set";
  return provider === "soniox" ? testSonioxKey(apiKey) : testGeminiKey(apiKey);
}
