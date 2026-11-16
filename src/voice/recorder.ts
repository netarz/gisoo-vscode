/**
 * Records the microphone on the extension host. VS Code webviews cannot call getUserMedia, so the
 * chat's mic button records here with what the OS already has: winmm through PowerShell on Windows,
 * sox (rec) or ffmpeg on macOS, arecord, sox or ffmpeg on Linux. Output is 16 kHz mono 16-bit WAV.
 * Pure Node: no VS Code imports.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface RecorderCommand {
  /** Short name shown in errors. */
  tool: string;
  command: string;
  args: string[];
  /** How the recording is finished so the file is complete. */
  stop: 'stdin-stop' | 'stdin-q' | 'sigint';
}

/**
 * waveIn driven by hand: eight 100 ms buffers polled for WHDR_DONE and re-queued. (MCI's "record" was
 * tried first: without a message loop it drops about 40% of the buffers.) C# 5, so PowerShell 5.1
 * compiles it. Stdin "stop" saves the WAV, anything else discards it; ten minutes at most.
 */
const WINDOWS_RECORDER_CS = `
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
public static class GisooWaveIn {
  [StructLayout(LayoutKind.Sequential)] public struct Fmt { public ushort Tag; public ushort Channels; public uint Rate; public uint ByteRate; public ushort Align; public ushort Bits; public ushort Size; }
  [StructLayout(LayoutKind.Sequential)] public struct Hdr { public IntPtr Data; public uint Length; public uint Recorded; public IntPtr User; public uint Flags; public uint Loops; public IntPtr Next; public IntPtr Reserved; }
  [DllImport("winmm.dll")] static extern int waveInOpen(out IntPtr h, uint dev, ref Fmt f, IntPtr cb, IntPtr inst, uint flags);
  [DllImport("winmm.dll")] static extern int waveInPrepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern int waveInUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern int waveInAddBuffer(IntPtr h, IntPtr hdr, uint size);
  [DllImport("winmm.dll")] static extern int waveInStart(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInReset(IntPtr h);
  [DllImport("winmm.dll")] static extern int waveInClose(IntPtr h);
  static volatile string command = null;
  public static int Run(string path) {
    Fmt f = new Fmt(); f.Tag = 1; f.Channels = 1; f.Rate = 16000; f.Bits = 16; f.Align = 2; f.ByteRate = 32000; f.Size = 0;
    IntPtr h;
    int r = waveInOpen(out h, 0xFFFFFFFF, ref f, IntPtr.Zero, IntPtr.Zero, 0);
    if (r != 0) { Console.Out.WriteLine("error:" + r); Console.Out.Flush(); return 3; }
    int count = 8, bytes = 3200;
    uint hsize = (uint)Marshal.SizeOf(typeof(Hdr));
    int flagsAt = (int)Marshal.OffsetOf(typeof(Hdr), "Flags");
    int recAt = (int)Marshal.OffsetOf(typeof(Hdr), "Recorded");
    IntPtr[] hdrs = new IntPtr[count];
    for (int i = 0; i < count; i++) {
      Hdr hd = new Hdr(); hd.Data = Marshal.AllocHGlobal(bytes); hd.Length = (uint)bytes;
      hdrs[i] = Marshal.AllocHGlobal((int)hsize);
      Marshal.StructureToPtr(hd, hdrs[i], false);
      waveInPrepareHeader(h, hdrs[i], hsize);
      waveInAddBuffer(h, hdrs[i], hsize);
    }
    r = waveInStart(h);
    if (r != 0) { waveInClose(h); Console.Out.WriteLine("error:" + r); Console.Out.Flush(); return 4; }
    Console.Out.WriteLine("ready"); Console.Out.Flush();
    Thread reader = new Thread(delegate () { string line = Console.In.ReadLine(); command = line == null ? "cancel" : line.Trim(); });
    reader.IsBackground = true; reader.Start();
    MemoryStream pcm = new MemoryStream();
    DateTime until = DateTime.UtcNow.AddMinutes(10);
    byte[] chunk = new byte[bytes];
    bool running = true;
    while (true) {
      if (running && (command != null || DateTime.UtcNow > until)) { waveInReset(h); running = false; }
      for (int i = 0; i < count; i++) {
        int fl = Marshal.ReadInt32(hdrs[i], flagsAt);
        if ((fl & 1) == 0) continue;
        int got = Marshal.ReadInt32(hdrs[i], recAt);
        Hdr hd = (Hdr)Marshal.PtrToStructure(hdrs[i], typeof(Hdr));
        if (got > 0) { Marshal.Copy(hd.Data, chunk, 0, got); pcm.Write(chunk, 0, got); }
        waveInUnprepareHeader(h, hdrs[i], hsize);
        if (running) {
          hd.Recorded = 0; hd.Flags = 0;
          Marshal.StructureToPtr(hd, hdrs[i], false);
          waveInPrepareHeader(h, hdrs[i], hsize);
          waveInAddBuffer(h, hdrs[i], hsize);
        } else {
          Marshal.WriteInt32(hdrs[i], flagsAt, 0);
        }
      }
      if (!running) break;
      Thread.Sleep(15);
    }
    waveInClose(h);
    if (command == null) command = "stop";
    if (command == "stop") {
      byte[] data = pcm.ToArray();
      using (FileStream o = new FileStream(path, FileMode.Create)) {
        BinaryWriter w = new BinaryWriter(o);
        w.Write(new char[] { 'R', 'I', 'F', 'F' }); w.Write(36 + data.Length);
        w.Write(new char[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' }); w.Write(16);
        w.Write((short)1); w.Write((short)1); w.Write(16000); w.Write(32000); w.Write((short)2); w.Write((short)16);
        w.Write(new char[] { 'd', 'a', 't', 'a' }); w.Write(data.Length); w.Write(data); w.Flush();
      }
    }
    Console.Out.WriteLine("done"); Console.Out.Flush();
    return 0;
  }
}
`;

/** The PowerShell script that compiles and runs the recorder above. */
export function windowsScript(file: string): string {
  const path = file.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    WINDOWS_RECORDER_CS.trim(),
    "'@",
    `exit [GisooWaveIn]::Run('${path}')`,
  ].join('\n');
}

function onPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(join(dir, name)));
}

/** Picks the recorder for this machine; undefined when none is installed. */
export function recorderCommand(
  file: string,
  platform: NodeJS.Platform = process.platform,
  has: (name: string) => boolean = (name) => onPath(name, process.env, platform),
): RecorderCommand | undefined {
  if (platform === 'win32') {
    const root = process.env.SystemRoot ?? 'C:\\Windows';
    const ps = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const command = existsSync(ps) ? ps : 'powershell.exe';
    const encoded = Buffer.from(windowsScript(file), 'utf16le').toString('base64');
    return { tool: 'PowerShell', command, args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], stop: 'stdin-stop' };
  }
  if (platform === 'linux' && has('arecord')) {
    return { tool: 'arecord', command: 'arecord', args: ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav', file], stop: 'sigint' };
  }
  if (has('rec')) return { tool: 'sox', command: 'rec', args: ['-q', '-r', '16000', '-c', '1', '-b', '16', file], stop: 'sigint' };
  if (has('sox')) return { tool: 'sox', command: 'sox', args: ['-q', '-d', '-r', '16000', '-c', '1', '-b', '16', file], stop: 'sigint' };
  if (has('ffmpeg')) {
    const input = platform === 'darwin' ? ['-f', 'avfoundation', '-i', ':0'] : ['-f', 'pulse', '-i', 'default'];
    return {
      tool: 'ffmpeg',
      command: 'ffmpeg',
      args: ['-hide_banner', '-loglevel', 'error', '-y', ...input, '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', file],
      stop: 'stdin-q',
    };
  }
  return undefined;
}

export type RecorderErrorCode = 'no_recorder' | 'no_microphone' | 'failed' | 'empty';

export class RecorderError extends Error {
  constructor(readonly code: RecorderErrorCode, message: string) {
    super(message);
    this.name = 'RecorderError';
  }
}

/** Under ~0.2 s of 16 kHz mono 16-bit audio is nothing worth sending. */
export const MIN_WAV_BYTES = 44 + 6400;

/** One recording. start() resolves once the microphone is open; stop() returns the WAV bytes. */
export class Recording {
  private child: ChildProcess | undefined;
  private exited: Promise<number | null> | undefined;
  private output = '';
  private cmd: RecorderCommand | undefined;
  readonly file: string;

  constructor(private readonly pick: (file: string) => RecorderCommand | undefined = (file) => recorderCommand(file)) {
    this.file = join(tmpdir(), `gisoo-voice-${randomBytes(6).toString('hex')}.wav`);
  }

  async start(): Promise<void> {
    const cmd = this.pick(this.file);
    if (!cmd) throw new RecorderError('no_recorder', 'No audio recorder was found.');
    this.cmd = cmd;
    let child: ChildProcess;
    try {
      child = spawn(cmd.command, cmd.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      throw new RecorderError('no_recorder', `${cmd.tool} could not be started.`);
    }
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.once('error', () => resolve(-1));
    });
    child.stdout?.on('data', (chunk: Buffer) => { this.output += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { this.output += chunk.toString(); });
    child.stdin?.on('error', () => undefined);

    if (cmd.stop === 'stdin-stop') {
      // Windows: the script prints "ready" once the microphone is open, or "error:<code>".
      const ok = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 15_000);
        const check = () => {
          if (this.output.includes('ready')) {
            clearTimeout(timer);
            resolve(true);
          } else if (this.output.includes('error:')) {
            clearTimeout(timer);
            resolve(false);
          }
        };
        child.stdout?.on('data', check);
        void this.exited?.then(() => {
          clearTimeout(timer);
          resolve(this.output.includes('ready'));
        });
      });
      if (!ok) {
        this.kill();
        throw new RecorderError('no_microphone', 'The microphone could not be opened.');
      }
      return;
    }
    // Other tools: still running after a short moment means the device opened.
    const early = await Promise.race([this.exited, new Promise<'alive'>((resolve) => setTimeout(() => resolve('alive'), 500))]);
    if (early !== 'alive') {
      throw new RecorderError(early === -1 ? 'no_recorder' : 'no_microphone', `${cmd.tool} could not open the microphone.`);
    }
  }

  /** Finishes the recording and returns the WAV file's bytes. */
  async stop(): Promise<Buffer> {
    const child = this.child;
    if (!child || !this.cmd) throw new RecorderError('failed', 'Not recording.');
    if (this.cmd.stop === 'stdin-stop') child.stdin?.end('stop\n');
    else if (this.cmd.stop === 'stdin-q') child.stdin?.end('q');
    else child.kill('SIGINT');
    const done = await Promise.race([this.exited, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000))]);
    if (done === 'timeout') this.kill();
    this.child = undefined;
    try {
      const bytes = await readFile(this.file);
      if (bytes.length < MIN_WAV_BYTES) throw new RecorderError('empty', 'Nothing was recorded.');
      return bytes;
    } catch (error) {
      if (error instanceof RecorderError) throw error;
      throw new RecorderError('failed', 'The recording could not be saved.');
    } finally {
      await rm(this.file, { force: true });
    }
  }

  /** Discards the recording. */
  async cancel(): Promise<void> {
    if (this.child && this.cmd?.stop === 'stdin-stop') this.child.stdin?.end('cancel\n');
    else this.kill();
    this.child = undefined;
    await Promise.race([this.exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    await rm(this.file, { force: true });
  }

  private kill(): void {
    try {
      this.child?.kill();
    } catch {
      // already gone
    }
  }
}
