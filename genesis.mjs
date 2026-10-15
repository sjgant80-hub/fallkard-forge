// genesis.mjs · the Genesis series: claim gate, edition inside the seal, batch forge with a re-check per card.
// MIT. Pure Node, no network. The edition is written INTO the build (so the sha256 seal covers it) and into
// the manifest (so the Ed25519 signature covers it); readGenesis refuses a card where the two disagree.
import { gzipSync } from 'node:zlib';
import { forge, read, sha256 } from './forge.mjs';

export const SERIES = 'genesis';
export const EDITION_OF = 1000;

// ── claim gate ─────────────────────────────────────────────────────────────
// Only claims that can be re-run today. Anything matching FORBIDDEN is held at κ until it has receipts.
export const ALLOWED_CLAIMS = Object.freeze([
  're-run it yourself',
  'verified patterns',
  'the gate',
  'germination',
  'ed25519 seal',
  'runs on your device',
  'no central host',
]);
export const FORBIDDEN = Object.freeze([
  /self[\s-]*aware/i, /\u03a8|\bpsi\b/i, /conscious/i, /sentien/i, /\balive\b/i,
  /self[\s-]*improv/i, /recursive(ly)?\s+improv/i, /improv\w*\s+(itself|on its own)/i, /climb/i,
]);

/** Total. Returns { ok, hits } — ok only if no forbidden term appears anywhere in the text. */
export function claimGate(text) {
  const s = String(text ?? '');
  const hits = FORBIDDEN.filter((re) => re.test(s)).map((re) => re.source);
  return { ok: hits.length === 0, hits };
}

export const pad = (n) => String(n).padStart(4, '0');
export const editionLabel = (n) => `${SERIES} ${pad(n)}/${EDITION_OF}`;

function checkNo(n) {
  if (!Number.isInteger(n) || n < 1 || n > EDITION_OF) throw new Error(`edition must be an integer 1..${EDITION_OF}`);
}

/** Stamp the edition into the build itself, so the seal covers it. */
export function stampEdition(html, n) {
  checkNo(n);
  const meta = `<meta name="fallkard-edition" content="${editionLabel(n)}">`;
  const s = String(html);
  if (/name="fallkard-edition"/.test(s)) throw new Error('build already carries an edition');
  return /<head[^>]*>/i.test(s) ? s.replace(/<head[^>]*>/i, (h) => h + meta) : meta + s;
}

export function editionInBuild(html) {
  const m = /<meta name="fallkard-edition" content="genesis (\d{4})\/1000">/.exec(String(html));
  return m ? Number(m[1]) : null;
}

/** Forge one Genesis card. Refuses (throws) if the build or its claims fail the claim gate. */
export function forgeGenesis({ n, build, claims = [], image, tags = '', forged, sign, signer }) {
  checkNo(n);
  const claimText = claims.join('\n');
  for (const [what, t] of [['claims', claimText], ['build', String(build)]]) {
    const g = claimGate(t);
    if (!g.ok) throw new Error(`claim gate refused ${what}: ${g.hits.join(', ')}`);
  }
  if (!claims.some((c) => /re-run it yourself/i.test(c))) throw new Error('claim gate: every Genesis card must lead with "re-run it yourself"');
  const stamped = stampEdition(build, n);
  if (typeof sign !== 'function' || !signer) throw new Error('genesis cards must be Ed25519-signed');
  return forge({ build: stamped, image, tags, forged, sign, signer,
    extra: { edition: { series: SERIES, no: n, of: EDITION_OF }, claims } });
}

/** Read + re-check a Genesis card: seal, signature, edition in build == edition in manifest, claim gate. */
export function readGenesis(png) {
  const r = read(png);
  const fail = (reason) => ({ ...r, ok: false, genesisOk: false, reason });
  if (!r.ok) return fail(r.reason);
  if (!r.signed || r.sigOk !== true) return fail('unsigned');
  const e = r.manifest.edition;
  if (!e || e.series !== SERIES || e.of !== EDITION_OF) return fail('not-genesis');
  const inBuild = editionInBuild(r.hatch());
  if (inBuild !== e.no) return fail('edition-mismatch');
  const g = claimGate((r.manifest.claims || []).join('\n') + '\n' + r.hatch());
  if (!g.ok) return fail('forbidden-claim');
  return { ...r, ok: true, genesisOk: true, reason: 'authentic', edition: e.no };
}

export const sealOf = (html) => sha256(gzipSync(Buffer.from(html, 'utf8'), { level: 9 }));
