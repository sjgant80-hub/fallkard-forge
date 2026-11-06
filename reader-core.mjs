// reader-core.mjs — what the standalone reader (reader.html) decides about a card, and the only place its verdict is
// worded. Inlined verbatim into reader.html by scripts/build-page.mjs, so the code the mutation gate attacks is the
// code a browser runs.
//
// ⚑ WHY THIS EXISTS. reader.html used to be hand-written. It printed "VERIFIED — seal matches the payload" without
// ever looking at the Ed25519 signature, showed the tier the card CLAIMED, and put card text into the page unescaped.
// The CLI (forge.mjs read) did all three properly, so two readers of the same format disagreed about the same card.
// This module makes the reader's judgement the CLI's: seal re-computed from the payload held → signature checked over
// signable(manifest, THAT seal) → build inflated under a cap → tier re-derived by the sovereignty gate.
//
// It uses only what a browser and Node both have as globals: crypto.subtle, DecompressionStream, atob, TextDecoder.

import { read, signable, rarity, tierCheck, TIER_ORDER, latin1, concat } from './card.mjs';
import { validateComposition } from './studio.mjs';

// a card is untrusted input: every text it carries is escaped at the sink, never trusted as markup
export const esc = (v) => (v == null ? '' : String(v)).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// A small payload can be built to inflate enormously, so decompression stops at a cap (CARD-SPEC §8.7).
export const MAX_PAYLOAD_B64 = 12 * 1024 * 1024;   // characters of base64 a zTXt payload may inflate to
export const MAX_BUILD = 8 * 1024 * 1024;          // bytes a build may inflate to

export async function inflateCapped(u8, format, max) {
  const ds = new DecompressionStream(format);
  const w = ds.writable.getWriter(); w.write(u8).catch(() => {}); w.close().catch(() => {});
  const rd = ds.readable.getReader(); const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    if (n > max) { rd.cancel().catch(() => {}); throw new Error('it inflates past the cap'); }
    parts.push(value);
  }
  return concat(parts);
}
export const sha256hex = async (u8) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', u8)))
  .map((x) => x.toString(16).padStart(2, '0')).join('');
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ⚑ "CANNOT CHECK" IS NOT "FAILS", AND IT IS NEVER "VERIFIED". A browser without Ed25519 in WebCrypto can still
// re-compute the seal, but it cannot say who signed — so it says exactly that, and a signed card is not accepted
// on the seal alone (CARD-SPEC §3.1). Support is probed once, by making a throwaway key.
let edSupport = null;
export async function ed25519Supported() {
  if (edSupport === null) {
    try { await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); edSupport = true; }
    catch { edSupport = false; }
  }
  return edSupport;
}
// Verify like forge.mjs's verifySignature: total — a malformed key or signature is simply false.
export async function ed25519Verify(message, sigB64, pubB64) {
  try {
    const raw = unb64(String(pubB64)), sig = unb64(String(sigB64));
    // two statements, not one `||`: each wrong length is its own refusal, and each is pinned by its own test
    if (raw.length !== 32) return false;
    if (sig.length !== 64) return false;
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    return (await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, new TextEncoder().encode(String(message)))) === true;
  } catch { return false; }
}

/**
 * The reader's whole judgement of one file. Never throws; never runs the build.
 * `env` lets a test stand in for a browser with no Ed25519 (`edSupported: false`) or set smaller caps.
 */
export async function judge(u8, env) {
  const e = (env && typeof env === 'object') ? env : {};
  const maxB64 = e.maxPayloadB64 || MAX_PAYLOAD_B64, maxBuild = e.maxBuild || MAX_BUILD;
  const out = { stage: 'card', manifest: null, payload: null, text: '', actual: null, sealOk: false,
    signed: false, sigChecked: false, sigOk: null, earned: 'common', claim: null, gate: null };
  let r;
  try { r = read(u8); }
  catch { return { ...out, stage: 'not-a-png' }; }
  if (r.malformedManifest) return { ...out, stage: 'bad-manifest' };
  if (r.manifest == null) return { ...out, stage: 'no-manifest' };
  const m = r.manifest;
  if (typeof m !== 'object' || Array.isArray(m)) return { ...out, stage: 'bad-manifest' };
  let payloadB64 = r.payloadB64;
  if (payloadB64 == null && r.payloadZ) {
    // the CLI writes its payload as zTXt (CARD-SPEC §2): inflate it, capped, before anything else is done with it
    try { payloadB64 = latin1(await inflateCapped(r.payloadZ, 'deflate', maxB64)).trim(); }
    catch { return { ...out, manifest: m, stage: 'no-inflate' }; }
  }
  if (payloadB64 == null) return { ...out, manifest: m, stage: 'no-payload' };
  let payload;
  try { payload = unb64(payloadB64); } catch { return { ...out, manifest: m, stage: 'not-base64' }; }

  // ⚑ THE SEAL IS RE-COMPUTED, NEVER READ BACK AND BELIEVED
  const actual = await sha256hex(payload);
  const sealOk = actual === m.seal;

  // ⚑ THE SIGNATURE IS CHECKED AGAINST THE PAYLOAD HELD — signable() puts OUR computed seal in, so one changed byte
  // anywhere, payload or manifest, fails it
  const signed = !!(m.sig && m.signer);
  const sigChecked = signed && (e.edSupported === undefined ? await ed25519Supported() : e.edSupported === true);
  const sigOk = sigChecked ? await ed25519Verify(signable(m, actual), m.sig, m.signer) : null;
  const known = { ...out, manifest: m, payload, actual, sealOk, signed, sigChecked, sigOk };
  if (!sealOk) return known;

  // ⚑ THE TIER IS RE-DERIVED FROM THE BUILD — only from a payload whose seal holds; a sealed payload that will not
  // inflate is a doctored card, refused like any other mismatch (forge.mjs read() does the same)
  let text;
  try { text = new TextDecoder().decode(await inflateCapped(payload, 'gzip', maxBuild)); }
  catch { return { ...known, stage: 'no-decompress' }; }
  const gate = validateComposition(text);
  const earned = rarity({ assessorPass: gate.ok, depth: 0, readingKeyHonest: false });
  return { ...known, text, gate, earned, claim: tierCheck(m.rarity, earned) };
}

export const STRIPPED_WHY = 'This picture carries no manifest chunk — a platform may have stripped it on upload. '
  + 'Per CARD-SPEC §7 the card\'s printed seal still finds it: open the Forge at https://sjgant80-hub.github.io/fallkard-forge/ and drop '
  + 'this picture into "Read one back". It reads the seal off the pixels and finds the build in your deck on that device, then '
  + 'checks it against the full seal. This standalone reader keeps no deck; a local manifest file or fall-registry lookup is the '
  + 'other route §7 allows, and neither is wired in here.';

/** What the reader may say about a judgement, and whether it may hatch. */
export function verdictOf(j) {
  const s = (j && typeof j === 'object') ? j.stage : undefined;
  const no = (text, why) => ({ cls: 'bad', text, hatch: false, why });
  if (s === 'not-a-png') return no('✗ NOT A PNG', '');
  if (s === 'no-manifest') return no('✗ NO-MANIFEST', STRIPPED_WHY);
  if (s === 'bad-manifest') return no('✗ BAD-MANIFEST', 'The manifest is not a readable JSON object.');
  if (s === 'no-payload') return no('✗ NO-PAYLOAD', 'The manifest is present but the payload chunk is gone.');
  if (s === 'no-inflate') return no('✗ PAYLOAD WILL NOT INFLATE', 'Refusing to hatch: the compressed payload chunk would not inflate within the cap.');
  if (s === 'not-base64') return no('✗ PAYLOAD IS NOT BASE64', 'Refusing to hatch: the payload chunk is not base64.');
  if (s === 'no-decompress') return no('✗ THE SEALED PAYLOAD WILL NOT DECOMPRESS', 'Refusing to hatch: the payload matches its seal but does not decompress — a doctored card.');
  if (s !== 'card') return no('✗ UNREADABLE', '');
  if (j.sealOk !== true) return no('✗ SEAL MISMATCH — this card has been tampered with', 'Refusing to hatch: the payload does not match its seal.');
  if (j.signed && j.sigChecked && j.sigOk !== true) return no('✗ SIGNATURE FAILS — these bytes are not what the named key signed',
    'Refusing to hatch: the card names a signer, and the signature does not match this payload and manifest.');
  if (j.signed && !j.sigChecked) return { cls: 'unsure', hatch: false, text: '⚠ SEAL MATCHES — signature NOT checked: this browser has no Ed25519',
    why: 'Refusing to hatch: this card is signed, and a signed card is accepted only when the signature verifies (CARD-SPEC §3.1). '
      + 'Open it in a browser with Ed25519 in WebCrypto (current Chrome, Edge, Firefox or Safari), or run `node forge.mjs read card.png`.' };
  if (j.signed) return { cls: 'ok', hatch: true, text: '✓ VERIFIED — seal matches the payload, and the Ed25519 signature checks', why: '' };
  return { cls: 'ok', hatch: true, text: '✓ SEAL MATCHES — unsigned: no key vouches for who forged it', why: '' };
}

const tierClass = (t) => (TIER_ORDER.includes(t) ? t : 'common');
const row = (k, v) => `<div class="row"><b>${esc(k)}</b><span>${esc(v)}</span></div>`;     // v is ALWAYS escaped
const rowMarkup = (k, html) => `<div class="row"><b>${esc(k)}</b><span>${html}</span></div>`; // only markup built here
export const tierChip = (t) => `<span class="tier ${tierClass(t)}">${tierClass(t)}</span>`;

/** The rows the reader shows. Every value a card carries goes through esc(); the tier chip is built from TIER_ORDER. */
export function factsHtml(j) {
  const m = (j && typeof j === 'object' && j.manifest && typeof j.manifest === 'object') ? j.manifest : null;
  if (!m) return '';
  let h = row('seal', m.seal || '—');
  if (j.actual && j.actual !== m.seal) h += row('actual', j.actual);
  if (j.stage === 'card' || j.stage === 'no-decompress') {
    h += row('signed', !j.signed ? 'no — no key vouches for who forged it'
      : !j.sigChecked ? 'names ' + String(m.signer).slice(0, 12) + '… — not checked in this browser'
      : j.sigOk === true ? '✓ Ed25519 · ' + String(m.signer).slice(0, 12) + '…'
      : '✗ the signature does not match these bytes');
  }
  if (j.stage === 'card' && j.sealOk === true) {
    h += rowMarkup('tier', tierChip(j.earned) + ' ' + esc(j.claim === 'overclaim'
      ? 'overclaim: the card says ' + m.rarity + '; its build earns ' + j.earned
      : 'earned by the build, re-checked here'));
    if (j.gate && j.gate.ok === false) h += row('gate', j.gate.reasons.join('; '));
  }
  h += row('parent', m.parent || '(root)');
  h += row('tags', m.tags || '(none)');
  h += row('forged', m.forged || '—');
  h += row('spec', 'v' + (m.v || '?'));
  return h;
}

/** The reading key, decoded by the reader's own table (handed in) — each line is card text, so each is escaped. */
export function keyHtml(tags, decode) {
  let items = [];
  try { items = typeof decode === 'function' ? decode(tags) : []; } catch { items = []; }
  return Array.isArray(items) && items.length ? items.map((t) => `<li>${esc(t)}</li>`).join('') : '<li class="muted">This card declares no composition tags.</li>';
}

export default { esc, MAX_PAYLOAD_B64, MAX_BUILD, inflateCapped, sha256hex, ed25519Supported, ed25519Verify, judge, STRIPPED_WHY, verdictOf, tierChip, factsHtml, keyHtml };
