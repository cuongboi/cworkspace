import { type CaptionLang, isCaptionLang } from "@app/shared/realtime-events";
import type { CaptionProvider, ProviderOptions, ProviderResult, ProviderSession } from "./types";
import { SAMPLE_RATE } from "./types";

/**
 * Soniox real-time STT with two-way translation in the same stream
 * (https://soniox.com/docs/translation/stt-translation/rt-translation): one WebSocket per call,
 * the speech and its translation come back as tokens of the same response.
 *
 * Final tokens accumulate; non-final ones are replaced by every response. `finalize` asks Soniox
 * to finalize everything pending (answered by a `<fin>` token); `<end>` is its own endpoint
 * detection. Translation tokens can trail the end marker, so the final result waits for them a
 * little (`TRANSLATION_GRACE_MS`).
 */

const URL = "wss://stt-rt.soniox.com/transcribe-websocket";
/** partial updates are coalesced to this interval */
const PARTIAL_INTERVAL_MS = 200;
/** after the end marker: how long a missing translation is awaited */
const TRANSLATION_GRACE_MS = 2_000;
/** Soniox drops a connection that receives nothing for a while */
const KEEPALIVE_MS = 8_000;

type Token = {
  text: string;
  is_final?: boolean;
  translation_status?: "none" | "original" | "translation";
  language?: string;
};

type Response = {
  tokens?: Token[];
  error_code?: number;
  error_message?: string;
  finished?: boolean;
};

const isMarker = (t: Token) => t.text === "<end>" || t.text === "<fin>";
const isTranslation = (t: Token) => t.translation_status === "translation";
const join = (tokens: Token[]) =>
  tokens
    .map((t) => t.text)
    .join("")
    .trim();
const langOf = (tokens: Token[]): CaptionLang | null => {
  const l = tokens.find((t) => t.language)?.language;
  return isCaptionLang(l) ? l : null;
};

class SonioxSession implements ProviderSession {
  private readonly ws: WebSocket;
  private readonly opts: ProviderOptions & { model: string };
  private open = false;
  private closed = false;
  /** audio sent before the socket opened */
  private backlog: (Uint8Array | string)[] = [];
  private finals: Token[] = [];
  private partials: Token[] = [];
  /** the utterance ended (marker seen); its final is held for the translation */
  private ended = false;
  private lang: CaptionLang | null = null;
  private lastSent = "";
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private lastWrite = Date.now();

  constructor(opts: ProviderOptions & { model: string }) {
    this.opts = opts;
    this.ws = new WebSocket(URL, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    } as unknown as string[]);
    this.ws.binaryType = "arraybuffer";
    this.ws.onopen = () => {
      const [a, b] = opts.langs;
      this.ws.send(
        JSON.stringify({
          api_key: opts.apiKey,
          model: opts.model,
          audio_format: "pcm_s16le",
          sample_rate: SAMPLE_RATE,
          num_channels: 1,
          language_hints: [a, b],
          enable_language_identification: true,
          enable_endpoint_detection: true,
          ...(opts.glossary.length ? { context: { terms: opts.glossary } } : {}),
          translation: { type: "two_way", language_a: a, language_b: b },
        }),
      );
      this.open = true;
      for (const chunk of this.backlog.splice(0)) this.write(chunk);
      this.keepalive = setInterval(() => {
        if (Date.now() - this.lastWrite >= KEEPALIVE_MS)
          this.write(JSON.stringify({ type: "keepalive" }));
      }, KEEPALIVE_MS / 2);
    };
    this.ws.onmessage = (e) => {
      try {
        this.onResponse(JSON.parse(String(e.data)) as Response);
      } catch (err) {
        console.error("[captions:soniox] bad response", err);
      }
    };
    this.ws.onerror = () => this.shutdown("connection error");
    this.ws.onclose = (e) =>
      this.shutdown(e.code === 1000 ? null : e.reason || `connection closed (${e.code})`);
  }

  send(pcm: Uint8Array, lang: CaptionLang) {
    if (this.closed) return;
    // audio after an ended utterance belongs to the next one: release the held final now
    if (this.ended) this.emitFinal();
    this.lang ??= lang;
    if (this.open) this.write(pcm);
    else this.backlog.push(pcm);
  }

  finalize() {
    if (this.closed) return;
    if (!this.finals.length && !this.partials.length && !this.backlog.length && !this.lang) {
      // nothing was recognised: the contract still wants one final
      return this.opts.onResult({ text: "", lang: null, translation: null, final: true });
    }
    if (this.open) this.write(JSON.stringify({ type: "finalize" }));
    else this.backlog.push(JSON.stringify({ type: "finalize" }));
    // a finalize that never gets its marker (a dropped response) still ends the utterance
    this.armGrace(TRANSLATION_GRACE_MS * 2);
  }

  close() {
    if (this.closed) return;
    // an empty frame tells Soniox the audio is over; it answers `finished` and closes
    if (this.open) this.write("");
    this.shutdown(null);
    setTimeout(() => this.ws.close(1000), 1_000);
  }

  private write(data: Uint8Array | string) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.lastWrite = Date.now();
    this.ws.send(data);
  }

  private onResponse(res: Response) {
    if (res.error_code) {
      this.shutdown(`${res.error_code}: ${res.error_message ?? "error"}`);
      this.ws.close();
      return;
    }
    let marker = false;
    this.partials = [];
    for (const t of res.tokens ?? []) {
      if (isMarker(t)) marker = true;
      else if (t.is_final) this.finals.push(t);
      else this.partials.push(t);
    }
    if (marker) this.ended = true;
    if (this.ended) {
      // complete once the translation is in (or there is nothing to translate)
      const all = [...this.finals, ...this.partials];
      const pendingTranslation = this.partials.some(isTranslation);
      const hasTranslation = all.some(isTranslation);
      if (!pendingTranslation && (hasTranslation || !join(all.filter((t) => !isTranslation(t)))))
        return this.emitFinal();
      return this.armGrace(TRANSLATION_GRACE_MS);
    }
    this.schedulePartial();
  }

  private current(final: boolean): ProviderResult {
    const all = [...this.finals, ...this.partials];
    const original = all.filter((t) => !isTranslation(t));
    const translated = all.filter(isTranslation);
    const lang = langOf(original) ?? this.lang;
    const other = lang ? this.opts.langs.find((l) => l !== lang) : null;
    const tLang = langOf(translated) ?? other ?? null;
    const tText = join(translated);
    return {
      text: join(original),
      lang: langOf(original),
      translation: tLang && tText ? { lang: tLang, text: tText } : null,
      final,
    };
  }

  private schedulePartial() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (this.closed || this.ended) return;
      const r = this.current(false);
      const key = `${r.text}\u0000${r.translation?.text ?? ""}`;
      if (!r.text || key === this.lastSent) return;
      this.lastSent = key;
      this.opts.onResult(r);
    }, PARTIAL_INTERVAL_MS);
  }

  private armGrace(ms: number) {
    clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => this.emitFinal(), ms);
  }

  private emitFinal() {
    clearTimeout(this.graceTimer);
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const r = this.current(true);
    this.finals = [];
    this.partials = [];
    this.ended = false;
    this.lang = null;
    this.lastSent = "";
    this.opts.onResult(r);
  }

  private shutdown(error: string | null) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.keepalive);
    clearTimeout(this.flushTimer);
    clearTimeout(this.graceTimer);
    this.backlog = [];
    if (this.finals.length || this.partials.length) this.emitFinal();
    this.opts.onClose(error);
  }
}

export const soniox = (model: string): CaptionProvider => ({
  open: (opts) => new SonioxSession({ ...opts, model }),
});

/** Checks a key by asking for a temporary key (cheap, no audio). Returns an error or null. */
export async function testSonioxKey(apiKey: string): Promise<string | null> {
  const res = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ usage_type: "transcribe_websocket", expires_in_seconds: 60 }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: Error) => err);
  if (res instanceof Error) return `Soniox unreachable: ${res.message}`;
  if (res.ok) return null;
  return res.status === 401 ? "Soniox rejected the key" : `Soniox answered ${res.status}`;
}
