// fallkard-forge · fold.test.mjs — the fold-glyph kernel, every rule falsifiable.
// Golden placement is pinned to the digit, the κ crossing is pinned at exactly κ,
// the canonical form is pinned as a string (so the signature can never drift
// silently), every validity arm fails ALONE, and the whole surface is fuzzed —
// pure kernels never throw on garbage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  GOLDEN_ANGLE, KAPPA, makeGlyph, canonGlyph, foldSignature,
  foldState, creasePattern, validGlyph, glyphPayload, readGlyphPayload,
} from './fold.mjs';

const sha = async (s) => createHash('sha256').update(s).digest('hex');

test('THE RING IS GOLDEN TO THE DIGIT — placement, alternation, and the clamps', () => {
  const g = makeGlyph({ n: 5 });
  assert.equal(g.ring.length, 5);
  assert.equal(g.ring[0].theta, 0);
  assert.equal(g.ring[1].theta, 137.50776405003785, 'the golden angle moved');
  assert.equal(g.ring[2].theta, 275.0155281000757);
  assert.equal(g.ring[3].theta, (3 * GOLDEN_ANGLE) % 360, 'the third point must wrap past 360');
  assert.ok(g.ring[3].theta < 360);
  assert.deepEqual(g.ring.map(r => r.kind), ['M', 'V', 'M', 'V', 'M'], 'mountain/valley must alternate');
  assert.equal(g.center, 'HOLE');
  assert.equal(g.twist, KAPPA);
  // clamps: fewer than 3 points cannot twist, garbage falls to the defaults
  assert.equal(makeGlyph({ n: 1 }).ring.length, 3);
  assert.equal(makeGlyph({ n: 9999 }).ring.length, 144);
  assert.equal(makeGlyph({ n: 'garbage' }).ring.length, 8);
  assert.equal(makeGlyph().crown, 'transmit');
  assert.equal(makeGlyph().ground, 'weave');
});

test('THE CANONICAL FORM IS PINNED — the signature can never drift silently', async () => {
  const g = makeGlyph({ n: 3, crown: 'c', ground: 'g' });
  assert.equal(canonGlyph(g),
    'c|g|HOLE|0.618033988750|0|0@0.000000000M,1@137.507764050V,2@275.015528100M');
  // every field moves the canon — content-addressing means content
  const base = canonGlyph(g);
  assert.notEqual(canonGlyph({ ...g, crown: 'x' }), base);
  assert.notEqual(canonGlyph({ ...g, ground: 'x' }), base);
  assert.notEqual(canonGlyph({ ...g, twist: 0.5 }), base);
  assert.notEqual(canonGlyph({ ...g, depth: 1 }), base);
  assert.notEqual(canonGlyph({ ...g, ring: g.ring.slice(0, 2) }), base);
  // a sub-glyph folds INTO the canon, parenthesised at its fold-point
  const withSub = { ...g, ring: [{ ...g.ring[0], sub: makeGlyph({ n: 3 }) }, g.ring[1], g.ring[2]] };
  assert.ok(canonGlyph(withSub).includes('('), 'the sub-glyph left no trace in the canon');
  assert.notEqual(canonGlyph(withSub), base);

  const sig = await foldSignature(g, sha);
  assert.match(sig, /^[0-9a-f]{16}$/, 'the fold-signature must be 16 hex chars');
  assert.equal(sig, (await sha(canonGlyph(g))).slice(0, 16));
  assert.strictEqual(await foldSignature(g, null), null, 'no hash function means no signature, not a crash');
});

test('THE FOLD MOTION CROSSES AT EXACTLY κ AND CLAMPS AT BOTH ENDS', () => {
  const g = makeGlyph();
  assert.equal(foldState(g, 0).reads, 'possibility/flat');
  assert.equal(foldState(g, KAPPA - 1e-9).reads, 'possibility/flat');
  assert.equal(foldState(g, KAPPA).reads, 'actual/folded', 'the crossing must land AT κ, not past it');
  assert.equal(foldState(g, 1).reads, 'actual/folded');
  assert.equal(foldState(g, 1).twistDeg, 360 * KAPPA, 'the full twist is 360·κ');
  assert.equal(foldState(g, 0.5).twistDeg, 180 * KAPPA);
  assert.equal(foldState(g, 0).centerHole, 1, 'the hole is widest flat');
  assert.equal(foldState(g, 1).centerHole, 0, 'the hole is tightest folded');
  assert.equal(foldState(g, -5).t, 0, 't clamps at 0');
  assert.equal(foldState(g, 5).t, 1, 't clamps at 1');
  assert.equal(foldState(g, 'garbage').t, 0);
  // reversible by construction: the same t always yields the same state
  assert.deepEqual(foldState(g, 0.3), foldState(g, 0.3));
});

test('THE CREASE GEOMETRY GATHERS, TWISTS, AND NEVER CLOSES THE HOLE', () => {
  const g = makeGlyph({ n: 4 });
  const flat = creasePattern(g, 0);
  const folded = creasePattern(g, 1);
  assert.equal(flat.points.length, 4);
  assert.equal(flat.hole, 0.5, 'the flat hole must open to exactly 0.5');
  assert.equal(folded.hole, 0.15, 'the folded hole must tighten to exactly 0.15 — never 0');
  assert.equal(flat.radius, 1);
  assert.equal(folded.radius, 0.5, 'the ring must gather to half radius');
  assert.equal(flat.rotationDeg, 0);
  assert.equal(folded.rotationDeg, 360 * KAPPA);
  // the first point sits on the x-axis flat, and has twisted off it folded
  assert.ok(Math.abs(flat.points[0].y) < 1e-12);
  assert.ok(Math.abs(folded.points[0].y) > 0.1, 'the fold did not twist');
  assert.equal(flat.points[1].kind, 'V');
});

test('EVERY VALIDITY ARM FAILS ALONE — and the golden glyph passes', () => {
  const good = makeGlyph({ n: 5 });
  assert.deepEqual(validGlyph(good), { valid: true, reasons: [], folds: 5, deepest: 0 });

  const arm = (mutate, re) => {
    const g = JSON.parse(JSON.stringify(good));
    mutate(g);
    const v = validGlyph(g);
    assert.equal(v.valid, false);
    assert.ok(v.reasons.some(r => re.test(r)), `expected ${re} in: ${v.reasons.join(' · ')}`);
  };
  arm(g => { g.center = 'apex'; }, /a crease at the One is an apex/);
  arm(g => { g.crown = ''; }, /crown .* is missing/);
  arm(g => { g.ground = ''; }, /ground .* is missing/);
  arm(g => { g.ground = g.crown; }, /two poles, not one point twice/);
  arm(g => { g.twist = 0; }, /strictly inside \(0,1\)/);
  arm(g => { g.twist = 1; }, /strictly inside \(0,1\)/);
  arm(g => { g.twist = NaN; }, /strictly inside \(0,1\)/);
  arm(g => { g.ring = g.ring.slice(0, 2); }, /at least 3 fold-points/);
  arm(g => { g.ring = null; }, /at least 3 fold-points/);
  arm(g => { g.ring[2].theta += 0.001; }, /off the golden placement/);
  arm(g => { g.ring[1].kind = 'M'; }, /breaks the mountain\/valley alternation/);
  arm(g => { g.ring[0] = 42; }, /is not a fold-point/);
  assert.equal(validGlyph(null).valid, false);
  assert.equal(validGlyph('x').valid, false);

  // ψ(ψ): a valid sub-glyph deepens the fold; an invalid one fails the whole
  const withGood = JSON.parse(JSON.stringify(good));
  withGood.ring[0].sub = makeGlyph({ n: 3, depth: 1 });
  const vg = validGlyph(withGood);
  assert.equal(vg.valid, true);
  assert.equal(vg.deepest, 1, 'the sub-glyph must deepen the measured fold');
  const withBad = JSON.parse(JSON.stringify(good));
  withBad.ring[0].sub = { ...makeGlyph({ n: 3 }), center: 'apex' };
  const vb = validGlyph(withBad);
  assert.equal(vb.valid, false);
  assert.ok(vb.reasons.some(r => /sub-glyph at fold-point 0 does not fold/.test(r)));
});

test('THE PAYLOAD ROUND-TRIPS AND THE TIER IS EARNED', async () => {
  const good = makeGlyph({ n: 8, crown: 'the-estate', ground: 'one-ecosystem' });
  const p = await glyphPayload(good, sha);
  assert.equal(p.assessorPass, true, 'a coherent fold must EARN its pass');
  const back = await readGlyphPayload(p.payload, sha);
  assert.equal(back.ok, true);
  assert.deepEqual(back.glyph, good, 'the glyph must come back byte-equal');
  assert.equal(back.verdict.valid, true);

  // an incoherent glyph still mints — but with assessorPass FALSE (common, however pretty)
  const bent = { ...good, center: 'apex' };
  const pBad = await glyphPayload(bent, sha);
  assert.equal(pBad.assessorPass, false, 'an apexed glyph was given a pass');
  assert.equal((await readGlyphPayload(pBad.payload, sha)).verdict.valid, false);

  // tampering with the pattern after signing is caught
  const parsed = JSON.parse(p.payload);
  parsed.glyph.ring[0].kind = 'V';
  const tampered = await readGlyphPayload(JSON.stringify(parsed), sha);
  assert.equal(tampered.ok, false);
  assert.match(tampered.reason, /tampered/);

  assert.equal((await readGlyphPayload('not json', sha)).ok, false);
  assert.equal((await readGlyphPayload('{"kind":"other"}', sha)).ok, false);
});

test('FUZZ: pure kernels never throw on garbage', async () => {
  const garbage = [undefined, null, 0, -1, NaN, Infinity, '', 'x', true, [], {}, { ring: 'x' },
    { ring: [null, 1, 'y'], twist: 'k', center: 42 }, Symbol.iterator ? {} : {}, () => {},
    { crown: {}, ground: [], depth: -99, n: Infinity }];
  for (const g of garbage) {
    makeGlyph(g);
    canonGlyph(g);
    foldState(g, g);
    creasePattern(g, g);
    validGlyph(g);
    await foldSignature(g, sha);
    await readGlyphPayload(g, sha);
  }
  assert.ok(true);
});


// ─── round two: the gate found nine gaps in the kernel above — each dies here ───

test('GUARD ARITHMETIC IS EXACT — NaN falls to the default, a custom twist is honoured', () => {
  assert.equal(makeGlyph({ twist: NaN }).twist, KAPPA, 'NaN slid through the number guard');
  assert.equal(makeGlyph({ twist: Infinity }).twist, KAPPA);
  // foldState must read the GIVEN glyph, not a default: a 0.25 twist crosses at 0.25
  const quarter = makeGlyph({ twist: 0.25 });
  assert.equal(foldState(quarter, 0.3).reads, 'actual/folded', 'the custom twist was ignored');
  assert.equal(foldState(quarter, 0.2).reads, 'possibility/flat');
  assert.equal(foldState(quarter, 1).twistDeg, 90, 'twistDeg must use the glyph twist: 360·0.25');
});

test('THE THETA TOLERANCE IS EXCLUSIVE AT EXACTLY 1e-9 — measurement noise is not incoherence', () => {
  const g = makeGlyph({ n: 3 });
  const nudged = JSON.parse(JSON.stringify(g));
  nudged.ring[0].theta = 1e-9;   // exactly the tolerance off exact zero
  assert.equal(validGlyph(nudged).valid, true, 'a deviation of exactly 1e-9 must still fold');
});

test('THE NESTING CAP FIRES AT EXACTLY LEVEL 12', () => {
  let leaf = makeGlyph({ n: 3 });
  for (let i = 0; i < 13; i++) {
    const parent = makeGlyph({ n: 3 });
    parent.ring[0].sub = leaf;
    leaf = parent;
  }
  const v = validGlyph(leaf);
  assert.equal(v.valid, false, 'a 13-deep nest folded — the cap never fired');
  assert.ok(v.reasons.some(r => /nest deeper than any fold could/.test(r)));
});

test('THE SUB FLAG IN THE GEOMETRY IS EXACT — an object sub reads true, a truthy non-object false', () => {
  const g = makeGlyph({ n: 3 });
  const withSub = JSON.parse(JSON.stringify(g));
  withSub.ring[0].sub = makeGlyph({ n: 3 });
  const pts = creasePattern(withSub, 0).points;
  assert.equal(pts[0].sub, true, 'a real sub-glyph must flag its fold-point');
  assert.equal(pts[1].sub, false);
  const junkSub = JSON.parse(JSON.stringify(g));
  junkSub.ring[0].sub = 42;
  assert.equal(creasePattern(junkSub, 0).points[0].sub, false, 'a truthy non-object read as a sub');
  // and the canon ignores a non-object sub entirely
  assert.equal(canonGlyph(junkSub), canonGlyph(g), 'a junk sub leaked into the canon');
});

test('THE PAYLOAD GUARD REFUSES EACH ARM WITH THE RIGHT SENTENCE', async () => {
  const r1 = await readGlyphPayload('null', sha);
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'not a fold-glyph payload', 'JSON null must refuse cleanly, not crash');
  const r2 = await readGlyphPayload('{"kind":"fold-glyph","v":1}', sha);
  assert.equal(r2.reason, 'not a fold-glyph payload', 'a payload with no glyph must refuse as malformed, not "tampered"');
  const r3 = await readGlyphPayload('{"kind":"other","glyph":{}}', sha);
  assert.equal(r3.reason, 'not a fold-glyph payload', 'a foreign kind must refuse as malformed, not "tampered"');
});
