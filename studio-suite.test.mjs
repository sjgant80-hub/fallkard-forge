// fallkard-forge · studio-suite.test.mjs — artifact + babykcc + studio, every rule falsifiable.
// Ed25519 is real here (node subtle); sha is real; and the pins are exact — a claimed tier fails,
// a tampered bundle fails, a rewritten ledger fails, and a composed build is byte-deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  canonicalJson, signable, makeBundle, signBundle, verifyArtifact, chainsTo,
  KCC_SPEC, PRIMORIAL, ARTIFACT_KEYWORD,
} from './artifact.mjs';
import { rarity } from './card.mjs';
import {
  KCC_STANDARD, standardFingerprint, makeLedger, mint, verifyLedger, bridgeFace, bridgeOk,
} from './babykcc.mjs';
import { ORGANS, compose, validateComposition } from './studio.mjs';

const sha = async (s) => createHash('sha256').update(s).digest('hex');
const subtle = webcrypto.subtle;

async function keypair() {
  const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubRaw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  const pubB64 = Buffer.from(pubRaw).toString('base64');
  const sign = async (s) => Buffer.from(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(s)))).toString('base64');
  const verify = async (s, sigB64, pB64) => {
    const key = await subtle.importKey('raw', Buffer.from(pB64, 'base64'), { name: 'Ed25519' }, false, ['verify']);
    return subtle.verify({ name: 'Ed25519' }, key, Buffer.from(sigB64, 'base64'), new TextEncoder().encode(s));
  };
  return { pubB64, sign, verify };
}

const SEAL = 'a3f9b21c'.repeat(8);

// ─── artifact ───

test('CANONICAL JSON IS ORDER-BLIND AND THE SIGNABLE EXCLUDES ONLY THE SIGNATURE', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
  const b = makeBundle({ slug: 'x', seal: SEAL }, rarity);
  const before = signable(b);
  const signed = { ...b, mint: { ...b.mint, minter_sig_b64: 'SIG' } };
  assert.equal(signable(signed), before, 'adding the signature must not change what was signed');
});

test('THE BUNDLE IS KCC-MINT-001 SHAPED AND THE TIER IS EARNED, NEVER TAKEN', () => {
  const b = makeBundle({ slug: 'My Tool!', seal: SEAL, assessorPass: true, depth: 2, domain: 'a tool', mintedAt: '2026-08-19' }, rarity);
  assert.equal(b._udt, 'KccProject');
  assert.equal(b.token, 'KCC');
  assert.equal(b.primorial, PRIMORIAL);
  assert.equal(b.slug, 'my-tool', 'the slug is normalised, not trusted');
  assert.equal(b.tier, 'rare', 'assessor pass at depth 2 EARNS rare');
  assert.equal(b.mint.kpid, `kcc:my-tool:gen0:${SEAL.slice(0, 8)}`);
  assert.strictEqual(b.mint.parent_kpid, null);
  assert.equal(b.mint.fork_sha, SEAL);
  assert.equal(b.mint.anchor.chain, 'sovereign');
  const kid = makeBundle({ slug: 'fork-of-it', seal: 'beefcafe'.repeat(8), parentKpid: b.mint.kpid }, rarity);
  assert.equal(kid.mint.kpid.includes(':fork:'), true, 'a child is a fork, not a genesis');
  assert.equal(chainsTo(kid, b), true);
  assert.equal(chainsTo(b, kid), false, 'lineage has a direction');
  // no assessor rule handed in = common, never a guess upward
  assert.equal(makeBundle({ slug: 'x', seal: SEAL, assessorPass: true }).tier, 'common');
});

test('THE LOCAL VERIFY: a true artifact passes all four, and each lie fails its own check', async () => {
  const { pubB64, sign, verify } = await keypair();
  const b0 = makeBundle({ slug: 'true-one', seal: SEAL, assessorPass: true, minterPubB64: pubB64 }, rarity);
  const b = await signBundle(b0, sign);
  const good = await verifyArtifact({ sealComputed: SEAL, bundle: b, verify, assessorPass: true }, rarity);
  assert.equal(good.ok, true, good.checks.map(c => c.name + ':' + c.why).join(' | '));
  assert.equal(good.checks.length, 4);

  // a receipt, not a container: the file holds a different build
  const r1 = await verifyArtifact({ sealComputed: 'ff'.repeat(32), bundle: b, verify, assessorPass: true }, rarity);
  assert.equal(r1.ok, false);
  assert.match(r1.checks.find(c => c.name === 'contains the build').why, /receipt, not a container/);

  // a claimed tier is a monkey PNG
  const r2 = await verifyArtifact({ sealComputed: SEAL, bundle: { ...b, tier: 'holo' }, verify, assessorPass: true }, rarity);
  assert.equal(r2.checks.find(c => c.name === 'tier is earned').ok, false);
  assert.match(r2.checks.find(c => c.name === 'tier is earned').why, /monkey PNG/);

  // tampering after signing is caught by the signature
  const bent = { ...b, domain: 'now it says something else' };
  const r3 = await verifyArtifact({ sealComputed: SEAL, bundle: bent, verify, assessorPass: true }, rarity);
  assert.equal(r3.checks.find(c => c.name === 'signature verifies').ok, false);

  // unsigned is SAID, not shrugged
  const r4 = await verifyArtifact({ sealComputed: SEAL, bundle: b0, verify, assessorPass: true }, rarity);
  assert.match(r4.checks.find(c => c.name === 'signature verifies').why, /asserted, not proven/);

  // a kpid whose sha8 does not match its fork_sha has come apart
  const drifted = { ...b, mint: { ...b.mint, kpid: 'kcc:true-one:gen0:00000000' } };
  const r5 = await verifyArtifact({ sealComputed: SEAL, bundle: drifted, verify, assessorPass: true }, rarity);
  assert.equal(r5.checks.find(c => c.name === 'lineage is well-formed').ok, false);
});

// ─── baby KCC ───

test('THE STANDARD FINGERPRINT IS EXACT — one moved number is a different language', () => {
  const a = standardFingerprint(KCC_STANDARD);
  assert.equal(standardFingerprint({ ...KCC_STANDARD }), a);
  assert.notEqual(standardFingerprint({ ...KCC_STANDARD, primorial: 510511 }), a);
  assert.notEqual(standardFingerprint({ ...KCC_STANDARD, version: '1.0.1' }), a);
  assert.equal(KCC_STANDARD.primorial, 510510);
});

test('THE LEDGER MINTS ONCE, CHAINS EXACTLY, REFUSES THE UNBALANCED, AND RE-PROVES ITSELF', async () => {
  let l = makeLedger('estate');
  const b1 = makeBundle({ slug: 'one', seal: SEAL, faceValue: 3 }, rarity);
  const b2 = makeBundle({ slug: 'two', seal: 'beefcafe'.repeat(8), faceValue: 2, parentKpid: b1.mint.kpid }, rarity);

  const m1 = await mint(l, b1, '2026-08-19T12:00:00Z', sha);
  assert.equal(m1.ok, true, m1.why); l = m1.ledger;
  const dup = await mint(l, b1, '2026-08-19T12:01:00Z', sha);
  assert.equal(dup.ok, false);
  assert.match(dup.why, /mints once/);
  // makeBundle sanitizes NaN to 0 — the ledger's own guard is for RAW bundles from elsewhere
  const bad = await mint(l, { mint: { kpid: 'kcc:raw:gen0:00000000', kcc_face_value: NaN } }, 't', sha);
  assert.equal(bad.ok, false, 'NaN face value must be refused');
  assert.match(bad.why, /unbalanced entry is not recorded/);
  const neg = await mint(l, { ...b2, mint: { ...b2.mint, kcc_face_value: -5 } }, 't', sha);
  assert.equal(neg.ok, false, 'a negative mint is an unbalanced entry');
  const nok = await mint(l, { mint: {} }, 't', sha);
  assert.equal(nok.ok, false, 'a bundle with no kpid is not a KCC mint');

  const m2 = await mint(l, b2, '2026-08-19T12:02:00Z', sha);
  assert.equal(m2.ok, true); l = m2.ledger;
  const v = await verifyLedger(l, sha);
  assert.equal(v.ok, true, v.why);
  assert.equal(v.supply, 5, 'supply is summed from the entries themselves');
  assert.equal(v.count, 2);

  // every tamper class is caught: contents, order, the chain
  const bent = JSON.parse(JSON.stringify(l)); bent.entries[0].value = 100;
  assert.match((await verifyLedger(bent, sha)).why, /changed after it was written/);
  const cut = JSON.parse(JSON.stringify(l)); cut.entries[1].prev = 'f'.repeat(64);
  assert.match((await verifyLedger(cut, sha)).why, /chain is cut/);
  const shuffled = JSON.parse(JSON.stringify(l)); shuffled.entries.reverse();
  assert.equal((await verifyLedger(shuffled, sha)).ok, false);
  assert.equal((await verifyLedger(makeLedger('empty'), sha)).ok, true, 'an empty ledger is a valid ledger');
});

test('THE BRIDGE IS RECOGNITION, NOT MERGE — same standard AND distinct state, or no bridge', async () => {
  let a = makeLedger('estate-a'), b = makeLedger('estate-b');
  const ma = await mint(a, makeBundle({ slug: 'one', seal: SEAL, faceValue: 1 }, rarity), 't1', sha);
  const mb = await mint(b, makeBundle({ slug: 'other', seal: 'beefcafe'.repeat(8), faceValue: 1 }, rarity), 't2', sha);
  a = ma.ledger; b = mb.ledger;

  const ok = bridgeOk(bridgeFace(a), bridgeFace(b));
  assert.equal(ok.ok, true);
  assert.match(ok.why, /recognition, not merge/);

  const mirror = bridgeOk(bridgeFace(a), bridgeFace(a));
  assert.equal(mirror.ok, false);
  assert.match(mirror.why, /mirror of the same ledger/);

  const empties = bridgeOk(bridgeFace(makeLedger('x')), bridgeFace(makeLedger('y')));
  assert.equal(empties.ok, false, 'two empty ledgers have nothing to exchange');

  const foreign = { ...bridgeFace(b), standard: 'something-else' };
  assert.match(bridgeOk(bridgeFace(a), foreign).why, /do not speak the same language/);

  // the face never leaks contents — names and hashes only
  const face = bridgeFace(a);
  assert.deepEqual(Object.keys(face).sort(), ['count', 'head', 'name', 'standard']);
});

// ─── studio ───

test('COMPOSITION IS DETERMINISTIC AND SOVEREIGN — same input, same bytes, and it passes its own gate', async () => {
  const one = compose({ name: 'My Little Estate', organs: ['oracle', 'notes'] });
  const two = compose({ name: 'My Little Estate', organs: ['oracle', 'notes'] });
  assert.equal(await sha(one.html), await sha(two.html), 'the same composition must be the same bytes');
  assert.deepEqual(one.organs, ['oracle', 'notes']);
  const v = validateComposition(one.html);
  assert.equal(v.ok, true, v.reasons.join(' | '));
  assert.ok(one.html.includes('Konomi Architecture'));
  assert.ok(one.html.includes('org-oracle') && one.html.includes('org-notes'));
  assert.ok(!one.html.includes('org-tally'), 'an organ not picked is not in the build');
});

test('UNKNOWN ORGANS COME BACK NAMED, NEVER SWALLOWED — and garbage composes to a valid empty build', () => {
  const r = compose({ name: 'x', organs: ['oracle', 'ghost-organ'] });
  assert.deepEqual(r.skipped, ['ghost-organ']);
  const g = compose(null);
  assert.equal(validateComposition(g.html).ok, true, 'a bare shell is still a valid sovereign build');
  assert.equal(g.name, 'a sovereign build');
  assert.equal(ORGANS.length, 8);
});

test('THE SOVEREIGNTY GATE REFUSES EACH ESCAPE WITH ITS OWN SENTENCE', () => {
  const base = compose({ name: 'x', organs: ['notes'] }).html;
  assert.match(validateComposition(base.replace('<footer>composed', '<img src="https://cdn.evil/x.png"><footer>composed')).reasons.join(),
    /reaches for the outside world/);
  assert.match(validateComposition(base.replace('<script>', '<script>fetch("/x");')).reasons.join(),
    /are sanctioned/, 'a relative fetch is not a sanctioned origin');
  assert.match(validateComposition(base.replace('<script>', '<script>fetch("https://evil.example/x");')).reasons.join(),
    /are sanctioned/);
  assert.match(validateComposition(base.replace('<script>', '<script>fetch(url);')).reasons.join(),
    /computed target/, 'a fetch the reader cannot see through is refused');
  assert.match(validateComposition(base.replace('<script>', '<script>new WebSocket("wss://x");')).reasons.join(),
    /phones home/);
  // the two sanctioned reaches pass — the user's machine, and the user's key
  assert.equal(validateComposition(base.replace('<script>', "<script>fetch('http://localhost:11434/api/tags');")).ok, true);
  assert.equal(validateComposition(base.replace('<script>', "<script>fetch('https://api.anthropic.com/v1/messages');")).ok, true);
  assert.match(validateComposition(base.replace('powered by fall·os · Konomi Architecture', 'powered by vibes')).reasons.join(),
    /architecture line is missing/);
  assert.match(validateComposition('<div>hi</div>').reasons.join(), /starts with/);
  assert.equal(validateComposition(null).ok, false, 'garbage is not a build');
});

test('EVERY ORGAN IN THE PALETTE ACTUALLY LANDS ITS SECTION AND ITS SCRIPT', () => {
  for (const g of ORGANS) {
    const r = compose({ name: 't', organs: [g.id] });
    assert.ok(r.html.includes(`org-${g.id}`), `${g.id} has no section`);
    assert.ok(r.html.split('<script>')[1].length > 100, `${g.id} shipped no behaviour`);
    assert.equal(validateComposition(r.html).ok, true, `${g.id} fails its own sovereignty gate`);
  }
});


// ─── round two: the gate found 34 gaps across the three kernels — each dies here ───

test('ARTIFACT GUARDS ARE EXACT — negative value zeroed, primes seated, garbage never throws', async () => {
  assert.equal(makeBundle({ slug: 'x', seal: SEAL, faceValue: -1 }, rarity).mint.kcc_face_value, 0,
    'a negative face value must zero, not ride');
  assert.equal(makeBundle({ slug: 'x', seal: SEAL, prime: 7 }, rarity).prime, 7);
  assert.equal(makeBundle({ slug: 'x', seal: SEAL }, rarity).prime, 2, 'no prime means the first prime');
  // total on garbage — none of these may throw
  makeBundle(null, rarity); makeBundle(undefined); makeBundle(42, rarity);
  signable(null); signable(7); canonicalJson(undefined);
  const g = await verifyArtifact(null, rarity);
  assert.equal(g.ok, false, 'garbage evidence never verifies');
  const g2 = await verifyArtifact({ bundle: null, sealComputed: '' }, rarity);
  assert.equal(g2.ok, false);
  assert.equal(await signBundle(null, null), null, 'signBundle without a signer hands back what it got');
});

test('A FORK VERIFIES TOO — and a parent pointer that is not a kpid fails lineage', async () => {
  const { pubB64, sign, verify } = await keypair();
  const root = makeBundle({ slug: 'root', seal: SEAL, minterPubB64: pubB64 }, rarity);
  const forkSeal = 'beefcafe'.repeat(8);
  const fork0 = makeBundle({ slug: 'the-fork', seal: forkSeal, parentKpid: root.mint.kpid, minterPubB64: pubB64 }, rarity);
  const fork = await signBundle(fork0, sign);
  const ok = await verifyArtifact({ sealComputed: forkSeal, bundle: fork, verify }, rarity);
  assert.equal(ok.ok, true, ok.checks.map(c => c.name + ':' + c.why).join(' | '));

  const badParent = { ...fork, mint: { ...fork.mint, parent_kpid: 'not-a-kpid' } };
  const r = await verifyArtifact({ sealComputed: forkSeal, bundle: badParent, verify }, rarity);
  assert.equal(r.checks.find(c => c.name === 'lineage is well-formed').ok, false,
    'a parent pointer outside kcc: is not lineage');
});

test('DEPTH RIDES INTO THE EARNED TIER ON VERIFY — evidence at depth 2 must earn rare', async () => {
  const b = makeBundle({ slug: 'deep', seal: SEAL, assessorPass: true, depth: 2 }, rarity);
  assert.equal(b.tier, 'rare');
  const r = await verifyArtifact({ sealComputed: SEAL, bundle: b, assessorPass: true, depth: 2 }, rarity);
  assert.equal(r.checks.find(c => c.name === 'tier is earned').ok, true,
    'the verifier must weigh the same depth the mint did');
});

test('CHAINSTO REFUSES THE EMPTY-STRING TRAP — an empty pointer matches nothing, even an empty kpid', () => {
  assert.equal(chainsTo({ mint: { parent_kpid: '' } }, { mint: { kpid: '' } }), false);
  assert.equal(chainsTo({ mint: { parent_kpid: 7 } }, { mint: { kpid: 7 } }), false, 'numbers are not lineage');
  assert.equal(chainsTo(null, null), false);
});

test('THE STANDARD FINGERPRINT IS PINNED TO THE BYTE — any drift in the canon is a different language', () => {
  assert.equal(standardFingerprint(KCC_STANDARD),
    '{"kappa":0.6180339887498949,"primes":[2,3,5,7,11,13,17],"primorial":510510,"spec":"KCC-MINT-001","token":"KCC","version":"1.0.0"}');
});

test('THE LEDGER SANITIZES EVERY FIELD IT RECORDS — non-strings become their honest defaults', async () => {
  let l = makeLedger(7);
  assert.equal(l.name, 'baby-kcc', 'a numeric name is not a name');
  const raw = { tier: 42, mint: { kpid: 'kcc:raw:gen0:00000000', kcc_face_value: 0, parent_kpid: 9, fork_sha: 9 } };
  const m = await mint(l, raw, 42, sha);
  assert.equal(m.ok, true, 'face value zero is a legitimate mint');
  const e = m.ledger.entries[0];
  assert.equal(e.value, 0);
  assert.strictEqual(e.parent_kpid, null, 'a numeric parent is no parent');
  assert.equal(e.fork_sha, '', 'a numeric sha is no sha');
  assert.equal(e.tier, 'common', 'a numeric tier earns nothing');
  assert.equal(e.at, '', 'a numeric timestamp is no timestamp');
  const v = await verifyLedger(m.ledger, sha);
  assert.equal(v.ok, true);
  assert.match(v.why, /^1 entry re-proven/, 'one entry is an entry, not entries');
  // a non-string kpid and a string that is not kcc: are both refused
  assert.equal((await mint(l, { mint: { kpid: 42 } }, 't', sha)).ok, false);
  // the bad kpid must carry an otherwise-VALID mint, or the next guard masks this one
  const alien = await mint(l, { mint: { kpid: 'not-kcc-at-all', kcc_face_value: 0 } }, 't', sha);
  assert.equal(alien.ok, false, 'a kpid outside kcc: is not a KCC mint');
  assert.match(alien.why, /no kpid|not a KCC mint/);
  // the face of a mangled ledger still answers with honest defaults
  assert.equal(bridgeFace({ name: 9, entries: 'x' }).name, 'baby-kcc');
});

test('THE EMPTIES REFUSAL SAYS WHY, EXACTLY — and garbage ledger calls never throw', async () => {
  const empties = bridgeOk(bridgeFace(makeLedger('x')), bridgeFace(makeLedger('y')));
  assert.match(empties.why, /nothing to exchange/, 'two empty ledgers get the empty reason, not the mirror reason');
  const mirror = bridgeOk({ standard: 's', head: 'h' }, { standard: 's', head: 'h' });
  assert.match(mirror.why, /mirror/);
  // total on garbage
  assert.equal((await mint(null, null, null, null)).ok, false);
  assert.equal((await verifyLedger(null, sha)).ok, true, 'a null ledger reads as empty, and empty is valid');
  bridgeOk(null, null); bridgeFace(null); standardFingerprint(null);
});

test('THE COMPOSED BYTES ARE THE SPEC — pinned, so even a mutated ORGAN SCRIPT moves the hash', async () => {
  // The organ bodies are template strings: no assertion can execute them here, so the exact output
  // hash is the falsifier — any change to any organ, markup or behaviour, moves these pins.
  const all3 = compose({ name: 'pin', organs: ['oracle', 'notes', 'tally'] }).html;
  const bare = compose({ name: 'pin', organs: [] }).html;
  assert.equal((await sha(all3)).slice(0, 32), 'f231e4d107ccdf5da87354d7dd2e18a3', 'the full palette moved');
  assert.equal((await sha(bare)).slice(0, 32), 'fe228f1a700f972720c9bc233f5c4efc', 'the bare shell moved');
  const full7 = compose({ name: 'pin', organs: ORGANS.map(g => g.id) }).html;
  assert.equal((await sha(full7)).slice(0, 32), '0ef06d1c413959b5bc48e69a04373e0a', 'the full eight-organ palette moved');
});
