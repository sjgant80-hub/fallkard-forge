#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// fallkard-forge · Mode B · the card that openly carries a real build
//
// The payload is DECLARED, never hidden. Real bytes ride in standard PNG text
// chunks (zTXt/tEXt) — a documented part of the PNG format that any tool can list.
// There is no pixel steganography here and there must never be: the output is
// pixel-identical to the input image, and the manifest announces exactly what the
// card carries. Concealment is not a feature of this format; fluency is.
//
//   konomi-payload   zTXt   base64(gzip(build.html))
//   konomi-manifest  tEXt   JSON manifest (see CARD-SPEC.md)
//
// Zero dependencies — node:zlib, node:crypto, node:fs only.
// ════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync, deflateSync, inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const SPEC_VERSION = '0.1';
export const PAYLOAD_KEYWORD = 'konomi-payload';
export const MANIFEST_KEYWORD = 'konomi-manifest';

// PNG chunk primitives live in png.mjs so art.mjs can share them without importing this
// module (a cycle deadlocks under top-level await). Re-exported: they are part of the API.
export { parseChunks, makeChunk, serialise, crc32, PNG_SIG } from './png.mjs';
import { parseChunks, serialise } from './png.mjs';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// tEXt = keyword \0 text (Latin-1, uncompressed)
const tEXt = (keyword, text) =>
  ({ type: 'tEXt', data: Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]) });

// zTXt = keyword \0 compressionMethod(0) zlib(text)
const zTXt = (keyword, text) =>
  ({ type: 'zTXt', data: Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0]), deflateSync(Buffer.from(text, 'latin1'))]) });

function readTextChunk(chunks, keyword) {
  for (const c of chunks) {
    if (c.type !== 'tEXt' && c.type !== 'zTXt') continue;
    const nul = c.data.indexOf(0);
    if (nul < 0) continue;
    if (c.data.toString('latin1', 0, nul) !== keyword) continue;
    if (c.type === 'tEXt') return c.data.toString('latin1', nul + 1);
    // zTXt: skip the NUL and the 1-byte compression method
    return inflateSync(c.data.subarray(nul + 2)).toString('latin1');
  }
  return null;
}

// ── forge ──────────────────────────────────────────────────────────────────
// Returns { png, manifest }. The image bytes are untouched: only text chunks are
// inserted before IEND, so the rendered picture is pixel-identical.
export function forge({ build, image, tags = '', parent = null, assessorPass = false, forged, rarity: rarityOverride, depth = 0, readingKeyHonest = false }) {
  const buildBuf = Buffer.isBuffer(build) ? build : Buffer.from(build, 'utf8');
  const payload = gzipSync(buildBuf, { level: 9 });
  const seal = sha256(payload);

  const manifest = {
    v: SPEC_VERSION,
    seal,
    parent: parent || null,
    tags,
    // the EARNED tier, computed — never just asserted. An override is honoured only when
    // given explicitly (e.g. re-stamping a card whose lineage depth was walked later).
    rarity: rarityOverride || rarity({ assessorPass: !!assessorPass, depth, readingKeyHonest }),
    assessor_pass: !!assessorPass,
    forged: forged || new Date().toISOString().slice(0, 10),
  };

  const chunks = parseChunks(image);
  const iend = chunks.findIndex(c => c.type === 'IEND');
  if (iend < 0) throw new Error('PNG has no IEND chunk');

  // drop any prior card chunks so re-forging is idempotent, then insert before IEND
  const kept = chunks.filter((c, i) => {
    if (i === iend) return true;
    if (c.type !== 'tEXt' && c.type !== 'zTXt') return true;
    const nul = c.data.indexOf(0);
    const kw = nul > 0 ? c.data.toString('latin1', 0, nul) : '';
    return kw !== PAYLOAD_KEYWORD && kw !== MANIFEST_KEYWORD;
  });
  const at = kept.findIndex(c => c.type === 'IEND');
  kept.splice(at, 0, zTXt(PAYLOAD_KEYWORD, payload.toString('base64')), tEXt(MANIFEST_KEYWORD, JSON.stringify(manifest)));

  return { png: serialise(kept), manifest };
}

// ── read ───────────────────────────────────────────────────────────────────
// Never executes anything. Returns the manifest, the verification result, and a
// hatch() the CALLER must choose to invoke.
export function read(png) {
  const chunks = parseChunks(png);
  const manifestRaw = readTextChunk(chunks, MANIFEST_KEYWORD);
  const payloadB64 = readTextChunk(chunks, PAYLOAD_KEYWORD);

  if (!manifestRaw) return { ok: false, reason: 'no-manifest', manifest: null, payload: null };
  let manifest;
  try { manifest = JSON.parse(manifestRaw); }
  catch { return { ok: false, reason: 'bad-manifest', manifest: null, payload: null }; }

  if (!payloadB64) return { ok: false, reason: 'no-payload', manifest, payload: null };

  const payload = Buffer.from(payloadB64, 'base64');
  const actual = sha256(payload);
  const ok = actual === manifest.seal;

  return {
    ok,
    reason: ok ? 'verified' : 'seal-mismatch',
    manifest,
    payload,
    actualSeal: actual,
    hatch: () => gunzipSync(payload).toString('utf8'),   // explicit, caller-initiated
  };
}

// ── rarity · earned and verifiable, never manufactured ─────────────────────
// depth is walked from parent links by the caller (it needs the card graph).
export function rarity({ assessorPass = false, depth = 0, readingKeyHonest = false }) {
  if (assessorPass && depth >= 3 && readingKeyHonest) return 'holo';
  if (assessorPass && depth >= 2) return 'rare';
  if (assessorPass) return 'uncommon';
  return 'common';
}

// ── CLI ────────────────────────────────────────────────────────────────────
async function cli(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const cmd = argv[2];

  if (cmd === 'forge') {
    const buildPath = arg('--build'), imagePath = arg('--image'), out = arg('--out', 'card.png');
    const useArt = argv.includes('--art');
    if (!buildPath || (!imagePath && !useArt)) { console.error('usage: forge --build tool.html (--image card.png | --art) [--tags ...] [--parent sha|none] [--assessor-pass] --out seal-000.png'); process.exit(2); }
    const parentArg = arg('--parent', 'none');
    const tags = arg('--tags', '');

    // --art: generate THE EYE from the same reading key that goes into the manifest, so the
    // picture cannot contradict its own declared tags. Seeded by the seal, which depends only
    // on the payload — so it is known before the image exists.
    let imageBuf;
    if (useArt) {
      const seal = sha256(gzipSync(readFileSync(buildPath), { level: 9 }));
      const { renderCard } = await import('./art.mjs');
      imageBuf = renderCard({ tags, seal });
    } else {
      imageBuf = readFileSync(imagePath);
    }

    const { png, manifest } = forge({
      build: readFileSync(buildPath),
      image: imageBuf,
      tags,
      parent: parentArg === 'none' ? null : parentArg,
      assessorPass: argv.includes('--assessor-pass'),
      forged: arg('--forged'),
      rarity: arg('--rarity'),
    });
    writeFileSync(out, png);
    console.log(`forged ${out}`);
    console.log(`  seal    ${manifest.seal}`);
    console.log(`  tags    ${manifest.tags || '(none)'}`);
    console.log(`  parent  ${manifest.parent || '(root)'}`);
    console.log(`  size    payload ${Buffer.from(readFileSync(buildPath)).length}b → card ${png.length}b`);
    return;
  }

  if (cmd === 'read') {
    const cardPath = argv[3];
    if (!cardPath) { console.error('usage: read <card.png> [--hatch out.html]'); process.exit(2); }
    const r = read(readFileSync(cardPath));
    console.log(`${r.ok ? '✓ VERIFIED' : '✗ ' + r.reason.toUpperCase()}`);
    if (r.manifest) {
      console.log(`  seal    ${r.manifest.seal}`);
      if (!r.ok && r.actualSeal) console.log(`  actual  ${r.actualSeal}`);
      console.log(`  tags    ${r.manifest.tags || '(none)'}`);
      console.log(`  parent  ${r.manifest.parent || '(root)'}`);
      console.log(`  rarity  ${r.manifest.rarity}  assessor_pass=${r.manifest.assessor_pass}  forged=${r.manifest.forged}`);
    }
    const hatchTo = arg('--hatch');
    if (hatchTo && r.ok) { writeFileSync(hatchTo, r.hatch()); console.log(`  hatched → ${hatchTo}`); }
    else if (hatchTo) console.log('  refused to hatch: seal did not verify');
    process.exit(r.ok ? 0 : 1);
  }

  console.error('fallkard-forge · commands: forge, read');
  process.exit(2);
}

// run only as a CLI, not when imported by tests
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) await cli(process.argv);
