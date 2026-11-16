/**
 * Voice input for the chat: one recording at a time across every chat surface. The webview asks
 * to start and stop; the extension host records (recorder.ts), sends the WAV to the gateway's
 * speech-to-text endpoint and posts the text back to the chat that asked for it. Pure Node.
 */
import { GisooError } from '../api/client';
import type { HostToWebview } from '../shared/protocol';
import { Recording, RecorderError, type RecorderErrorCode } from './recorder';

/** Speech-to-text models, tried in order; the next one is used when the gateway does not know a name. */
export const TRANSCRIBE_MODELS = ['gpt-4o-mini-transcribe', 'gpt-transcribe', 'whisper-1', 'gpt-4o-transcribe'] as const;

/** A hint that helps the model keep code words in Latin script inside Persian speech. */
const PROMPT = 'A developer talks to a coding assistant, in Persian or English, about code, files and commands.';

export type VoiceProblem = RecorderErrorCode | 'signed_out' | 'transcribe';

export interface VoiceDeps {
  transcribe(audio: Uint8Array, opts: { model: string; prompt?: string; signal?: AbortSignal }): Promise<string>;
  /** Persian or English message for a problem; `detail` is the gateway's own message. */
  message(problem: VoiceProblem, detail?: string): string;
  /** Builds a recording (tests pass a fake). */
  createRecording?: () => Pick<Recording, 'start' | 'stop' | 'cancel'>;
}

type Sink = (message: HostToWebview) => unknown;

export class VoiceInput {
  private recording: Pick<Recording, 'start' | 'stop' | 'cancel'> | undefined;
  private owner: Sink | undefined;
  private abort: AbortController | undefined;
  private phase: 'idle' | 'starting' | 'recording' | 'transcribing' = 'idle';
  /** Index into TRANSCRIBE_MODELS of the first model the gateway accepted. */
  private modelIndex = 0;

  constructor(private readonly deps: VoiceDeps) {}

  get state(): 'idle' | 'starting' | 'recording' | 'transcribing' {
    return this.phase;
  }

  /** Starts recording for `sink`'s chat. A recording another chat started is discarded first. */
  async start(sink: Sink): Promise<void> {
    if (this.phase !== 'idle' && this.owner === sink) return;
    if (this.owner && this.owner !== sink) await this.cancel(this.owner);

    const recording = this.deps.createRecording ? this.deps.createRecording() : new Recording();
    this.recording = recording;
    this.owner = sink;
    this.set('starting');
    try {
      await recording.start();
    } catch (error) {
      if (this.recording !== recording) return;
      this.reset();
      this.fail(sink, error instanceof RecorderError ? error.code : 'failed');
      return;
    }
    if (this.recording !== recording) return; // cancelled while the microphone was opening
    this.set('recording', Date.now());
  }

  /** Stops the recording and posts the text to the chat that started it. */
  async stop(sink: Sink): Promise<void> {
    const recording = this.recording;
    if (!recording || this.owner !== sink || this.phase !== 'recording') return;
    this.set('transcribing');
    let audio: Buffer;
    try {
      audio = await recording.stop();
    } catch (error) {
      this.reset();
      this.fail(sink, error instanceof RecorderError ? error.code : 'failed');
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    try {
      const text = await this.transcribe(audio, abort.signal);
      if (abort.signal.aborted) return;
      this.reset();
      if (text) sink({ type: 'voice.text', text });
      else this.fail(sink, 'empty');
    } catch (error) {
      if (abort.signal.aborted) return;
      this.reset();
      if (error instanceof GisooError && error.code === 'invalid_api_key') this.fail(sink, 'signed_out');
      else this.fail(sink, 'transcribe', error instanceof Error ? error.message : String(error));
    }
  }

  /** Throws the recording (or a transcription in flight) away. */
  async cancel(sink: Sink): Promise<void> {
    if (this.owner !== sink) return;
    const recording = this.recording;
    this.abort?.abort();
    this.reset();
    if (recording) await recording.cancel().catch(() => undefined);
  }

  /** A chat surface went away: drop its recording without telling it. */
  async detach(sink: Sink): Promise<void> {
    if (this.owner !== sink) return;
    const recording = this.recording;
    this.abort?.abort();
    this.recording = undefined;
    this.owner = undefined;
    this.abort = undefined;
    this.phase = 'idle';
    if (recording) await recording.cancel().catch(() => undefined);
  }

  private async transcribe(audio: Uint8Array, signal: AbortSignal): Promise<string> {
    for (let i = this.modelIndex; ; i++) {
      const model = TRANSCRIBE_MODELS[i];
      try {
        const text = await this.deps.transcribe(audio, { model, prompt: PROMPT, signal });
        this.modelIndex = i;
        return text;
      } catch (error) {
        const unknownModel = error instanceof GisooError && error.code === 'model_not_found';
        if (!unknownModel || i === TRANSCRIBE_MODELS.length - 1) throw error;
      }
    }
  }

  private set(state: 'idle' | 'starting' | 'recording' | 'transcribing', startedAt?: number): void {
    this.phase = state;
    this.owner?.({ type: 'voice', state, ...(startedAt !== undefined ? { startedAt } : {}) });
  }

  private reset(): void {
    const owner = this.owner;
    this.recording = undefined;
    this.abort = undefined;
    this.phase = 'idle';
    owner?.({ type: 'voice', state: 'idle' });
    this.owner = undefined;
  }

  private fail(sink: Sink, problem: VoiceProblem, detail?: string): void {
    sink({ type: 'toast', level: problem === 'empty' ? 'info' : 'error', text: this.deps.message(problem, detail) });
  }
}

let shared: VoiceInput | undefined;

/** The one VoiceInput of this window, set up in activate(). */
export function setVoiceInput(voice: VoiceInput | undefined): void {
  shared = voice;
}

export function voiceInput(): VoiceInput | undefined {
  return shared;
}
