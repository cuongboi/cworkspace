import type { CaptionLang } from "@app/shared/realtime-events";

/** 16 kHz mono PCM16 little-endian: what the browser sends and every provider takes. */
export const SAMPLE_RATE = 16_000;

/** What a provider made of the current utterance so far (`final`: the utterance is complete). */
export type ProviderResult = {
  text: string;
  /** detected language of the speech (null: unknown, the speaker's own setting applies) */
  lang: CaptionLang | null;
  translation: { lang: CaptionLang; text: string } | null;
  final: boolean;
};

export type ProviderOptions = {
  apiKey: string;
  /** the two languages of the call: speech in either is translated into the other */
  langs: readonly [CaptionLang, CaptionLang];
  glossary: string[];
  onResult(result: ProviderResult): void;
  /** the session ended on its own (`error` null: closed normally) */
  onClose(error: string | null): void;
};

/**
 * One streaming session of a provider, shared by everyone in a call: the caller (the floor in
 * `captions/index.ts`) only sends one speaker's audio at a time.
 *
 * Contract: after `finalize()` the provider emits exactly one result with `final: true` for the
 * audio sent so far (possibly with empty text). Audio sent after that starts the next utterance.
 */
export interface ProviderSession {
  send(pcm: Uint8Array, lang: CaptionLang): void;
  finalize(): void;
  close(): void;
}

export interface CaptionProvider {
  open(options: ProviderOptions): ProviderSession;
}
