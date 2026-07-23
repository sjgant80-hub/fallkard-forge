#!/usr/bin/env node
// ═══ FALLKARD-FORGE TEST SUITE ═══
// Step 0 of the build order: prove the round trip before anything else is built.
// Generates a real PNG in-memory (no fixture needed), forges a build into it, reads it
// back, and asserts: seal verifies, payload is byte-identical, the picture is untouched,
// tampering is caught, and re-forging is idempotent.
// Usage: node test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  forge, read, rarity, parseChunks, makeChunk, serialise, sha256,
  SPEC_VERSION, PAYLOAD_KEYWORD, MANIFEST_KEYWORD,
} from './forge.mjs';
import { loadDeck, walkDepths, auditDeck } from './lineage.mjs';

// ── a genuine 8×8 RGB PNG, built from scratch so the suite needs no binary fixture
function makePng(w = 8, h = 8) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type: truecolour RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // deflate / adaptive / non-interlaced

  const raw = Buffer.alloc(h * (1 + w * 3));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;                       // filter: none
    for (let x = 0; x < w; x++) { raw[o++] = (x * 32) & 255; raw[o++] = (y * 32) & 255; raw[o++] = 128; }
  }
  return serialise([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: deflateSync(raw) },
    { type: 'IEND', data: Buffer.alloc(0) },
  ]);
}

const BUILD = `<!doctype html><meta charset=utf-8><title>hello seal</title>
<h1>hatched</h1><p>a real single-file build carried by a card.</p>
<script>document.title='hatched:'+(1.618).toFixed(3)</script>`;

const IMAGE = makePng();
const FORGED = '2026-07-23';

test('step 0 — the round trip: forge → read → hatch is byte-identical', () => {
  const { png, manifest } = forge({ build: BUILD, image: IMAGE, tags: 'owl:high-left', forged: FORGED });
  const r = read(png);
  assert.equal(r.ok, true, 'seal must verify');
  assert.equal(r.reason, 'verified');
  assert.equal(r.hatch(), BUILD, 'hatched build must equal the original byte-for-byte');
  assert.equal(manifest.v, SPEC_VERSION);
});

test('the seal is sha256 of the gzipped payload, and the reader recomputes it', () => {
  const { png, manifest } = forge({ build: BUILD, image: IMAGE, forged: FORGED });
  const r = read(png);
  assert.equal(r.actualSeal, manifest.seal);
  assert.equal(manifest.seal, sha256(r.payload));
  assert.match(manifest.seal, /^[0-9a-f]{64}$/);
});

test('the picture is untouched — image chunks are byte-identical (no pixel steganography)', () => {
  const { png } = forge({ build: BUILD, image: IMAGE, forged: FORGED });
  const before = parseChunks(IMAGE).filter(c => c.type === 'IHDR' || c.type === 'IDAT');
  const after = parseChunks(png).filter(c => c.type === 'IHDR' || c.type === 'IDAT');
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].type, before[i].type);
    assert.ok(after[i].data.equals(before[i].data), `${before[i].type} pixels must not change`);
  }
});

test('the payload is DECLARED — both chunks are present and listable', () => {
  const { png } = forge({ build: BUILD, image: IMAGE, forged: FORGED });
  const kws = parseChunks(png)
    .filter(c => c.type === 'tEXt' || c.type === 'zTXt')
    .map(c => c.data.toString('latin1', 0, c.data.indexOf(0)));
  assert.ok(kws.includes(PAYLOAD_KEYWORD), 'payload chunk must be present and named');
  assert.ok(kws.includes(MANIFEST_KEYWORD), 'manifest chunk must be present and named');
});

test('tampering is caught — a flipped payload byte fails the seal', () => {
  const { png } = forge({ build: BUILD, image: IMAGE, forged: FORGED });
  const chunks = parseChunks(png);
  const i = chunks.findIndex(c => c.type === 'zTXt');
  const d = Buffer.from(chunks[i].data);
  d[d.length - 1] ^= 0xFF;                       // corrupt the compressed payload
  chunks[i] = { type: 'zTXt', data: d };
  let verdict;
  try { verdict = read(serialise(chunks)); }
  catch { verdict = { ok: false, reason: 'undecodable' }; }
  assert.equal(verdict.ok, false, 'a tampered card must not verify');
});

test('a card with no manifest reports no-manifest rather than throwing', () => {
  const r = read(IMAGE);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-manifest');
});

test('re-forging is idempotent — no duplicate card chunks accumulate', () => {
  const once = forge({ build: BUILD, image: IMAGE, forged: FORGED }).png;
  const twice = forge({ build: BUILD, image: once, forged: FORGED }).png;
  const count = (buf, kw) => parseChunks(buf)
    .filter(c => (c.type === 'tEXt' || c.type === 'zTXt') && c.data.toString('latin1', 0, c.data.indexOf(0)) === kw).length;
  assert.equal(count(twice, PAYLOAD_KEYWORD), 1);
  assert.equal(count(twice, MANIFEST_KEYWORD), 1);
  assert.equal(read(twice).hatch(), BUILD);
});

test('chunk CRCs are valid — the card is a well-formed PNG', () => {
  const { png } = forge({ build: BUILD, image: IMAGE, forged: FORGED });
  // re-serialising the parsed chunks must reproduce the file exactly, which only holds
  // if every CRC we wrote matches what makeChunk computes for that data.
  assert.ok(serialise(parseChunks(png)).equals(png));
});

test('rarity is earned, not manufactured', () => {
  assert.equal(rarity({}), 'common');
  assert.equal(rarity({ assessorPass: true }), 'uncommon');
  assert.equal(rarity({ assessorPass: true, depth: 2 }), 'rare');
  assert.equal(rarity({ assessorPass: true, depth: 3, readingKeyHonest: true }), 'holo');
  assert.equal(rarity({ assessorPass: false, depth: 9, readingKeyHonest: true }), 'common',
    'depth alone must never buy a tier without a verify pass');
});

test('forge stamps the EARNED rarity, not a default', () => {
  // an assessor-passing card at depth 0 is uncommon, never "common"
  assert.equal(forge({ build: BUILD, image: IMAGE, assessorPass: true, forged: FORGED }).manifest.rarity, 'uncommon');
  assert.equal(forge({ build: BUILD, image: IMAGE, forged: FORGED }).manifest.rarity, 'common');
  assert.equal(forge({ build: BUILD, image: IMAGE, assessorPass: true, depth: 3, readingKeyHonest: true, forged: FORGED }).manifest.rarity, 'holo');
  // depth without a verify pass buys nothing
  assert.equal(forge({ build: BUILD, image: IMAGE, depth: 5, readingKeyHonest: true, forged: FORGED }).manifest.rarity, 'common');
});

// ── provenance · the depth walk (CARD-SPEC §5) ──────────────────────────────────────
// Rarity must be EARNED. These decks are synthetic because the honest example deck only
// reaches depth 1 — fabricating cards to manufacture depth is exactly what the format forbids.
function deck(cards) {
  const dir = mkdtempSync(join(tmpdir(), 'fallkard-'));
  const seals = {};
  for (const c of cards) {
    const { png, manifest } = forge({
      build: c.build || `<!doctype html><title>${c.name}</title>`,
      image: IMAGE,
      parent: c.parent ? (seals[c.parent] || c.parent) : null,
      assessorPass: c.assessorPass !== false,
      rarity: c.rarity,
      forged: FORGED,
    });
    seals[c.name] = manifest.seal;
    let bytes = png;
    if (c.corrupt) {
      // Falsify the CLAIMED seal, leaving the payload decodable — otherwise the chunk simply
      // fails to inflate and the card is unreadable rather than mis-sealed, which is a
      // different failure. This is the card that decodes fine and lies about its hash.
      const cs = parseChunks(png);
      const i = cs.findIndex(x => x.type === 'tEXt'
        && x.data.toString('latin1', 0, x.data.indexOf(0)) === MANIFEST_KEYWORD);
      const nul = cs[i].data.indexOf(0);
      const m = JSON.parse(cs[i].data.toString('latin1', nul + 1));
      m.seal = (m.seal[0] === '0' ? '1' : '0') + m.seal.slice(1);
      cs[i] = { type: 'tEXt', data: Buffer.concat([
        Buffer.from(MANIFEST_KEYWORD, 'latin1'), Buffer.from([0]),
        Buffer.from(JSON.stringify(m), 'latin1')]) };
      bytes = serialise(cs);
    }
    writeFileSync(join(dir, `${c.name}.png`), bytes);
  }
  return { dir, seals, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('depth is walked from parent links, root = 0', () => {
  const d = deck([{ name: 'a' }, { name: 'b', parent: 'a' }, { name: 'c', parent: 'b' }, { name: 'e', parent: 'c' }]);
  try {
    const byName = Object.fromEntries(auditDeck(d.dir).rows.map(r => [r.name.replace('.png', ''), r]));
    assert.equal(byName.a.depth, 0); assert.equal(byName.a.status, 'root');
    assert.equal(byName.b.depth, 1); assert.equal(byName.c.depth, 2); assert.equal(byName.e.depth, 3);
    assert.equal(byName.e.status, 'linked');
  } finally { d.cleanup(); }
});

test('an absent ancestor proves nothing — orphans earn no depth', () => {
  const d = deck([{ name: 'lonely', parent: 'f'.repeat(64) }]);
  try {
    const r = auditDeck(d.dir).rows[0];
    assert.equal(r.status, 'orphan');
    assert.equal(r.depth, 0, 'an unprovable chain must not grant depth');
    assert.equal(r.provable, 'uncommon', 'only the verify pass counts, not the claimed ancestor');
  } finally { d.cleanup(); }
});

test('rarity tiers are proven by the deck, not asserted by the card', () => {
  const d = deck([{ name: 'a' }, { name: 'b', parent: 'a' }, { name: 'c', parent: 'b' }]);
  try {
    const byName = Object.fromEntries(auditDeck(d.dir).rows.map(r => [r.name.replace('.png', ''), r]));
    assert.equal(byName.a.provable, 'uncommon');   // depth 0 + pass
    assert.equal(byName.b.provable, 'uncommon');   // depth 1 — still not enough
    assert.equal(byName.c.provable, 'rare');       // depth 2 + pass
  } finally { d.cleanup(); }
});

test('an overclaimed tier is caught', () => {
  const d = deck([{ name: 'liar', rarity: 'holo' }]);        // claims holo at depth 0
  try {
    const a = auditDeck(d.dir);
    assert.equal(a.overclaims.length, 1);
    assert.equal(a.overclaims[0].claimed, 'holo');
    assert.equal(a.overclaims[0].provable, 'uncommon');
  } finally { d.cleanup(); }
});

test('the tool never AWARDS holo — it only reports eligibility', () => {
  const d = deck([{ name: 'a' }, { name: 'b', parent: 'a' }, { name: 'c', parent: 'b' }, { name: 'e', parent: 'c' }]);
  try {
    const e = auditDeck(d.dir).rows.find(r => r.name.startsWith('e'));
    assert.equal(e.depth, 3);
    assert.equal(e.holoEligible, true, 'mechanical half is satisfied');
    assert.equal(e.provable, 'rare', 'holo needs an honest reading-key match — a fluency judgement no tool can make');
  } finally { d.cleanup(); }
});

test('a broken seal is not admissible provenance', () => {
  const d = deck([{ name: 'tampered', corrupt: true }]);
  try {
    const a = auditDeck(d.dir);
    assert.equal(a.broken.length, 1);
    assert.equal(a.broken[0].provable, 'common', 'a card that fails its seal earns nothing');
  } finally { d.cleanup(); }
});

test('a lineage cycle is detected rather than looping forever', () => {
  // hand-build the cycle: two cards naming each other, which forging alone cannot produce
  const dir = mkdtempSync(join(tmpdir(), 'fallkard-cyc-'));
  try {
    const one = forge({ build: '<p>one', image: IMAGE, forged: FORGED });
    const two = forge({ build: '<p>two', image: IMAGE, parent: one.manifest.seal, forged: FORGED });
    const oneCycled = forge({ build: '<p>one', image: IMAGE, parent: two.manifest.seal, forged: FORGED });
    writeFileSync(join(dir, 'one.png'), oneCycled.png);
    writeFileSync(join(dir, 'two.png'), two.png);
    const a = auditDeck(dir);
    assert.ok(a.cycles.length >= 1, 'a card reachable from itself must be flagged');
    for (const c of a.cycles) assert.equal(c.provable, 'common', 'a cycle proves no depth');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the shipped example deck is honest — no overclaims, no cycles, no broken seals', () => {
  const a = auditDeck(new URL('./examples', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  assert.equal(a.overclaims.length, 0);
  assert.equal(a.cycles.length, 0);
  assert.equal(a.broken.length, 0);
  const quine = a.rows.find(r => r.name.includes('quine'));
  assert.ok(quine, 'the quine card ships in the deck');
  assert.equal(quine.depth, 1, 'the quine descends from the genesis card');
});

// ── reader conformance (CARD-SPEC §6 and §8) ────────────────────────────────────────
// The reader is a single HTML file, so we assert against its source: the safety
// properties are format requirements, not implementation taste.
const READER = readFileSync(new URL('./reader.html', import.meta.url), 'utf8');

test('reader conformance — hatching is sandboxed and never automatic', () => {
  assert.match(READER, /setAttribute\('sandbox','allow-scripts'\)/, 'the hatch iframe must be sandboxed');
  assert.ok(!/allow-same-origin/.test(READER), 'sandbox must NOT grant same-origin — a build must not reach the reader');
  // hatch must be bound to a user action, never called during load
  assert.match(READER, /onclick\s*=\s*hatch/, 'hatch must be bound to an explicit click');
  const loadFn = READER.slice(READER.indexOf('async function load('), READER.indexOf('function fail('));
  assert.ok(!/hatch\s*\(/.test(loadFn), 'load() must never invoke hatch()');
});

test('reader conformance — refuses to hatch on a seal mismatch', () => {
  assert.match(READER, /Refusing to hatch/, 'a mismatched card must be refused, not hatched');
});

test('reader implements the §7 fallback for stripped metadata', () => {
  assert.match(READER, /no-manifest/);
  assert.match(READER, /fall-registry/, 'the stripped-chunk fallback must be present');
});

test('the reading key decodes real tags into plain English', () => {
  // lift the reader's own key table + decoder and run it here, so the doc, the reader and
  // this assertion cannot drift apart silently.
  const src = READER.slice(READER.indexOf('const KEY = {'), READER.indexOf('// ── PNG chunk reading'));
  const decodeTags = new Function(`${src}; return decodeTags;`)();
  const lines = decodeTags('owl:high-left,rose:purple+red+blue:5,geo:depth3,wings:galaxy');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /witness-heavy/);
  assert.match(lines[1], /purple, red, blue/);
  assert.match(lines[1], /5 of 5/);
  assert.match(lines[2], /provenance depth 3/);
  assert.match(lines[3], /sovereign/);
  // an element outside the published vocabulary is named as unknown, never invented
  assert.match(decodeTags('sphinx:left')[0], /unknown element/);
});

test('forging is deterministic — same inputs, same seal', () => {
  const a = forge({ build: BUILD, image: IMAGE, tags: 'owl:high-left', forged: FORGED });
  const b = forge({ build: BUILD, image: IMAGE, tags: 'owl:high-left', forged: FORGED });
  assert.equal(a.manifest.seal, b.manifest.seal);
  assert.ok(a.png.equals(b.png), 'two forges of the same inputs must be byte-identical');
});
