// fallkard-forge · babykcc.mjs — the estate's own KCC: shared STANDARD, sovereign STATE, R7 bridge.
//
// "Own but the same" resolves by splitting what is shared from what is sovereign:
//   STANDARD (shared)  — KCC-MINT-001: the schema, the primes, 510510, κ, the token. The baby forks
//                        the DNA, so it speaks main KCC's language. Field-by-field, never assumed.
//   STATE (sovereign)  — its own hash-chained ledger of minted artifacts. Loopback-first: it runs
//                        complete and standalone, no network, no crypto-money, no chain.
//   BRIDGE (R7)        — recognition, not merge: two ledgers may talk when the standard matches AND
//                        the state is distinct. Same head = a mirror, not a peer. Faces carry names
//                        and hashes only — never contents.
//
// The internal ledger is value-as-accounting (what was minted, what it earned, what the supply is).
// It is NOT money. The day a real-money bridge exists it is a separate, gated, counselled build.
//
// Pure and total: hashing is injected (async sha over strings); no clock, no I/O, no Date.

export const KCC_STANDARD = Object.freeze({
  spec: 'KCC-MINT-001',
  version: '1.0.0',
  token: 'KCC',
  primes: Object.freeze([2, 3, 5, 7, 11, 13, 17]),
  primorial: 510510,
  kappa: 0.6180339887498949,
});

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const arr = (v) => Array.isArray(v) ? v : [];

const canon = (v) => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
};

/** The standard as one comparable string. Two ledgers share a standard when these are EQUAL. */
export function standardFingerprint(std) {
  const s = obj(std);
  return canon({
    spec: s.spec, version: s.version, token: s.token,
    primes: arr(s.primes), primorial: s.primorial, kappa: s.kappa,
  });
}

export function makeLedger(name) {
  return {
    name: (typeof name === 'string' && name) ? name : 'baby-kcc',
    standard: KCC_STANDARD,
    entries: [],
  };
}

/**
 * Record a mint. Refused (returned, not thrown — the caller narrates) when the bundle is not a
 * KCC mint, when the kpid is already in the ledger (an artifact mints ONCE), or when the face
 * value is not a real non-negative number — an unbalanced entry is not recorded.
 * `at` is the caller's timestamp (kernels have no clock); `sha` is async (string) => hex.
 */
export async function mint(ledger, bundle, at, sha) {
  const l = obj(ledger);
  const entries = arr(l.entries);
  const b = obj(bundle);
  const m = obj(b.mint);
  if (typeof m.kpid !== 'string' || !/^kcc:/.test(m.kpid)) {
    return { ok: false, why: 'not a KCC mint — the bundle has no kpid' };
  }
  if (entries.some(e => e && e.kpid === m.kpid)) {
    return { ok: false, why: `"${m.kpid}" is already in this ledger — an artifact mints once` };
  }
  const value = m.kcc_face_value;
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, why: 'the face value is not a real non-negative number — an unbalanced entry is not recorded' };
  }
  if (typeof sha !== 'function') {
    return { ok: false, why: 'no hash was supplied — an unchained entry is not recorded' };
  }
  const prev = entries.length ? entries[entries.length - 1].hash : null;
  const body = {
    seq: entries.length,
    prev,
    kind: 'mint',
    kpid: m.kpid,
    parent_kpid: (typeof m.parent_kpid === 'string' && m.parent_kpid) ? m.parent_kpid : null,
    fork_sha: typeof m.fork_sha === 'string' ? m.fork_sha : '',
    tier: typeof b.tier === 'string' ? b.tier : 'common',
    value,
    at: typeof at === 'string' ? at : '',
  };
  const hash = await sha(canon(body));
  const entry = { ...body, hash: typeof hash === 'string' ? hash : '' };
  return { ok: true, why: `minted ${m.kpid} at ${body.value} KCC`, ledger: { ...l, entries: [...entries, entry] } };
}

/**
 * Walk the whole chain and re-derive everything: every link recomputed, every seq exact, supply
 * summed from the entries themselves. A ledger that cannot re-prove its own history is not a
 * ledger. Returns { ok, why, supply, count, head }.
 */
export async function verifyLedger(ledger, sha) {
  const l = obj(ledger);
  const entries = arr(l.entries);
  if (typeof sha !== 'function') return { ok: false, why: 'no hash was supplied — nothing can be re-proven', supply: 0, count: 0, head: null };
  let supply = 0;
  const seen = new Set();
  for (let i = 0; i < entries.length; i++) {
    const e = obj(entries[i]);
    if (e.seq !== i) return { ok: false, why: `entry ${i} carries seq ${e.seq} — the order has been rewritten`, supply, count: i, head: null };
    const wantPrev = i === 0 ? null : entries[i - 1].hash;
    if (e.prev !== wantPrev) return { ok: false, why: `entry ${i} does not point at its predecessor — the chain is cut`, supply, count: i, head: null };
    const { hash, ...body } = e;
    const again = await sha(canon(body));
    if (again !== hash) return { ok: false, why: `entry ${i} does not hash to itself — its contents were changed after it was written`, supply, count: i, head: null };
    if (seen.has(e.kpid)) return { ok: false, why: `"${e.kpid}" appears twice — an artifact mints once`, supply, count: i, head: null };
    seen.add(e.kpid);
    supply += e.value;
  }
  return {
    ok: true,
    why: entries.length ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} re-proven · supply ${supply} KCC` : 'an empty ledger is a valid ledger — nothing claimed, nothing to prove',
    supply,
    count: entries.length,
    head: entries.length ? entries[entries.length - 1].hash : null,
  };
}

/** The R7-style face: what this ledger announces — the standard and hashes, never contents. */
export function bridgeFace(ledger) {
  const l = obj(ledger);
  const entries = arr(l.entries);
  return {
    name: typeof l.name === 'string' ? l.name : 'baby-kcc',
    standard: standardFingerprint(l.standard),
    head: entries.length ? obj(entries[entries.length - 1]).hash || null : null,
    count: entries.length,
  };
}

/**
 * May two ledgers bridge? Same standard ⇒ they can talk; distinct state ⇒ they are two things;
 * both ⇒ recognition, not merge. Two empty ledgers cannot bridge — there is nothing to exchange
 * and no way to tell them apart.
 */
export function bridgeOk(faceA, faceB) {
  const a = obj(faceA), b = obj(faceB);
  if (a.standard !== b.standard) {
    return { ok: false, why: 'the standards differ — these two do not speak the same language, and a bridge would be a translation error' };
  }
  if ((a.head || null) === (b.head || null)) {
    return {
      ok: false,
      // the guard above already proved the heads EQUAL, so one null means both null
      why: a.head === null
        ? 'both ledgers are empty — there is nothing to exchange and no way to tell them apart'
        : 'the heads are identical — that is a mirror of the same ledger, not a peer',
    };
  }
  return { ok: true, why: 'same standard, distinct state — recognition, not merge: they may talk' };
}

export default makeLedger;
