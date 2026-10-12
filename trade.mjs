// trade.mjs — moving a card from one device to another with no server in the path (MESH step 2).
//
// Two devices pair by swapping an invite and a reply by hand (fall-os's link, fall-federate's invite check); the
// cards then travel straight across a WebRTC DataChannel. This kernel is the pure part of that, gated on its own:
//
//   cardParts / makeAssembler — a card (as base64) is cut into bounded parts and put back together on arrival.
//       A paired peer is still untrusted input: at most LIMITS.inFlight cards half-arrived at once (the oldest
//       is dropped first), at most LIMITS.parts parts of at most LIMITS.chunk characters each, and a part that
//       contradicts the card it claims to belong to is ignored, never merged.
//   helloText — the exact text each device signs to PROVE it holds the key its invite names. An invite only
//       CLAIMS a key; until the other side has signed a fresh challenge with it, the sender is unproven, and a
//       card is never described as "signed by the device that sent it" on the strength of a claim. The text binds
//       the challenge to THIS link's two DTLS certificate fingerprints (fingerprintOf): a device paired with two
//       others cannot relay one's proof to the other, because it cannot present the first one's certificate on
//       the second link (found by the adversarial review — a key-only proof could be relayed).
//   admit — what the receiving device may show, decided in order: transit → parse → seal → signature →
//       accepted. Nothing that fails a step is shown: no picture, no build. CLAUDE.md rule 3 — a seal
//       mismatch is refused, never warned-and-continued.
//
// The impure steps (base64, sha256, reading the card, Ed25519, the link) belong to the page and are handed in as
// facts. Total: garbage in gives a refusal or an empty list, never a throw. MIT.
// Powered by the Konomi Architecture, created by Thomas Frumkin.

export const LIMITS = Object.freeze({ chunk: 12000, parts: 64, inFlight: 4, label: 40, id: 32 });
export const MAX_CARD_B64 = LIMITS.chunk * LIMITS.parts;
export const TRADE_STAGES = Object.freeze(['transit', 'parse', 'seal', 'signature', 'accepted']);
export const HELLO_TAG = 'fallkard-forge trade hello v1';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX32 = /^[0-9a-f]{32}$/;
// a 32-byte Ed25519 key, canonically encoded: 43 base64 characters (the last holds 4 bits, its low 2 zero), then '='
const KEY_B64 = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const KEY_URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= LIMITS.id;
const labelOf = (v) => (typeof v === 'string' ? v.slice(0, LIMITS.label) : 'card');

/** A card already in base64 → the messages that carry it, or [] if any input is out of bounds. */
export function cardParts(b64, id, sha, label) {
  if (typeof b64 !== 'string' || b64.length === 0 || b64.length > MAX_CARD_B64) return [];
  if (!isId(id) || typeof sha !== 'string' || !HEX64.test(sha)) return [];
  const n = Math.ceil(b64.length / LIMITS.chunk);
  return Array.from({ length: n }, (_, i) => ({ t: 'card', id, i, n, sha, label: labelOf(label),
    part: b64.slice(i * LIMITS.chunk, (i + 1) * LIMITS.chunk) }));
}

/**
 * One device's reassembly buffer. feed(msg) returns null until a card is whole, then { id, b64, sentSha, label }.
 * The sender's sha is what the page checks the reassembled bytes against; the assembler only keeps the parts honest.
 */
export function makeAssembler() {
  const pending = new Map();                       // insertion order = age, so the first key is the oldest
  return function feed(msg) {
    if (!msg || typeof msg !== 'object' || msg.t !== 'card') return null;
    const { id, i, n, part, sha } = msg;
    if (!isId(id) || typeof sha !== 'string' || !HEX64.test(sha)) return null;
    // n ≥ 1 needs no check of its own: 0 ≤ i < n below refuses n ≤ 0. A non-integer n must be refused HERE, before
    // it takes an in-flight slot (it could never complete, but it would push a real card out).
    if (!Number.isInteger(n) || n > LIMITS.parts) return null;
    if (!Number.isInteger(i) || i < 0 || i >= n) return null;
    if (typeof part !== 'string' || part.length === 0 || part.length > LIMITS.chunk) return null;
    let p = pending.get(id);
    if (!p) {
      if (pending.size >= LIMITS.inFlight) pending.delete(pending.keys().next().value);
      p = { n, sha, label: labelOf(msg.label), got: new Map() };
      pending.set(id, p);
    }
    if (p.n !== n || p.sha !== sha || p.got.has(i)) return null;   // contradicts its own card, or a repeat: ignored
    p.got.set(i, part);
    if (p.got.size !== p.n) return null;
    pending.delete(id);
    return { id, sentSha: p.sha, label: p.label, b64: Array.from({ length: p.n }, (_, k) => p.got.get(k)).join('') };
  };
}

/** A builder key (standard base64, 32 bytes) → the invite id fall-federate carries (base64url, no padding). */
export function inviteIdOf(keyB64) {
  if (typeof keyB64 !== 'string' || !KEY_B64.test(keyB64)) return null;
  return keyB64.slice(0, 43).replace(/\+/g, '-').replace(/\//g, '_');
}
/** An invite id → the builder key it CLAIMS (standard base64), or null. A claim, until helloText is signed. */
export function keyOfInviteId(id) {
  if (typeof id !== 'string' || !KEY_URL.test(id)) return null;
  return id.replace(/-/g, '+').replace(/_/g, '/') + '=';
}

const FP = /^sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const FP_LINE = /^a=fingerprint:sha-256 ((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})[ \t]*\r?$/gm;

/**
 * The one DTLS certificate fingerprint an SDP commits to ('sha-256 AB:CD:…', upper case), or null if it states
 * none, or states more than one different one (ambiguous — nothing is bound to a guess).
 */
export function fingerprintOf(sdp) {
  if (typeof sdp !== 'string' || sdp.length > 100000) return null;
  const seen = new Set(Array.from(sdp.matchAll(FP_LINE), (m) => 'sha-256 ' + m[1].toUpperCase()));
  return seen.size === 1 ? [...seen][0] : null;
}

/**
 * The text a device signs to prove it holds `proverKey`, answering `verifierKey`'s fresh challenge on one link.
 * Both keys are in it, so a proof made for one pairing cannot be replayed into another; the nonce is the verifier's,
 * so it cannot be replayed later; and both ends' DTLS fingerprints are in it, so it cannot be relayed onto another
 * link. null if any part is malformed (and nothing is then signed or believed).
 */
export function helloText(nonceHex, proverKey, verifierKey, proverFp, verifierFp) {
  if (typeof nonceHex !== 'string' || !HEX32.test(nonceHex)) return null;
  if (typeof proverKey !== 'string' || !KEY_B64.test(proverKey)) return null;
  if (typeof verifierKey !== 'string' || !KEY_B64.test(verifierKey)) return null;
  if (typeof proverFp !== 'string' || !FP.test(proverFp) || typeof verifierFp !== 'string' || !FP.test(verifierFp)) return null;
  if (proverFp === verifierFp) return null;            // two ends of one link never share a certificate
  return [HELLO_TAG, nonceHex, proverKey, verifierKey, proverFp, verifierFp].join('|');
}

/**
 * What a receiving device may show. facts (all computed by the page, on the bytes it actually received):
 *   intact       — the reassembled bytes hash to the sha the sender sent
 *   isCard       — the bytes read as a card (manifest + payload chunks); notCardWhy says why not
 *   sealOk       — sha256 of the payload found == the seal the manifest claims (re-computed, never read back)
 *   signed/sigOk — the manifest names a signer, and the signature verifies over the bytes held here
 *   signer       — the manifest's signer key; sender — the peer's key from its invite; senderProven — it signed
 *                  this device's challenge with that key, bound to this link (helloText)
 * from: 'sender' (signed by the device that sent it, proven) · 'claimed' (signed by the key its invite named, not yet
 * proven — not credited) · 'other' (signed by some other key: a card passed on) · 'unsigned'
 */
export function admit(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  if (f.intact !== true) return { show: false, stage: 'transit', reason: 'the picture changed on the way — its bytes are not the bytes that were sent' };
  if (f.isCard !== true) return { show: false, stage: 'parse', reason: 'not a card' + (typeof f.notCardWhy === 'string' ? ' — ' + f.notCardWhy : '') };
  if (f.sealOk !== true) return { show: false, stage: 'seal', reason: 'the build inside is not the build that was sealed — refused, nothing shown' };
  if (f.signed === true && f.sigOk !== true) return { show: false, stage: 'signature', reason: 'these bytes are not what the named key signed — refused, nothing shown' };
  // who it is from — each reason states only what was checked here
  if (f.signed !== true) return { show: true, stage: 'accepted', from: 'unsigned', reason: 'the seal re-computed here matches; the card is unsigned — no key vouches for who forged it' };
  if (f.signer !== f.sender) return { show: true, stage: 'accepted', from: 'other', reason: 'the seal re-computed here matches, and the signature verifies — signed by a key other than the one the sender named: a card it holds, passed on' };
  if (f.senderProven === true) return { show: true, stage: 'accepted', from: 'sender', reason: 'the seal re-computed here matches, and it is signed by the device that sent it (that device proved its key on this link)' };
  return { show: true, stage: 'accepted', from: 'claimed', reason: 'the seal re-computed here matches, and the signature verifies — signed by the key the sender named, but the sender has not proven it holds that key, so it is not credited' };
}
