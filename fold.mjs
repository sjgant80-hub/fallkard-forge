// fallkard-forge · fold.mjs — FORGEUPGRADE: the fold-glyph payload type.
//
// A second compression medium for the forge. A structure is encoded as an origami
// CREASE PATTERN: a crown (transmit pole) radiating out to a golden-angle ring of
// fold-points that a ground (weave pole) gathers in, twisting at κ as it collapses,
// with an apex-less HOLE at the center that is never a crease. The FOLD MOTION is
// the teaching: t=0 is flat (possibility, creases latent), t=1 is folded (actual,
// collapsed), and the whole thing is reversible.
//
// The medium enforces the meaning: a twist fold physically has no central crease,
// so the encoding cannot misrepresent a structure as centralized. The tier is
// EARNED from whether the pattern folds coherently — a fold that does not close
// is common, however pretty.
//
// Pure and browser-safe: no I/O, no clock, no crypto of its own. Hashing is handed
// in (Node: createHash; browser: crypto.subtle), same convention as card.mjs. The
// glyph mints through the EXISTING forge — the crease-pattern JSON is the payload;
// this module adds no second forge.

export const GOLDEN_ANGLE = 137.50776405003785;   // 360 · (1 − 1/φ)
export const KAPPA = 0.6180339887498949;          // 1/φ — the twist, and the possibility/actual crossing

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampInt = (v, lo, hi, d) => {
  const n = Math.trunc(num(v, d));
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : d));
};
const str = (v, d) => (typeof v === 'string' && v.length ? v : d);

// ── the crease pattern (the data model) ─────────────────────────────────────
// Total on garbage: any input yields a well-formed glyph. Whether that glyph is
// COHERENT is validGlyph's judgement, not a construction-time refusal.
export function makeGlyph(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const n = clampInt(o.n, 3, 144, 8);
  const depth = clampInt(o.depth, 0, 12, 0);
  const ring = [];
  for (let i = 0; i < n; i++) {
    ring.push({
      i,
      theta: (i * GOLDEN_ANGLE) % 360,
      kind: i % 2 === 0 ? 'M' : 'V',   // mountain/valley must alternate or the twist cannot collapse flat
      depth,
    });
  }
  return {
    crown: str(o.crown, 'transmit'),
    ground: str(o.ground, 'weave'),
    ring,
    center: 'HOLE',                    // apex-less BY CONSTRUCTION — never a crease
    twist: num(o.twist, KAPPA),
    depth,
  };
}

// ── canonical form + fold-signature (the content address) ───────────────────
export function canonGlyph(glyph) {
  const g = (glyph && typeof glyph === 'object') ? glyph : {};
  const ring = Array.isArray(g.ring) ? g.ring : [];
  const nodes = ring.map(r => {
    const o = (r && typeof r === 'object') ? r : {};
    const sub = (o.sub && typeof o.sub === 'object') ? '(' + canonGlyph(o.sub) + ')' : '';
    return `${num(o.i, -1)}@${num(o.theta, -1).toFixed(9)}${String(o.kind)}${sub}`;
  });
  return [String(g.crown), String(g.ground), String(g.center), num(g.twist, -1).toFixed(12),
    num(g.depth, -1), nodes.join(',')].join('|');
}

// sha: async (string) => hex. Node hands in createHash, the page hands in crypto.subtle.
export async function foldSignature(glyph, sha) {
  if (typeof sha !== 'function') return null;
  const hex = await sha(canonGlyph(glyph));
  return typeof hex === 'string' ? hex.slice(0, 16) : null;
}

// ── the fold motion (the teaching — reversible, crosses κ) ──────────────────
export function foldState(glyph, t) {
  const g = (glyph && typeof glyph === 'object') ? glyph : {};
  const twist = num(g.twist, KAPPA);
  const tt = Math.max(0, Math.min(1, num(t, 0)));
  return {
    t: tt,
    collapse: tt,
    twistDeg: tt * 360 * twist,
    centerHole: 1 - tt,                                     // widest flat, tightest folded — NEVER a crease
    reads: tt < twist ? 'possibility/flat' : 'actual/folded',
  };
}

// ── the geometry the page draws (gated maths, dumb rendering) ───────────────
// Unit coordinates, center at 0,0. The ring gathers toward the ground pole as t→1,
// every point twists by the fold's rotation, and the hole tightens but never closes.
export function creasePattern(glyph, t) {
  const g = (glyph && typeof glyph === 'object') ? glyph : makeGlyph();
  const s = foldState(g, t);
  const ring = Array.isArray(g.ring) ? g.ring : [];
  const radius = 1 - 0.5 * s.t;                             // the gather
  const hole = 0.15 + 0.35 * s.centerHole;                  // 0.5 flat → 0.15 folded, never 0
  const points = ring.map(r => {
    const o = (r && typeof r === 'object') ? r : { theta: 0, kind: 'M' };
    const a = ((num(o.theta, 0) + s.twistDeg) * Math.PI) / 180;
    return {
      x: Math.cos(a) * radius,
      y: Math.sin(a) * radius,
      kind: o.kind === 'V' ? 'V' : 'M',
      sub: !!(o.sub && typeof o.sub === 'object'),
    };
  });
  return { hole, radius, rotationDeg: s.twistDeg, reads: s.reads, points };
}

// ── the assessor (the tier is earned, not chosen) ───────────────────────────
// A coherent pattern: apex-less center, two distinct poles, κ strictly inside (0,1),
// at least 3 fold-points on exact golden placement, kinds strictly alternating,
// and every sub-glyph coherent in its own right (ψ(ψ): fold within fold, apex-less
// at every level). Each failure is a sentence someone could act on.
export function validGlyph(glyph, _level = 0) {
  const reasons = [];
  if (!glyph || typeof glyph !== 'object') {
    return { valid: false, reasons: ['not a glyph'], folds: 0, deepest: 0 };
  }
  if (glyph.center !== 'HOLE') {
    reasons.push('the center must be a HOLE — a crease at the One is an apex, and a twist fold has none');
  }
  if (typeof glyph.crown !== 'string' || !glyph.crown) reasons.push('the crown (transmit pole) is missing');
  if (typeof glyph.ground !== 'string' || !glyph.ground) reasons.push('the ground (weave pole) is missing');
  if (typeof glyph.crown === 'string' && typeof glyph.ground === 'string' && glyph.crown === glyph.ground) {
    reasons.push('crown and ground must be two poles, not one point twice');
  }
  const twist = glyph.twist;
  if (typeof twist !== 'number' || !Number.isFinite(twist) || twist <= 0 || twist >= 1) {
    reasons.push('the twist must sit strictly inside (0,1) — at 0 nothing turns, at 1 the fold shears');
  }
  const ring = Array.isArray(glyph.ring) ? glyph.ring : null;
  let deepest = _level;
  if (!ring || ring.length < 3) {
    reasons.push('a twist needs at least 3 fold-points to close');
  } else {
    for (let i = 0; i < ring.length; i++) {
      const node = ring[i];
      if (!node || typeof node !== 'object') { reasons.push(`fold-point ${i} is not a fold-point`); continue; }
      const want = (i * GOLDEN_ANGLE) % 360;
      if (typeof node.theta !== 'number' || Math.abs(node.theta - want) > 1e-9) {
        reasons.push(`fold-point ${i} is off the golden placement — the twist does not close`);
      }
      const wantKind = i % 2 === 0 ? 'M' : 'V';
      if (node.kind !== wantKind) {
        reasons.push(`fold-point ${i} breaks the mountain/valley alternation — the pattern cannot collapse flat`);
      }
      if (node.sub) {
        if (_level >= 12) { reasons.push('sub-glyphs nest deeper than any fold could'); continue; }
        const sub = validGlyph(node.sub, _level + 1);
        deepest = Math.max(deepest, sub.deepest);
        if (!sub.valid) reasons.push(`the sub-glyph at fold-point ${i} does not fold: ${sub.reasons[0]}`);
      }
    }
  }
  return { valid: reasons.length === 0, reasons, folds: ring ? ring.length : 0, deepest };
}

// ── the payload (mints through the EXISTING forge — no second forge) ────────
// The returned string is the build payload for forge()/the page kernel. The card's
// assessor-pass is EARNED from the verdict; a glyph that does not fold coherently
// mints, but common — the forge's own tier rule, unchanged.
export async function glyphPayload(glyph, sha) {
  const verdict = validGlyph(glyph);
  return {
    payload: JSON.stringify({
      kind: 'fold-glyph',
      v: 1,
      glyph,
      foldSignature: await foldSignature(glyph, sha),
    }),
    verdict,
    assessorPass: verdict.valid,
  };
}

// Read one back: parse a hatched payload, verify the fold-signature, re-judge.
// Never throws — a garbage payload is {glyph: null, ok: false, reason}.
export async function readGlyphPayload(text, sha) {
  let p;
  try { p = JSON.parse(String(text)); } catch { return { glyph: null, ok: false, reason: 'not JSON' }; }
  if (!p || typeof p !== 'object' || p.kind !== 'fold-glyph' || !p.glyph) {
    return { glyph: null, ok: false, reason: 'not a fold-glyph payload' };
  }
  const expect = await foldSignature(p.glyph, sha);
  if (expect !== null && p.foldSignature !== expect) {
    return { glyph: p.glyph, ok: false, reason: 'fold-signature does not match the pattern — tampered' };
  }
  return { glyph: p.glyph, ok: true, reason: null, verdict: validGlyph(p.glyph) };
}

export default makeGlyph;
