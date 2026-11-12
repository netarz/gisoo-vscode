import * as assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { ArchiveError, readArchive, readTar, readTarGz, readZip, safeEntryPath } from '../../src/skills/archive';

/** Minimal ustar writer for tests. */
function tarEntry(name: string, data: Buffer | string, type = '0', linkName = ''): Buffer {
  const raw = typeof data === 'string' ? Buffer.from(data) : data;
  const hasData = type === '0' || type === 'g' || type === 'x' || type === 'L';
  const body = hasData ? raw : Buffer.alloc(0);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'latin1');
  header.write('0000000\0', 108, 8, 'latin1');
  header.write('0000000\0', 116, 8, 'latin1');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'latin1');
  header.write('00000000000\0', 136, 12, 'latin1');
  header.write('        ', 148, 8, 'latin1');
  header.write(type, 156, 1, 'latin1');
  header.write(linkName, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'latin1');
  header.write('00', 263, 2, 'latin1');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

function tar(...entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024)]);
}

/** Minimal stored zip writer for tests. */
function zip(files: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(text, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('archive entry paths', () => {
  it('normalises relative paths', () => {
    assert.equal(safeEntryPath('./a/./b.md'), 'a/b.md');
    assert.equal(safeEntryPath('a\\b\\c'), 'a/b/c');
  });

  it('refuses traversal, absolute and drive-letter paths', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\0b']) {
      assert.throws(() => safeEntryPath(bad), (e: unknown) => e instanceof ArchiveError && e.reason === 'traversal', bad);
    }
  });
});

describe('tar reader', () => {
  it('reads files, directories and links', () => {
    const buf = tar(tarEntry('skill/', '', '5'), tarEntry('skill/SKILL.md', '# hi'), tarEntry('skill/link', '', '2', 'SKILL.md'));
    const { entries } = readTar(buf);
    assert.deepEqual(
      entries.map((e) => [e.path, e.type]),
      [
        ['skill', 'dir'],
        ['skill/SKILL.md', 'file'],
        ['skill/link', 'link'],
      ],
    );
    assert.equal(entries[1].data.toString(), '# hi');
  });

  it('refuses the whole archive on path traversal', () => {
    const buf = tar(tarEntry('skill/SKILL.md', 'ok'), tarEntry('../evil.sh', 'rm -rf /'));
    assert.throws(() => readTar(buf), (e: unknown) => e instanceof ArchiveError && e.reason === 'traversal');
    assert.throws(() => readTar(tar(tarEntry('/abs.md', 'x'))), (e: unknown) => e instanceof ArchiveError && e.reason === 'traversal');
  });

  it('reads gzip and the pax global comment, and enforces limits', () => {
    const pax = 'comment=abc123def\n';
    const record = `${pax.length + 3} ${pax}`;
    const buf = tar(tarEntry('pax_global_header', record, 'g'), tarEntry('r/SKILL.md', 'x'));
    const r = readTarGz(gzipSync(buf));
    assert.equal(r.comment, 'abc123def');
    assert.equal(r.entries.length, 1);
    assert.throws(() => readTar(buf, { maxTotalBytes: 0 }), (e: unknown) => e instanceof ArchiveError && e.reason === 'too_large');
    assert.throws(() => readTar(tar(tarEntry('a', 'x'), tarEntry('b', 'y')), { maxEntries: 1 }), (e: unknown) => e instanceof ArchiveError && e.reason === 'too_large');
    assert.throws(() => readTarGz(Buffer.from([0x1f, 0x8b, 1, 2, 3])), (e: unknown) => e instanceof ArchiveError && e.reason === 'corrupt');
  });
});

describe('zip reader', () => {
  it('reads stored entries and picks the reader from the bytes', () => {
    const buf = zip([
      ['s/SKILL.md', 'hello'],
      ['s/a.txt', 'A'],
    ]);
    const entries = readZip(buf);
    assert.deepEqual(
      entries.map((e) => [e.path, e.data.toString()]),
      [
        ['s/SKILL.md', 'hello'],
        ['s/a.txt', 'A'],
      ],
    );
    assert.equal(readArchive(buf, 'x.skill').entries.length, 2);
    assert.equal(readArchive(buf, 'anything').entries.length, 2);
  });

  it('refuses traversal and corrupt archives', () => {
    assert.throws(() => readZip(zip([['../x', 'y']])), (e: unknown) => e instanceof ArchiveError && e.reason === 'traversal');
    assert.throws(() => readZip(Buffer.from('not a zip at all, really not')), (e: unknown) => e instanceof ArchiveError && e.reason === 'corrupt');
  });
});
