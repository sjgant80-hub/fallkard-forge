// fallkard-forge · artifact.mjs — the SOVEREIGN ARTIFACT: the legit version of what NFTs faked.
//
// A monkey PNG is a receipt pointing at art on someone's server: does nothing, minted on demand,
// dies with its chain. The forge card is the opposite on every axis, and this kernel is where the
// opposite is enforced:
//   CONTAINS  — the working build rides IN the file (the card kernel packs it; this one checks it)
//   EARNS     — the tier is COMPUTED from assessor evidence, never claimed (a claimed tier fails)
//   SIGNED    — Ed25519 lineage per KCC-MINT-001: who minted it, what it forks from, untampered —
//               all verifiable FROM THE FILE, no chain, no registry
//   SOVEREIGN — every check below runs locally; crypto is INJECTED (browser subtle / node), so the
//               kernel itself is pure and testable without any
//
// The bundle is a KCC-MINT-001 KccProject (the shared STANDARD the baby ledger forks — see
// babykcc.mjs). Fields it does not use stay honest nulls rather than invented values.

export const ARTIFACT_KEYWORD = 'konomi-artifact';
export const KCC_SPEC = 'KCC-MINT-001';
export const PRIMES = [2, 3, 5, 7, 11, 13, 17];
export const PRIMORIAL = 510510;
export const KAPPA = 0.6180339887498949;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const str = (v, d = '') => (typeof v === 'string' ? v : d);

/** Canonical JSON: keys sorted at every depth, so a signature means the same bytes everywhere. */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/** The canonical form a mint signature covers: the whole bundle with the signature itself excluded. */
export function signable(bundle) {
  const b = obj(bundle);
  const mint = { ...obj(b.mint) };
  delete mint.minter_sig_b64;
  return canonicalJson({ ...b, mint });
}

/**
 * Build an unsigned KCC-MINT-001 bundle for a forged card. The tier is EARNED here — computed from
 * the assessor evidence the caller presents, by the same rule the card kernel stamps rarity with.
 * `rarityOf` is that rule, injected (card.mjs exports it) so the two can never quietly diverge.
 */
export function makeBundle(opts, rarityOf) {
  const o = obj(opts);
  const seal = str(o.seal);
  const slug = str(o.slug, 'unnamed').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
  const parent = str(o.parentKpid) || null;
  const earned = (typeof rarityOf === 'function')
    ? rarityOf({ assessorPass: !!o.assessorPass, depth: Number(o.depth) || 0, readingKeyHonest: !!o.readingKeyHonest })
    : 'common';
  return {
    _udt: 'KccProject',
    name: str(o.name, slug),
    slug,
    domain: str(o.domain),
    token: 'KCC',
    prime: Number(o.prime) || 2,
    primes: PRIMES,
    primorial: PRIMORIAL,
    phi: KAPPA,
    kappa: KAPPA,
    mesh_channels: ['kcc-mesh'],
    operator: str(o.operator, 'sjgant80-hub'),
    tier: earned,
    mint: {
      kpid: `kcc:${slug}:${parent ? 'fork' : 'gen0'}:${seal.slice(0, 8)}`,
      parent_kpid: parent,
      konomi_attestation: null,
      fork_sha: seal,
      minter_pubkey_b64: str(o.minterPubB64) || null,
      minter_sig_b64: null,
      kcc_face_value: Number.isFinite(o.faceValue) && o.faceValue >= 0 ? o.faceValue : 0,
      royalty_split: [],
      minted_at: str(o.mintedAt),
      anchor: { chain: 'sovereign', txid: null, block_height: null },
    },
  };
}

/** Sign the bundle. `sign` is async (bytesOrString) => base64 signature — injected, never bespoke. */
export async function signBundle(bundle, sign) {
  if (typeof sign !== 'function') return bundle;
  const sig = await sign(signable(bundle));
  const b = obj(bundle);
  return { ...b, mint: { ...obj(b.mint), minter_sig_b64: typeof sig === 'string' ? sig : null } };
}

/**
 * THE LOCAL VERIFY — every claim an artifact makes, checked from the file alone.
 * `evidence`:  { sealComputed, bundle, cardRarity, verify } where
 *   sealComputed — sha256 of the payload actually IN the file, recomputed by the caller
 *   cardRarity   — the rarity stamped on the card manifest riding beside the bundle
 *   verify       — async (canonicalString, sigB64, pubB64) => boolean, injected
 * Returns { ok, checks: [{name, ok, why}] } — every failure a sentence, never a shrug.
 */
export async function verifyArtifact(evidence, rarityOf) {
  const e = obj(evidence);
  const b = obj(e.bundle);
  const mint = obj(b.mint);
  const checks = [];
  const add = (name, ok, why) => checks.push({ name, ok: !!ok, why });

  // CONTAINS — the fork_sha must be the hash of the build that is actually in the file
  const seal = str(e.sealComputed);
  add('contains the build', seal !== '' && mint.fork_sha === seal,
    seal === '' ? 'no build was found in the file at all'
      : mint.fork_sha === seal ? 'the bundle seals exactly the build that is inside'
      : 'the bundle points at a different build than the one inside — a receipt, not a container');

  // EARNS — the tier must be the computed one, not a claim
  const earned = (typeof rarityOf === 'function')
    ? rarityOf({ assessorPass: !!e.assessorPass, depth: Number(e.depth) || 0, readingKeyHonest: !!e.readingKeyHonest })
    : null;
  add('tier is earned', earned !== null && b.tier === earned,
    earned === null ? 'no assessor rule was supplied, so the tier cannot be checked'
      : b.tier === earned ? `the tier "${b.tier}" matches what the evidence earns`
      : `the bundle claims "${b.tier}" but the evidence earns "${earned}" — a claimed grade is a monkey PNG`);

  // LINEAGE — the identifiers must be well-formed and self-consistent
  const kpidOk = typeof mint.kpid === 'string' && /^kcc:[a-z0-9-]+:(gen0|fork):[0-9a-f]{8}$/.test(mint.kpid)
    && mint.kpid.endsWith(str(mint.fork_sha).slice(0, 8));
  const parentOk = mint.parent_kpid === null || (typeof mint.parent_kpid === 'string' && /^kcc:/.test(mint.parent_kpid));
  add('lineage is well-formed', kpidOk && parentOk,
    kpidOk ? (parentOk ? 'kpid and parent both read as KCC lineage' : 'the parent pointer is not a kpid')
      : 'the kpid does not carry its own seal — identity and content have come apart');

  // SIGNED — the Ed25519 signature must verify over the canonical bundle
  if (typeof e.verify === 'function' && mint.minter_sig_b64 && mint.minter_pubkey_b64) {
    let good = false;
    try { good = (await e.verify(signable(b), mint.minter_sig_b64, mint.minter_pubkey_b64)) === true; } catch { good = false; }
    add('signature verifies', good, good ? 'the minter signed exactly these bytes'
      : 'the signature does not match the bundle — tampered, or signed by someone else');
  } else {
    add('signature verifies', false,
      mint.minter_sig_b64 ? 'no verifier was available here, so the signature could not be checked'
        : 'the bundle is unsigned — lineage is asserted, not proven');
  }

  return { ok: checks.every(c => c.ok), checks };
}

/** A child chains to its parent when its pointer is the parent's identity. No chain, just arithmetic. */
export function chainsTo(child, parent) {
  const c = obj(obj(child).mint), p = obj(obj(parent).mint);
  return typeof c.parent_kpid === 'string' && c.parent_kpid !== '' && c.parent_kpid === p.kpid;
}

export default makeBundle;
