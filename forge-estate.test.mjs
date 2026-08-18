// fallkard-forge · forge-estate.test.mjs — the boundaries the mutation gate proved
// nothing was holding (estate bring-up). Four modules, one round:
//   png: signature guard arms, the truncated-tail chunk, the sig-only PNG
//   forge: chunk ORDER (IHDR first, IEND last — the well-formedness the old suite
//     never pinned), degenerate images, the forged date, and every CLI arm
//   art: content-addressed pixel pins (the render is deterministic BY CONTRACT,
//     so the exact output is the spec) and the CLI
//   lineage: decks built card-by-card in tmp dirs — clean, overclaim, holo-chain,
//     orphan, cycle, unreadable — plus the audit CLI exit codes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { forge, read, sha256, parseChunks, serialise, PNG_SIG } from './forge.mjs';
import { renderCard } from './art.mjs';
import { auditDeck, loadDeck } from './lineage.mjs';

const sha32 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32);
const IMAGE = renderCard({ tags: '', seal: '' });
const run = (file, args, cwd) => spawnSync(process.execPath, [join(process.cwd(), file), ...args.slice(0, 0), ...args], { encoding: 'utf8', cwd: cwd || process.cwd() });

// ─── png.mjs ───

test('THE SIGNATURE GUARD HOLDS ON BOTH ARMS — bad sig throws, sig-only parses to nothing', () => {
  assert.deepEqual(parseChunks(PNG_SIG), [], 'an 8-byte PNG (signature only) must parse to zero chunks');
  assert.throws(() => parseChunks(Buffer.alloc(20)), /not a PNG/, 'a bad signature slid past the guard');
  assert.throws(() => parseChunks(Buffer.alloc(3)), /not a PNG/, 'a 3-byte buffer slid past the guard');
});

test('A CHUNK HEADER WITH NO CRC IS STILL SEEN — the parse loop reads to the last full header', () => {
  // 8-byte tail: len=0 + type IEND, crc missing. The loop bound `off + 8 <= length`
  // admits exactly this header; flipped to < it vanishes and a truncated card reads as empty.
  const trunc = Buffer.concat([PNG_SIG, Buffer.from([0, 0, 0, 0]), Buffer.from('IEND')]);
  assert.deepEqual(parseChunks(trunc).map(c => c.type), ['IEND']);
});

// ─── forge.mjs · kernel ───

test('A CARD IS A WELL-FORMED PNG IN ORDER — IHDR first, card chunks BEFORE IEND, IEND last', () => {
  const { png } = forge({ build: 'hello', image: IMAGE, tags: 't' });
  const check = (buf, label) => {
    const types = parseChunks(buf).map(c => c.type);
    assert.equal(types[0], 'IHDR', label + ': the card must start with IHDR — a viewer rejects anything else');
    assert.equal(types[types.length - 1], 'IEND', label + ': the card must end with IEND');
    assert.equal(types[types.length - 2], 'tEXt', label + ': the manifest must sit immediately before IEND');
    assert.equal(types[types.length - 3], 'zTXt', label + ': the payload must sit before the manifest');
  };
  check(png, 'fresh');
  const again = forge({ build: 'hello', image: png, tags: 't' });
  check(again.png, 're-forged');
});

test('AN IMAGE OF NOTHING BUT IEND STILL FORGES — position zero is a real position', () => {
  const bare = serialise([{ type: 'IEND', data: Buffer.alloc(0) }]); // serialise prepends the signature
  const { png } = forge({ build: 'x', image: bare });
  assert.equal(read(png).ok, true, 'a minimal host image broke the forge');
});

test('THE FORGED DATE IS THE ONE GIVEN, and the parent seat is exact', () => {
  const { manifest } = forge({ build: 'x', image: IMAGE, forged: '2026-01-01', parent: 'abc' });
  assert.equal(manifest.forged, '2026-01-01', 'an explicit forged date was replaced by today');
  assert.equal(manifest.parent, 'abc');
  assert.strictEqual(forge({ build: 'x', image: IMAGE }).manifest.parent, null);
});

// ─── art.mjs · the render IS the spec ───

test('THE RENDER IS CONTENT-ADDRESSED — three exact pixel pins', () => {
  // Deterministic by contract, so the exact output is pinnable. Any surviving mutant in the
  // painter that these three pins cannot see has provably no observable effect on any card.
  assert.equal(sha32(renderCard({ tags: '', seal: '' })), '2e9c8f632813863d2d199d5e3048953e', 'the genesis card moved');
  assert.equal(sha32(renderCard({ tags: 'geo:d4,plasma:12,rose:red+white:3,owl:high-left,wings:galaxy', seal: 'abc123' })),
    'c0541355ffc6ed5e9537944bb80555e8', 'the full-vocabulary card moved');
  assert.equal(sha32(renderCard({ tags: 'wings:galaxy' })), '1cb79d8e5d4e4116333d5537c02b1319',
    'the unsealed galaxy card moved — the rng seed chain (seal || tags) is part of the contract');
  // seal k0 was HUNTED: its wing stars land at exactly x=0 (painted) and x=440 (clipped).
  // A guard flipped at either edge paints or drops a star and this hash moves.
  assert.equal(sha32(renderCard({ tags: 'wings:galaxy', seal: 'k0' })), 'd7932578bcdfac62683527513b6ab088',
    'the edge-seal card moved — the canvas-edge clip boundary is part of the contract');
});

test('art CLI: a bad command exits 2, render lands at exactly --out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffart-'));
  try {
    const bad = run('art.mjs', ['notrender']);
    assert.equal(bad.status, 2);
    const out = join(dir, 'card.png');
    // a token sits before --out on purpose: an arg parser reading argv[i-1] lands on it and misses
    const ok = run('art.mjs', ['render', '--tags', 'geo:d2', '--out', out]);
    assert.equal(ok.status, 0, ok.stderr.slice(0, 200));
    assert.ok(existsSync(out), 'the render did not land where --out said');
    assert.ok(readFileSync(out).subarray(0, 8).equals(PNG_SIG));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ─── forge.mjs · CLI ───

test('forge CLI: usage arms, flag seating, (none)/(root) fallbacks, read and hatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffcli-'));
  try {
    const build = join(dir, 'tool.html');
    writeFileSync(build, '<h1>the build</h1>');

    assert.equal(run('forge.mjs', []).status, 2, 'no command must print usage and exit 2');
    assert.equal(run('forge.mjs', ['frobnicate']).status, 2);
    assert.equal(run('forge.mjs', ['forge', '--build', build]).status, 2, 'no image and no --art must be a usage error');
    assert.equal(run('forge.mjs', ['read']).status, 2);

    // --tags BEFORE --build on purpose: argv[i-1] lands on the tags value and the forge dies
    const o1 = join(dir, 'c1.png');
    const f1 = run('forge.mjs', ['forge', '--tags', 'geo:d2', '--build', build, '--art', '--out', o1]);
    assert.equal(f1.status, 0, f1.stderr.slice(0, 300));
    assert.ok(f1.stdout.includes('tags    geo:d2'));
    assert.ok(f1.stdout.includes('parent  (root)'), 'a rootless card must print (root)');
    const m1 = read(readFileSync(o1));
    assert.equal(m1.ok, true);
    assert.strictEqual(m1.manifest.parent, null, '--parent none (the default) must store null');

    const o2 = join(dir, 'c2.png');
    const f2 = run('forge.mjs', ['forge', '--build', build, '--art', '--parent', 'abc123', '--out', o2]);
    assert.equal(f2.status, 0);
    assert.ok(f2.stdout.includes('tags    (none)'), 'no tags must print (none)');
    assert.equal(read(readFileSync(o2)).manifest.parent, 'abc123', '--parent <sha> must be stored verbatim');

    const r1 = run('forge.mjs', ['read', o1]);
    assert.equal(r1.status, 0, 'reading a good card must exit 0');
    assert.ok(r1.stdout.includes('✓ VERIFIED'));
    assert.ok(!r1.stdout.includes('actual'), 'a verified card must not print an actual-seal line');
    assert.ok(r1.stdout.includes('parent  (root)'));
    assert.ok(r1.stdout.includes('tags    geo:d2'), 'the read command lost the real tags');

    const h = join(dir, 'hatched.html');
    const r2 = run('forge.mjs', ['read', o1, '--hatch', h]);
    assert.equal(r2.status, 0);
    assert.equal(readFileSync(h, 'utf8'), '<h1>the build</h1>', 'the hatch must be byte-identical to the build');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ─── lineage.mjs ───

const forgeTo = (dir, file, build, opts = {}) => {
  const { png, manifest } = forge({ build, image: IMAGE, ...opts });
  writeFileSync(join(dir, file), png);
  return manifest.seal;
};

test('AUDIT: a clean deck, an overclaim, and a holo-eligible chain that is NOT an overclaim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffdeck-'));
  try {
    // clean root: claims exactly what it can prove
    forgeTo(dir, 'clean.png', 'clean-build');
    // overclaimer: rare at depth 0 with no assessor pass
    forgeTo(dir, 'over.png', 'over-build', { rarity: 'rare' });
    // a 4-deep assessor-passed chain; the tip claims holo and is ELIGIBLE, not an overclaim
    const s0 = forgeTo(dir, 'c0.png', 'chain-0', { assessorPass: true });
    const s1 = forgeTo(dir, 'c1.png', 'chain-1', { assessorPass: true, parent: s0 });
    const s2 = forgeTo(dir, 'c2.png', 'chain-2', { assessorPass: true, parent: s1 });
    forgeTo(dir, 'c3.png', 'chain-3', { assessorPass: true, parent: s2, rarity: 'holo' });

    const a = auditDeck(dir);
    assert.deepEqual(a.overclaims.map(r => r.name), ['over.png'],
      'exactly the rare-claiming rootless card is an overclaim — a holo-eligible holo claim is not');
    const c3 = a.rows.find(r => r.name === 'c3.png');
    assert.equal(c3.depth, 3);
    assert.equal(c3.holoEligible, true);
    assert.equal(c3.overclaim, false, 'the holo exception was dropped');
    assert.equal(a.rows.find(r => r.name === 'clean.png').overclaim, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AUDIT: orphans are exactly the cards whose parent is absent, and ties sort by locale name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffdeck2-'));
  try {
    forgeTo(dir, 'ax.png', 'root-b');
    forgeTo(dir, '_x.png', 'root-a');
    forgeTo(dir, 'lost.png', 'lost-build', { parent: 'f'.repeat(64) });
    const a = auditDeck(dir);
    assert.deepEqual(a.orphans.map(r => r.name), ['lost.png']);
    const names = a.rows.map(r => r.name);
    assert.deepEqual(names, [...names].sort((x, y) => x.localeCompare(y)),
      'same-depth rows must be ordered by name, not by directory order');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AUDIT: an unreadable file carries the REAL reason, not a stringified Error object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffdeck3-'));
  try {
    writeFileSync(join(dir, 'garbage.png'), Buffer.alloc(64));
    const { unreadable } = loadDeck(dir);
    assert.equal(unreadable.length, 1);
    assert.ok(!/^Error:/.test(unreadable[0].reason), 'the reason must be err.message, not String(err)');
    assert.match(unreadable[0].reason, /not a PNG/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('lineage CLI: exit codes are earned — clean 0 with the ✓ line, overclaim 1, cycle 1, bad cmd 2', () => {
  const clean = mkdtempSync(join(tmpdir(), 'ffl1-'));
  const dirty = mkdtempSync(join(tmpdir(), 'ffl2-'));
  const cyc = mkdtempSync(join(tmpdir(), 'ffl3-'));
  try {
    forgeTo(clean, 'ok.png', 'clean-build');
    forgeTo(dirty, 'over.png', 'over-build', { rarity: 'rare' });
    // a two-card cycle: each parent is the OTHER card's seal (seals depend only on the build)
    const sealOf = (b) => sha256(gzipSync(Buffer.from(b, 'utf8'), { level: 9 }));
    forgeTo(cyc, 'x.png', 'cycle-x', { parent: sealOf('cycle-y') });
    forgeTo(cyc, 'y.png', 'cycle-y', { parent: sealOf('cycle-x') });

    assert.equal(run('lineage.mjs', ['notaudit']).status, 2);

    const c = run('lineage.mjs', ['audit', clean]);
    assert.equal(c.status, 0, c.stdout.slice(-300));
    assert.ok(c.stdout.includes('✓ every claimed tier is backed'), 'a clean deck must say so');

    const d = run('lineage.mjs', ['audit', dirty]);
    assert.equal(d.status, 1, 'an overclaim alone must fail the audit');
    assert.ok(!d.stdout.includes('✓ every claimed tier is backed'), 'the ✓ line printed over an overclaim');
    assert.ok(d.stdout.includes('OVERCLAIM'));

    const y = run('lineage.mjs', ['audit', cyc]);
    assert.equal(y.status, 1, 'a cycle alone must fail the audit');
    assert.ok(y.stdout.includes('cycle'));
  } finally {
    for (const d of [clean, dirty, cyc]) rmSync(d, { recursive: true, force: true });
  }
});
