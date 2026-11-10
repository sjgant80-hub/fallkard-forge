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
import { gzipSync, inflateSync, deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { forge, read, sha256, parseChunks, serialise, PNG_SIG, MANIFEST_KEYWORD } from './forge.mjs';
import { renderCard } from './art.mjs';
import { auditDeck, loadDeck } from './lineage.mjs';

const sha32 = (b) => createHash('sha256').update(b).digest('hex').slice(0, 32);
// THE PIXELS, NOT THE COMPRESSOR. A pin over the PNG's bytes also pins the deflate stream, and deflate output is not
// part of any contract: two correct zlib builds may compress the same scanlines differently. So the pin is the header
// plus the scanlines the IDAT inflates to — exactly what every viewer draws — which inflation reproduces everywhere.
const pixelPin = (png) => {
  const cs = parseChunks(png);
  return createHash('sha256').update(cs.find((c) => c.type === 'IHDR').data)
    .update(inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)))).digest('hex').slice(0, 32);
};
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

test('THE RENDER IS CONTENT-ADDRESSED — exact pixel pins', () => {
  // Deterministic by contract, so the exact output is pinnable. Any surviving mutant in the
  // painter that these pins cannot see has provably no observable effect on any card.
  // ⚑ These used to hash the whole PNG file, deflate stream included. Grok's box reported "the genesis card moved"
  // (24 Oct, at 830f03d, 139 of 140) and was green again on 31 Oct (Node v24.22.1, at 769efb5, which does not touch
  // art.mjs). art.mjs did not change between the red and the green, so the picture code had not moved — the machine
  // had. A PNG's bytes include its deflate stream, and no contract fixes that stream: a Node built against a different
  // zlib may compress the same scanlines differently. The pins now cover what the card SHOWS — header and scanlines —
  // and the next test pins the compression setting on the machine that runs it, so nothing the old pins caught is lost.
  assert.equal(pixelPin(renderCard({ tags: '', seal: '' })), 'c98b305131d236daa448e4f43df41ac4', 'the genesis card moved');
  assert.equal(pixelPin(renderCard({ tags: 'geo:d4,plasma:12,rose:red+white:3,owl:high-left,wings:galaxy', seal: 'abc123' })),
    '0be84a70e29e4fb880f01aeaa3808923', 'the full-vocabulary card moved');
  assert.equal(pixelPin(renderCard({ tags: 'wings:galaxy' })), 'c69713b594e2592a7085be3993973ea3',
    'the unsealed galaxy card moved — the rng seed chain (seal || tags) is part of the contract');
  // seal k0 was HUNTED: its wing stars land at exactly x=0 (painted) and x=440 (clipped).
  // A guard flipped at either edge paints or drops a star and this hash moves.
  assert.equal(pixelPin(renderCard({ tags: 'wings:galaxy', seal: 'k0' })), 'fba3a0843dddd02033b6c8f069829ce5',
    'the edge-seal card moved — the canvas-edge clip boundary is part of the contract');
});

test('THE PIN IS THE PICTURE, NOT THE COMPRESSOR — re-encoded, the bytes move and the pin does not', () => {
  const png = renderCard({ tags: 'geo:d4,plasma:12,rose:red+white:3,owl:high-left,wings:galaxy', seal: 'abc123' });
  const cs = parseChunks(png);
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  // the same scanlines through a different deflate — what another zlib, or another level, would write
  const again = serialise([cs[0], { type: 'IDAT', data: deflateSync(raw, { level: 1 }) }, cs[cs.length - 1]]);
  assert.notEqual(sha32(again), sha32(png), 'a different compressor writes different bytes');
  assert.equal(pixelPin(again), pixelPin(png), 'and the pin, which is the picture, does not move');
  // one changed pixel moves it
  const one = Buffer.from(raw); one[1 + 3 * 7] ^= 1;
  assert.notEqual(pixelPin(serialise([cs[0], { type: 'IDAT', data: deflateSync(one) }, cs[cs.length - 1]])), pixelPin(png), 'one pixel moves the pin');
  // the setting the old byte pins also fixed: on THIS machine, the image chunk is exactly this zlib's level-9 deflate
  // of the scanlines — true on every machine, whichever zlib it has, and false if the render's compression changes
  for (const card of [png, renderCard({ tags: '', seal: '' }), renderCard({ tags: 'wings:galaxy', seal: 'k0' })]) {
    const c2 = parseChunks(card), idat = c2.find((c) => c.type === 'IDAT').data;
    assert.ok(Buffer.from(idat).equals(deflateSync(inflateSync(idat), { level: 9 })), 'the image chunk is the level-9 deflate of its scanlines');
  }
  // and on one machine the render is still byte-for-byte deterministic, and a well-formed PNG
  assert.ok(renderCard({ tags: 'wings:galaxy', seal: 'k0' }).equals(renderCard({ tags: 'wings:galaxy', seal: 'k0' })));
  assert.ok(serialise(parseChunks(png)).equals(png), 'every chunk CRC is valid');
  assert.deepEqual(cs.map((c) => c.type), ['IHDR', 'IDAT', 'IEND'], 'header, one image chunk, end');
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

test('forge read says VERIFIED only when a key vouches — an unsigned card reads, and says it is unsigned', () => {
  const r = run('forge.mjs', ['read', join(process.cwd(), 'examples', 'seal-000.png')]);
  assert.equal(r.status, 0, 'an unsigned card whose seal holds still reads (CARD-SPEC §3.1)');
  assert.ok(r.stdout.startsWith('✓ SEAL MATCHES — unsigned'), r.stdout.slice(0, 80));
  assert.ok(!r.stdout.includes('VERIFIED'), 'never VERIFIED without a signature');
  assert.ok(r.stdout.includes('signed  no — no key vouches for who forged it'));
});

// ─── lineage.mjs ───

// a build that EARNS the assessor pass: a document carrying the architecture line, reaching nothing outside
const sovereign = (b) => `<!doctype html><title>${b}</title><p>Powered by the Konomi Architecture</p>`;
// a liar inflates its tier by editing the manifest by hand — the forge itself refuses to stamp one
function claimTier(png, tier) {
  const cs = parseChunks(png);
  const i = cs.findIndex(x => x.type === 'tEXt' && x.data.toString('latin1', 0, x.data.indexOf(0)) === MANIFEST_KEYWORD);
  const nul = cs[i].data.indexOf(0);
  const m = JSON.parse(cs[i].data.toString('latin1', nul + 1));
  m.rarity = tier;
  cs[i] = { type: 'tEXt', data: Buffer.concat([Buffer.from(MANIFEST_KEYWORD, 'latin1'), Buffer.from([0]), Buffer.from(JSON.stringify(m), 'latin1')]) };
  return serialise(cs);
}
const forgeTo = (dir, file, build, { claim, ...opts } = {}) => {
  const { png, manifest } = forge({ build, image: IMAGE, ...opts });
  writeFileSync(join(dir, file), claim ? claimTier(png, claim) : png);
  return manifest.seal;
};

test('AUDIT: a clean deck, an overclaim, and a holo-eligible chain that is NOT an overclaim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffdeck-'));
  try {
    // clean root: claims exactly what it can prove
    forgeTo(dir, 'clean.png', 'clean-build');
    // overclaimer: claims rare at depth 0, and its build does not pass the gate
    forgeTo(dir, 'over.png', 'over-build', { claim: 'rare' });
    // a 4-deep chain of builds that EARN the pass; the tip claims holo and is ELIGIBLE, not an overclaim
    const s0 = forgeTo(dir, 'c0.png', sovereign('chain-0'));
    const s1 = forgeTo(dir, 'c1.png', sovereign('chain-1'), { parent: s0 });
    const s2 = forgeTo(dir, 'c2.png', sovereign('chain-2'), { parent: s1 });
    forgeTo(dir, 'c3.png', sovereign('chain-3'), { parent: s2, claim: 'holo' });

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
    forgeTo(dirty, 'over.png', 'over-build', { claim: 'rare' });
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

// ─── the gate's own survivors (6 Nov run): each test below kills a mutant witness v0.6 found alive ───
import { crc32 } from './png.mjs';
import { verifySignature, makeIdentity } from './forge.mjs';
import { chmodSync } from 'node:fs';

test('png: crc32 matches the published check values, not just itself', () => {
  // the standard CRC-32 check value, and the CRC every PNG's IEND chunk carries
  assert.equal(crc32(Buffer.from('123456789', 'latin1')), 0xCBF43926);
  assert.equal(crc32(Buffer.from('IEND', 'latin1')), 0xAE426082);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('forge: verifySignature is false, never true, when the message cannot even be read', () => {
  const id = makeIdentity();
  const sig = id.sign('m');
  assert.equal(verifySignature('m', sig, id.pubB64), true);
  assert.equal(verifySignature(Object.create(null), sig, id.pubB64), false);
});

test('forge: no options is treated as empty options, and a signer name without a key is not stamped', () => {
  let want;
  try { forge({}); } catch (e) { want = e.message; }
  assert.throws(() => forge(null), (e) => e.message === want);
  const { manifest } = forge({ build: 'b', image: IMAGE, signer: 'someone' });
  assert.equal(manifest.signer, null);
});

// rewrite the manifest chunk with any raw text (forge itself never writes these)
function withManifestText(png, text) {
  const cs = parseChunks(png);
  const i = cs.findIndex(x => x.type === 'tEXt' && x.data.toString('latin1', 0, x.data.indexOf(0)) === MANIFEST_KEYWORD);
  cs[i] = { type: 'tEXt', data: Buffer.concat([Buffer.from(MANIFEST_KEYWORD, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]) };
  return serialise(cs);
}
test('read: a manifest that is JSON but not an object is refused as bad-manifest', () => {
  const { png } = forge({ build: 'b', image: IMAGE });
  for (const text of ['5', '"x"', '[]', '[1,2]', 'null', 'true']) {
    const r = read(withManifestText(png, text));
    assert.equal(r.ok, false, text);
    assert.equal(r.reason, 'bad-manifest', text);
  }
});

test('read CLI: OVERCLAIM is printed for an inflated card and never for an honest one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffcli-'));
  try {
    forgeTo(dir, 'honest.png', 'honest-build');
    forgeTo(dir, 'over.png', 'over-build', { claim: 'rare' });
    const h = run('forge.mjs', ['read', join(dir, 'honest.png')]);
    const o = run('forge.mjs', ['read', join(dir, 'over.png')]);
    assert.ok(!h.stdout.includes('OVERCLAIM'), h.stdout);
    assert.ok(o.stdout.includes('OVERCLAIM'), o.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AUDIT: a cycle proves nothing, even when every build in it passes the assessor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffcyc-'));
  try {
    const sealOf = (b) => sha256(gzipSync(Buffer.from(b, 'utf8'), { level: 9 }));
    forgeTo(dir, 'x.png', sovereign('cx'), { parent: sealOf(sovereign('cy')) });
    forgeTo(dir, 'y.png', sovereign('cy'), { parent: sealOf(sovereign('cx')) });
    const { rows } = auditDeck(dir);
    assert.deepEqual(rows.map(r => [r.status, r.provable]), [['cycle', 'common'], ['cycle', 'common']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('AUDIT: rows come deepest first, then by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ffsort-'));
  try {
    const b = forgeTo(dir, 'b.png', 'root-b');
    forgeTo(dir, 'a.png', 'root-a');
    forgeTo(dir, 'c.png', 'child-of-b', { parent: b });
    assert.deepEqual(auditDeck(dir).rows.map(r => [r.name, r.depth]), [['c.png', 1], ['a.png', 0], ['b.png', 0]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A file that cannot be opened at all reaches loadDeck's catch. Only a POSIX non-root user can make one
// (chmod 000), so this runs on the Linux CI runner, where the gate's receipt is made.
const canLock = process.platform !== 'win32' && !(process.getuid && process.getuid() === 0);
test('AUDIT: a file that cannot be opened carries err.message itself, not String(err)', { skip: !canLock && 'needs a POSIX non-root user' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'fflock-'));
  try {
    const f = join(dir, 'locked.png');
    writeFileSync(f, Buffer.alloc(64));
    chmodSync(f, 0o000);
    let want;
    try { readFileSync(f); } catch (e) { want = e.message; }
    const { unreadable } = loadDeck(dir);
    assert.deepEqual(unreadable, [{ name: 'locked.png', reason: want }]);
  } finally { try { chmodSync(join(dir, 'locked.png'), 0o600); } catch {} rmSync(dir, { recursive: true, force: true }); }
});
