// card.mjs — the card kernel, browser-shaped and pure.
//
// ⚑ WHY THIS EXISTS ALONGSIDE forge.mjs. The Node forge reaches for Buffer, zlib and node:crypto, so
// none of it can run in front of a person. This is the same logic over Uint8Array with the two
// impure steps — compressing and hashing — handed IN, because the browser already has both natively
// (CompressionStream and crypto.subtle) and shipping a copy of zlib would be worse than useless.
//
// ⚑ THE RARITY RULE IS LIFTED VERBATIM from forge.mjs. If the two ever disagree, a card forged in the
// browser and the same card forged at the command line would claim different tiers, and the tier is
// the one thing on a card that is supposed to be earned rather than asserted.
//
// Pure: no I/O, no clock, no crypto. Everything it needs is an argument.

export const SPEC_VERSION = '0.1';
export const PAYLOAD_KEYWORD = 'konomi-payload';
export const MANIFEST_KEYWORD = 'konomi-manifest';
export const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  const b = buf || [];
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const NUL = String.fromCharCode(0);
const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
const bytes = (str) => { const u = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xFF; return u; };
export { latin1, bytes };

export function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Walk a PNG into its chunks.
 *
 * ⚑ A TRUNCATED FILE IS REFUSED, NOT PARTIALLY READ. A card whose IEND never arrives is a broken
 * download or a doctored file, and returning "what we managed to read" from either is how a corrupt
 * card gets treated as a real one.
 */
export function parseChunks(png) {
  const u8 = (png instanceof Uint8Array) ? png : new Uint8Array(png || []);
  if (u8.length < 8) throw new Error('not a PNG (too short)');
  for (let i = 0; i < 8; i++) if (u8[i] !== PNG_SIG[i]) throw new Error('not a PNG (bad signature)');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const chunks = [];
  let off = 8, sawEnd = false;
  while (off + 8 <= u8.length) {
    const length = dv.getUint32(off);
    if (off + 12 + length > u8.length) throw new Error('PNG is truncated — a chunk runs past the end of the file');
    const type = latin1(u8.subarray(off + 4, off + 8));
    chunks.push({ type, data: u8.subarray(off + 8, off + 8 + length) });
    off += 12 + length;
    if (type === 'IEND') { sawEnd = true; break; }
  }
  if (!sawEnd) throw new Error('PNG is truncated — it has no IEND');
  return chunks;
}

export function makeChunk(type, data) {
  const d = data || new Uint8Array(0);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, d.length);
  const typeAndData = concat([bytes(type), d]);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(typeAndData));
  return concat([len, typeAndData, crc]);
}

export function serialise(chunks) {
  return concat([PNG_SIG, ...(Array.isArray(chunks) ? chunks : []).map(c => makeChunk(c.type, c.data))]);
}

/** A tEXt chunk is keyword, a NUL, then the value. */
export function textChunk(keyword, value) {
  return { type: 'tEXt', data: concat([bytes(String(keyword)), new Uint8Array([0]), bytes(String(value))]) };
}

/** Read a tEXt chunk back by keyword. Returns null when it is simply not there. */
export function readText(chunks, keyword) {
  // Array.isArray, not a truthiness guard: a plain object is truthy and NOT iterable, so the old
  // fallback threw on the one input a reader is most likely to be handed by mistake.
  for (const c of (Array.isArray(chunks) ? chunks : [])) {
    if (!c || c.type !== 'tEXt') continue;
    const s = latin1(c.data);
    const nul = s.indexOf(NUL);
    if (nul < 0) continue;
    if (s.slice(0, nul) === String(keyword)) return s.slice(nul + 1);
  }
  return null;
}

/**
 * ⚑ THE TIER IS COMPUTED, NEVER ASSERTED — lifted verbatim from forge.mjs.
 * Passing the assessor is the floor; depth is how far down a real lineage it sits.
 */
export function rarity(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const assessorPass = !!o.assessorPass;
  const depth = Number(o.depth) || 0;
  const readingKeyHonest = !!o.readingKeyHonest;
  if (assessorPass && depth >= 3 && readingKeyHonest) return 'holo';
  if (assessorPass && depth >= 2) return 'rare';
  if (assessorPass) return 'uncommon';
  return 'common';
}

/**
 * Build the manifest that rides on the card. `seal` is the hash of the COMPRESSED payload, computed
 * by the caller — this kernel never hashes anything itself, so it can be tested without crypto.
 */
export function manifestFor(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  return {
    v: SPEC_VERSION,
    seal: String(o.seal || ''),
    parent: o.parent || null,
    tags: String(o.tags || ''),
    rarity: o.rarity || rarity(o),
    assessor_pass: !!o.assessorPass,
    forged: String(o.forged || ''),
  };
}

/**
 * Put a build inside a PNG.
 *
 * `image` is any PNG; `payloadB64` is the already-compressed build, base64'd; `manifest` is the
 * object above. Re-forging is idempotent: prior card chunks are dropped first, so a card forged
 * twice carries one payload rather than two and cannot end up with a stale seal beside a fresh one.
 */
export function embed(image, payloadB64, manifest) {
  const chunks = parseChunks(image);
  const iend = chunks.findIndex(c => c.type === 'IEND');
  if (iend < 0) throw new Error('PNG has no IEND chunk');

  const kept = chunks.filter((c, i) => {
    if (i === iend) return true;
    if (c.type !== 'tEXt' && c.type !== 'zTXt') return true;
    const kw = latin1(c.data).split(NUL)[0];
    return kw !== PAYLOAD_KEYWORD && kw !== MANIFEST_KEYWORD;
  });

  const out = kept.slice(0, kept.length - 1).concat([
    textChunk(MANIFEST_KEYWORD, JSON.stringify(manifest)),
    textChunk(PAYLOAD_KEYWORD, String(payloadB64 || '')),
    kept[kept.length - 1],
  ]);
  return serialise(out);
}

/**
 * Read a card back out. Returns what is there and what is missing — it does NOT verify the seal,
 * because that needs a hash and this kernel takes no crypto. The caller checks the seal and is
 * given `sealedOver` so it knows exactly which bytes to hash.
 */
export function read(png) {
  const chunks = parseChunks(png);
  const manifestRaw = readText(chunks, MANIFEST_KEYWORD);
  const payloadB64 = readText(chunks, PAYLOAD_KEYWORD);
  let manifest = null, malformed = false;
  if (manifestRaw != null) {
    try { manifest = JSON.parse(manifestRaw); } catch { malformed = true; }
  }
  return {
    isCard: manifest != null && payloadB64 != null,
    manifest, payloadB64,
    malformedManifest: malformed,
    reason: manifest == null && payloadB64 == null ? 'this is a plain PNG — it carries no build'
      : malformed ? 'the manifest on this card is not readable JSON'
      : payloadB64 == null ? 'it has a manifest but no payload — the build is missing'
      : manifest == null ? 'it has a payload but no manifest — nothing says what it is'
      : 'it carries a build and a manifest',
  };
}

export default {
  SPEC_VERSION, PAYLOAD_KEYWORD, MANIFEST_KEYWORD, PNG_SIG,
  crc32, parseChunks, makeChunk, serialise, textChunk, readText,
  rarity, manifestFor, embed, read, concat, latin1, bytes,
};
