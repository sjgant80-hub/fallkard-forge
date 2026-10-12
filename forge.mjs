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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync, deflateSync, inflateSync } from 'node:zlib';
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { validateComposition } from './studio.mjs';
import { signable, tierCheck } from './card.mjs';

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

// ── identity · Ed25519, made with node:crypto, interoperable with the page's crypto.subtle keys ──
// A public key travels as base64 of its raw 32 bytes — the same form the browser exports — so a card
// signed in a tab verifies at the command line and the other way round.
const rawPubB64 = (keyObject) => Buffer.from(keyObject.export({ format: 'jwk' }).x, 'base64url').toString('base64');

export function makeIdentity() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return identityFrom(privateKey, publicKey);
}
function identityFrom(privateKey, publicKey) {
  return {
    pubB64: rawPubB64(publicKey),
    sign: (message) => edSign(null, Buffer.from(String(message), 'utf8'), privateKey).toString('base64'),
    privateJwk: () => privateKey.export({ format: 'jwk' }),
  };
}
// Load an identity from a private-JWK file, creating one (mode 600) the first time. The private key
// never leaves this file and is never printed.
export function loadIdentity(path) {
  if (!existsSync(path)) {
    const id = makeIdentity();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(id.privateJwk()), { mode: 0o600 });
    return id;
  }
  const privateKey = createPrivateKey({ key: JSON.parse(readFileSync(path, 'utf8')), format: 'jwk' });
  return identityFrom(privateKey, createPublicKey(privateKey));
}

/** Verify an Ed25519 signature over `message`. Total: anything malformed is simply `false`. */
export function verifySignature(message, sigB64, pubB64) {
  try {
    const raw = Buffer.from(String(pubB64), 'base64');
    if (raw.length !== 32) return false;
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') }, format: 'jwk' });
    const sig = Buffer.from(String(sigB64), 'base64');
    if (sig.length !== 64) return false;
    return edVerify(null, Buffer.from(String(message), 'utf8'), key, sig);
  } catch { return false; }
}

// ── forge ──────────────────────────────────────────────────────────────────
// Returns { png, manifest }. The image bytes are untouched: only text chunks are
// inserted before IEND, so the rendered picture is pixel-identical.
//
// ⚑ THE TIER IS COMPUTED FROM THE BUILD, NEVER ASSERTED. The assessor is validateComposition — the
// same pure gate the page runs — applied to the build itself, so any reader can re-derive it from the
// payload. A forge stamps at most `uncommon`: depth is proven later by walking a real lineage
// (lineage.mjs), and `holo` needs a human reading-key attestation no machine can give. Passing a tier
// or its evidence in is refused, loudly — that is the hole this closes.
const ASSERTED = ['rarity', 'assessorPass', 'depth', 'readingKeyHonest'];

export function forge(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  for (const k of ASSERTED) {
    if (o[k] !== undefined) throw new Error(`the tier is computed from the build, never asserted — remove "${k}"`);
  }
  const { build, image, tags = '', parent = null, forged, sign, signer } = o;
  const buildBuf = Buffer.isBuffer(build) ? build : Buffer.from(build, 'utf8');
  const payload = gzipSync(buildBuf, { level: 9 });
  const seal = sha256(payload);
  const assessorPass = validateComposition(buildBuf.toString('utf8')).ok;

  const manifest = {
    v: SPEC_VERSION,
    seal,
    parent: parent || null,
    tags,
    rarity: rarity({ assessorPass, depth: 0, readingKeyHonest: false }),
    assessor_pass: assessorPass,
    forged: forged || new Date().toISOString().slice(0, 10),
    signer: (typeof sign === 'function' && signer) ? String(signer) : null,
  };
  // the signature covers the whole manifest (signer included) with the seal of the real payload
  if (manifest.signer) manifest.sig = String(sign(signable(manifest, seal)));

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
// Never executes anything, and never throws: a bad card is REFUSED with a reason, not crashed on.
// Returns the manifest, the verification result, the tier the build EARNS (re-derived here from the
// payload, never read off the manifest), and a hatch() the CALLER must choose to invoke.
//
//   ok  ⇔  the seal holds  AND  (the card is unsigned, or its Ed25519 signature verifies)
//
// The signature is checked against the seal of the payload actually held, so one flipped byte anywhere
// — payload or manifest — fails it. An unsigned card (forged before signing) still reads, and says so.
export function read(png) {
  const refuse = (reason, detail, manifest = null) => ({ ok: false, reason, detail, manifest, payload: null });
  let chunks;
  try { chunks = parseChunks(png); }
  catch (e) { return refuse('not-a-card', String((e && e.message) || e)); }

  let manifestRaw, payloadB64;
  try {
    manifestRaw = readTextChunk(chunks, MANIFEST_KEYWORD);
    payloadB64 = readTextChunk(chunks, PAYLOAD_KEYWORD);
  } catch {
    return refuse('seal-mismatch', 'a card chunk is corrupt and cannot be read — refused, not decoded');
  }

  if (!manifestRaw) return refuse('no-manifest', 'this PNG carries no manifest');
  let manifest;
  try { manifest = JSON.parse(manifestRaw); }
  catch { return refuse('bad-manifest', 'the manifest is not readable JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return refuse('bad-manifest', 'the manifest is not an object');

  if (!payloadB64) return refuse('no-payload', 'the build is missing', manifest);

  const payload = Buffer.from(payloadB64, 'base64');
  const actual = sha256(payload);
  const sealOk = actual === manifest.seal;

  const signed = !!(manifest.sig && manifest.signer);
  const sigOk = signed ? verifySignature(signable(manifest, actual), manifest.sig, manifest.signer) : null;

  // the EARNED tier: only from a payload whose seal holds — and a sealed payload that will not inflate
  // is a doctored card, refused like any other mismatch.
  let assessorEarned = null, earnedTier = null, check = null;
  if (sealOk) {
    try {
      assessorEarned = validateComposition(gunzipSync(payload).toString('utf8')).ok;
      earnedTier = rarity({ assessorPass: assessorEarned, depth: 0, readingKeyHonest: false });
      check = tierCheck(manifest.rarity, earnedTier);
    } catch {
      return { ...refuse('seal-mismatch', 'the sealed payload does not decompress — refused', manifest), actualSeal: actual };
    }
  }

  const ok = sealOk && sigOk !== false;
  return {
    ok,
    reason: !sealOk ? 'seal-mismatch' : sigOk === false ? 'signature-fails' : 'verified',
    manifest,
    payload,
    actualSeal: actual,
    signed, sigOk,
    assessorEarned, earnedTier, tierCheck: check,
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
    for (const flag of ['--rarity', '--assessor-pass', '--depth', '--reading-key-honest']) {
      if (argv.includes(flag)) {
        console.error(`refused: ${flag} — the tier is computed from the build (the sovereignty gate), never asserted`);
        process.exit(2);
      }
    }
    const buildPath = arg('--build'), imagePath = arg('--image'), out = arg('--out', 'card.png');
    const useArt = argv.includes('--art');
    if (!buildPath || (!imagePath && !useArt)) { console.error('usage: forge --build tool.html (--image card.png | --art) [--tags ...] [--parent sha|none] [--key identity.json] --out seal-000.png'); process.exit(2); }
    const id = loadIdentity(arg('--key', join(homedir(), '.fallkard', 'identity.json')));
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
      forged: arg('--forged'),
      sign: id.sign,
      signer: id.pubB64,
    });
    writeFileSync(out, png);
    console.log(`forged ${out}`);
    console.log(`  seal    ${manifest.seal}`);
    console.log(`  tier    ${manifest.rarity} (earned: the build ${manifest.assessor_pass ? 'passes' : 'does not pass'} the sovereignty gate)`);
    console.log(`  signer  ${manifest.signer}`);
    console.log(`  tags    ${manifest.tags || '(none)'}`);
    console.log(`  parent  ${manifest.parent || '(root)'}`);
    console.log(`  size    payload ${Buffer.from(readFileSync(buildPath)).length}b → card ${png.length}b`);
    return;
  }

  if (cmd === 'read') {
    const cardPath = argv[3];
    if (!cardPath) { console.error('usage: read <card.png> [--hatch out.html]'); process.exit(2); }
    const r = read(readFileSync(cardPath));
    console.log(`${r.ok ? '✓ VERIFIED' : '✗ ' + r.reason.toUpperCase()}${r.detail ? ' — ' + r.detail : ''}`);
    if (r.manifest) {
      console.log(`  seal    ${r.manifest.seal}`);
      if (!r.ok && r.actualSeal) console.log(`  actual  ${r.actualSeal}`);
      console.log(`  signed  ${r.signed ? (r.sigOk ? '✓ Ed25519 by ' + r.manifest.signer : '✗ SIGNATURE FAILS') : 'no — forged before signing'}`);
      if (r.earnedTier) {
        const note = r.tierCheck === 'overclaim' ? `  ✗ OVERCLAIM — the card says ${r.manifest.rarity}; this card alone proves ${r.earnedTier}` : '';
        console.log(`  tier    ${r.earnedTier} (earned from the build)${note}`);
      }
      console.log(`  tags    ${r.manifest.tags || '(none)'}`);
      console.log(`  parent  ${r.manifest.parent || '(root)'}`);
      console.log(`  forged  ${r.manifest.forged}`);
    }
    const hatchTo = arg('--hatch');
    if (hatchTo && r.ok) { writeFileSync(hatchTo, r.hatch()); console.log(`  hatched → ${hatchTo}`); }
    else if (hatchTo) console.log('  refused to hatch: the card did not verify');
    process.exit(r.ok ? 0 : 1);
  }

  console.error('fallkard-forge · commands: forge, read');
  process.exit(2);
}

// run only as a CLI, not when imported by tests
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) await cli(process.argv);
