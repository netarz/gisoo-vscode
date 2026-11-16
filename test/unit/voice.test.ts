import * as assert from 'node:assert/strict';
import { GisooError } from '../../src/api/client';
import type { HostToWebview } from '../../src/shared/protocol';
import { recorderCommand, RecorderError, windowsScript } from '../../src/voice/recorder';
import { TRANSCRIBE_MODELS, VoiceInput, type VoiceDeps } from '../../src/voice/service';

function fakeRecording(opts: { failStart?: RecorderError } = {}) {
  const calls: string[] = [];
  return {
    calls,
    start: async () => {
      calls.push('start');
      if (opts.failStart) throw opts.failStart;
    },
    stop: async () => {
      calls.push('stop');
      return Buffer.alloc(4000);
    },
    cancel: async () => {
      calls.push('cancel');
    },
  };
}

function setup(transcribe: VoiceDeps['transcribe'], recording = fakeRecording()) {
  const voice = new VoiceInput({
    transcribe,
    message: (problem, detail) => `${problem}${detail ? `:${detail}` : ''}`,
    createRecording: () => recording,
  });
  const posted: HostToWebview[] = [];
  const sink = (message: HostToWebview) => posted.push(message);
  return { voice, posted, sink, recording };
}

describe('voice input', () => {
  it('picks a recorder per platform', () => {
    const win = recorderCommand('a.wav', 'win32', () => false);
    assert.equal(win?.tool, 'PowerShell');
    assert.ok(win?.args.includes('-EncodedCommand'));
    assert.equal(recorderCommand('a.wav', 'linux', (n) => n === 'arecord')?.tool, 'arecord');
    assert.equal(recorderCommand('a.wav', 'darwin', (n) => n === 'sox')?.tool, 'sox');
    assert.equal(recorderCommand('a.wav', 'darwin', (n) => n === 'ffmpeg')?.args.includes('avfoundation'), true);
    assert.equal(recorderCommand('a.wav', 'linux', () => false), undefined);
  });

  it('embeds the output file in the Windows script, quoted', () => {
    const script = windowsScript("C:\\Temp\\it's.wav");
    assert.ok(script.includes("it''s.wav"));
  });

  it('records, transcribes and posts the text', async () => {
    const { voice, posted, sink, recording } = setup(async () => 'سلام world');
    await voice.start(sink);
    assert.equal(voice.state, 'recording');
    await voice.stop(sink);
    assert.deepEqual(recording.calls, ['start', 'stop']);
    assert.deepEqual(posted.map((m) => (m.type === 'voice' ? m.state : m.type)), ['starting', 'recording', 'transcribing', 'idle', 'voice.text']);
    assert.deepEqual(posted.at(-1), { type: 'voice.text', text: 'سلام world' });
  });

  it('falls back to the next model when one is unknown', async () => {
    const tried: string[] = [];
    const { voice, posted, sink } = setup(async (_audio, { model }) => {
      tried.push(model);
      if (tried.length < 3) throw new GisooError('no', 'model_not_found');
      return 'ok';
    });
    await voice.start(sink);
    await voice.stop(sink);
    assert.deepEqual(tried, TRANSCRIBE_MODELS.slice(0, 3));
    assert.deepEqual(posted.at(-1), { type: 'voice.text', text: 'ok' });
  });

  it('reports a missing microphone and a signed-out user', async () => {
    const noMic = setup(async () => 'x', fakeRecording({ failStart: new RecorderError('no_microphone', 'none') }));
    await noMic.voice.start(noMic.sink);
    assert.equal(noMic.voice.state, 'idle');
    assert.deepEqual(noMic.posted.at(-1), { type: 'toast', level: 'error', text: 'no_microphone' });

    const out = setup(async () => {
      throw new GisooError('bad key', 'invalid_api_key');
    });
    await out.voice.start(out.sink);
    await out.voice.stop(out.sink);
    assert.deepEqual(out.posted.at(-1), { type: 'toast', level: 'error', text: 'signed_out' });
  });

  it('cancels without transcribing, and a second chat takes over', async () => {
    let calls = 0;
    const first = setup(async () => {
      calls++;
      return 'x';
    });
    await first.voice.start(first.sink);
    await first.voice.cancel(first.sink);
    assert.equal(first.voice.state, 'idle');
    assert.deepEqual(first.recording.calls, ['start', 'cancel']);
    assert.equal(calls, 0);

    await first.voice.start(first.sink);
    const other: HostToWebview[] = [];
    await first.voice.start((m) => other.push(m));
    assert.deepEqual(first.posted.at(-1), { type: 'voice', state: 'idle' });
    assert.equal(first.voice.state, 'recording');
  });
});
