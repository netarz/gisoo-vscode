/**
 * Minimal archive readers for skill install (SPEC-phase2 §7): tar / tar.gz (ustar, GNU long names,
 * pax headers) and zip (store / deflate) using only node:zlib. No dependency. Path traversal,
 * absolute paths and drive letters are refused for the whole archive; links are reported as entries
 * of type `link` so the caller can refuse them inside the skill folder.
 */
import { gunzipSync, inflateRawSync } from 'node:zlib';

export type ArchiveEntryType = 'file' | 'dir' | 'link' | 'other';

export interface ArchiveEntry {
  /** Normalised with forward slashes, no leading "./". */
  path: string;
  type: ArchiveEntryType;
  data: Buffer;
  mode?: number;
}

export interface ArchiveLimits {
  /** Keep only entries for which this returns true (data of the others is skipped). */
  keep?: (path: string) => boolean;
  /** Total bytes of kept file data. */
  maxTotalBytes?: number;
  maxEntries?: number;
}

export class ArchiveError extends Error {
  constructor(message: string, readonly reason: 'traversal' | 'unsupported' | 'too_large' | 'corrupt' | 'encrypted') {
    super(message);
    this.name = 'ArchiveError';
  }
}

export const ARCHIVE_MAX_TOTAL_BYTES = 20 * 1024 * 1024;
export const ARCHIVE_MAX_ENTRIES = 5_000;

/** Throws on `..`, absolute or drive-letter paths; returns the clean relative path. */
export function safeEntryPath(raw: string): string {
  const unified = raw.replace(/\\/g, '/');
  if (unified.includes('\0')) throw new ArchiveError('Refused: an archive entry has a NUL in its name.', 'traversal');
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) throw new ArchiveError(`Refused: absolute path in archive: ${raw}`, 'traversal');
  const parts = unified.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw new ArchiveError(`Refused: path traversal in archive: ${raw}`, 'traversal');
  return parts.join('/');
}

// -- tar --------------------------------------------------------------------------------------------

function octal(buf: Buffer, start: number, len: number): number {
  if (buf[start] & 0x80) {
    // GNU base-256
    let n = 0;
    for (let i = start; i < start + len; i++) n = n * 256 + (i === start ? buf[i] & 0x7f : buf[i]);
    return n;
  }
  const s = buf.toString('latin1', start, start + len).replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
}

function str(buf: Buffer, start: number, len: number): string {
  return buf.toString('utf8', start, start + len).replace(/\0.*$/s, '');
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space < 0) break;
    const len = parseInt(data.toString('latin1', pos, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = data.toString('utf8', space + 1, pos + len - 1);
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

export interface TarResult {
  entries: ArchiveEntry[];
  /** From a pax global header `comment=` record (GitHub archives put the commit sha there). */
  comment?: string;
}

export function readTar(buf: Buffer, limits: ArchiveLimits = {}): TarResult {
  const entries: ArchiveEntry[] = [];
  const maxTotal = limits.maxTotalBytes ?? ARCHIVE_MAX_TOTAL_BYTES;
  const maxEntries = limits.maxEntries ?? ARCHIVE_MAX_ENTRIES;
  let total = 0;
  let count = 0;
  let pos = 0;
  let longName: string | undefined;
  let paxNext: Record<string, string> | undefined;
  let comment: string | undefined;
  while (pos + 512 <= buf.length) {
    const header = buf.subarray(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const magic = str(header, 257, 6);
    let name = str(header, 0, 100);
    const prefix = magic.startsWith('ustar') ? str(header, 345, 155) : '';
    if (prefix) name = `${prefix}/${name}`;
    const dataStart = pos + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new ArchiveError('Corrupt tar: entry runs past the end.', 'corrupt');
    pos = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = str(buf.subarray(dataStart, dataEnd), 0, size);
      continue;
    }
    if (type === 'x') {
      paxNext = parsePax(buf.subarray(dataStart, dataEnd));
      continue;
    }
    if (type === 'g') {
      const g = parsePax(buf.subarray(dataStart, dataEnd));
      if (g.comment) comment = g.comment;
      continue;
    }
    if (longName) {
      name = longName;
      longName = undefined;
    }
    if (paxNext?.path) name = paxNext.path;
    paxNext = undefined;
    const clean = safeEntryPath(name);
    if (!clean) continue;
    const entryType: ArchiveEntryType = type === '0' || type === '\0' || type === '7' ? 'file' : type === '5' ? 'dir' : type === '1' || type === '2' ? 'link' : 'other';
    if (limits.keep && !limits.keep(clean)) continue;
    if (++count > maxEntries) throw new ArchiveError(`Refused: more than ${maxEntries} entries.`, 'too_large');
    if (entryType === 'file') {
      total += size;
      if (total > maxTotal) throw new ArchiveError(`Refused: archive content exceeds ${Math.round(maxTotal / 1024 / 1024)} MB.`, 'too_large');
    }
    entries.push({ path: clean, type: entryType, data: entryType === 'file' ? Buffer.from(buf.subarray(dataStart, dataEnd)) : Buffer.alloc(0), mode: octal(header, 100, 8) & 0o7777 });
  }
  return { entries, comment };
}

export function readTarGz(buf: Buffer, limits: ArchiveLimits = {}): TarResult {
  const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  let raw: Buffer;
  try {
    raw = isGzip ? gunzipSync(buf, { maxOutputLength: 200 * 1024 * 1024 }) : buf;
  } catch (error) {
    throw new ArchiveError(`Cannot decompress the archive: ${error instanceof Error ? error.message : String(error)}`, 'corrupt');
  }
  return readTar(raw, limits);
}

// -- zip --------------------------------------------------------------------------------------------

export function readZip(buf: Buffer, limits: ArchiveLimits = {}): ArchiveEntry[] {
  const maxTotal = limits.maxTotalBytes ?? ARCHIVE_MAX_TOTAL_BYTES;
  const maxEntries = limits.maxEntries ?? ARCHIVE_MAX_ENTRIES;
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ArchiveError('Not a zip file (no end-of-central-directory record).', 'corrupt');
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ArchiveError('Zip64 archives are not supported.', 'unsupported');
  if (cdOffset + cdSize > buf.length) throw new ArchiveError('Corrupt zip: central directory out of range.', 'corrupt');
  const entries: ArchiveEntry[] = [];
  let pos = cdOffset;
  let total = 0;
  let count = 0;
  for (let i = 0; i < entryCount; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) throw new ArchiveError('Corrupt zip: bad central directory entry.', 'corrupt');
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttrs = buf.readUInt32LE(pos + 38);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    pos += 46 + nameLen + extraLen + commentLen;
    const clean = safeEntryPath(name);
    if (!clean) continue;
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    const isDir = name.endsWith('/') || (unixMode & 0xf000) === 0x4000;
    const isLink = (unixMode & 0xf000) === 0xa000;
    const type: ArchiveEntryType = isDir ? 'dir' : isLink ? 'link' : 'file';
    if (limits.keep && !limits.keep(clean)) continue;
    if (++count > maxEntries) throw new ArchiveError(`Refused: more than ${maxEntries} entries.`, 'too_large');
    if (type !== 'file') {
      entries.push({ path: clean, type, data: Buffer.alloc(0), mode: unixMode & 0o7777 });
      continue;
    }
    if (flags & 0x1) throw new ArchiveError(`Refused: "${clean}" is encrypted.`, 'encrypted');
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) throw new ArchiveError('Zip64 entries are not supported.', 'unsupported');
    total += uncompSize;
    if (total > maxTotal) throw new ArchiveError(`Refused: archive content exceeds ${Math.round(maxTotal / 1024 / 1024)} MB.`, 'too_large');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new ArchiveError('Corrupt zip: bad local header.', 'corrupt');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) throw new ArchiveError('Corrupt zip: entry data out of range.', 'corrupt');
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(uncompSize, 1) });
      } catch (error) {
        throw new ArchiveError(`Cannot inflate "${clean}": ${error instanceof Error ? error.message : String(error)}`, 'corrupt');
      }
    } else throw new ArchiveError(`Unsupported zip compression method ${method} for "${clean}".`, 'unsupported');
    if (data.length !== uncompSize) throw new ArchiveError(`Corrupt zip: size mismatch for "${clean}".`, 'corrupt');
    entries.push({ path: clean, type, data, mode: unixMode & 0o7777 });
  }
  return entries;
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  return -1;
}

/** Picks the reader from the bytes (gzip / zip magic) or the file name. */
export function readArchive(buf: Buffer, nameHint: string, limits: ArchiveLimits = {}): TarResult {
  const lower = nameHint.toLowerCase();
  const isZipMagic = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isZipMagic || lower.endsWith('.zip') || lower.endsWith('.skill')) return { entries: readZip(buf, limits) };
  return readTarGz(buf, limits);
}
