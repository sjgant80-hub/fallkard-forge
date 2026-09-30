// ════════════════════════════════════════════════════════════════════════════════════════════════
// sealmark.mjs · THE VISIBLE SEAL — CARD-SPEC §7.1
//
// A platform that strips a card's chunks leaves only the picture. CARD-SPEC §7 says a stripped card
// "still verifies by hash": the seal printed on its face resolves the payload from a deck the holder
// already has. This module is that printed seal, made so a person, a vision model and a few lines of
// pixel sampling can all read it back.
//
// It is PRINTED IN PLAIN SIGHT, like a serial number. It carries the first 80 bits of the seal and
// nothing else — never payload, never hidden bits. Mode B stands: nothing about a card is concealed.
//
// The design comes from a measurement. kar-pixel-cost's sealed read-back (2026-09-30) had a vision
// model transcribe 64 rendered texts blind: every miss was a character slip, never a word — O read as
// 0, C read as c, curly quotes read straight, an extra 0 in a hex run, and a 98-long run of one glyph
// read as 104 of another. So:
//   · the alphabet is Crockford base32 — no I, L, O or U, read case-blind, with O→0 and I/L→1 folded
//     back on reading: the look-alikes that broke exactness cannot occur in a code;
//   · the code is printed in groups of four — no long runs to miscount;
//   · the glyphs are a blocky 5×7 bitmap font whose every pair differs in at least MIN_GLYPH_DISTANCE
//     dots, so a read with two damaged dots in a glyph still lands on the right symbol;
//   · a read is resolved against the holder's deck by edit distance, so a slip is corrected, and a
//     read that could be two cards is refused rather than guessed.
//
// Pure: no I/O, no clock, no crypto, no canvas. Drawing and pixel sampling are handed in, the same
// convention as card.mjs — the Node forge paints into its raster, the page into a canvas.
// ════════════════════════════════════════════════════════════════════════════════════════════════

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_SYMBOLS = 16;                   // 16 × 5 bits = the first 80 bits of the seal
export const GROUP = 4;
export const GLYPH_W = 5, GLYPH_H = 7, ADVANCE = 6;
export const MIN_GLYPH_DISTANCE = 5;

// the 5×7 font: '#' is ink. Every pair of the 32 differs in ≥ MIN_GLYPH_DISTANCE dots (asserted).
export const GLYPHS = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  'A': ['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
  'B': ['####.', '#...#', '#..#.', '###..', '#..#.', '#...#', '####.'],
  'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  'D': ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '###..', '#....', '#....', '#....'],
  'G': ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'J': ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  'P': ['####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
};

const isStr = (v) => typeof v === 'string';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const inkOf = (g) => GLYPHS[g].join('');
// every dot of a glyph as [row, column], in reading order — one list, so no loop bound can drift
const DOTS = Array.from({ length: GLYPH_H * GLYPH_W }, (_, i) => [Math.floor(i / GLYPH_W), i % GLYPH_W]);
const hamming = (a, b) => [...a].reduce((d, ch, i) => d + (ch === b[i] ? 0 : 1), 0);

// glyphDistance(a, b) — how many of the 35 dots differ between two glyphs.
export function glyphDistance(a, b) {
  if (!isStr(a) || !isStr(b) || !GLYPHS[a] || !GLYPHS[b]) return null;
  return hamming(inkOf(a), inkOf(b));
}

// sealCode(sealHex) — the printed code: the first 80 bits of the seal in Crockford base32, grouped
// 'XXXX-XXXX-XXXX-XXXX'. Anything that is not at least 20 hex digits has no code.
export function sealCode(sealHex) {
  if (!isStr(sealHex) || !/^[0-9a-fA-F]{20}/.test(sealHex)) return null;
  const bits = sealHex.slice(0, 20).split('').map((h) => parseInt(h, 16).toString(2).padStart(4, '0')).join('');
  let out = '';
  for (let i = 0; i < CODE_SYMBOLS; i++) {
    if (i && i % GROUP === 0) out += '-';
    out += ALPHABET[parseInt(bits.slice(i * 5, i * 5 + 5), 2)];
  }
  return out;
}

// The read rule has versions (CARD-SPEC §7.1). 0.1 is the rule as first specified. 0.2 (2026-09-30) also reads U as V:
// the fold the creatures of kard-evolve found untold — the champion UV|515 at generation 14 of the sealed run, and the
// self-observing creature at generation 1 — shipped only after its own sealed measurement (data/uv-prereg.json).
// Every experiment sealed under 0.1 is still graded under 0.1.
export const READ_RULES = ['0.1', '0.2'];
export const READ_RULE = '0.2';

// normalizeCode(text, rule) — what a read means: case-blind, O→0, I and L→1, separators and spaces dropped, and from
// rule 0.2 U→V. '?' stands for a symbol that could not be read and is kept. Any other character makes it no code.
export function normalizeCode(text, rule = READ_RULE) {
  if (!isStr(text) || !READ_RULES.includes(rule)) return null;
  const folded = text.toUpperCase().replace(/[\s\-_.·]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const s = rule === '0.1' ? folded : folded.replace(/U/g, 'V');
  for (const ch of s) if (ch !== '?' && !ALPHABET.includes(ch)) return null;
  return s;
}

// readDistance(read, code) — edits between a read and a card's code; a '?' in the read matches any
// symbol for free, because it says only that the symbol was not seen.
export function readDistance(read, code) {
  if (!isStr(read) || !isStr(code)) return null;
  let prev = Array.from({ length: code.length + 1 }, (_, j) => j);
  for (let i = 1; i <= read.length; i++) {
    const cur = [i];
    for (let j = 1; j <= code.length; j++) {
      const same = read[i - 1] === '?' || read[i - 1] === code[j - 1];
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
    }
    prev = cur;
  }
  return prev[code.length];
}

// resolveCode(text, seals, opts) — which card in the deck this read is. Accepted only when the nearest
// card is within maxEdits AND no other card is within margin of it, and when enough was seen.
export function resolveCode(text, seals, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const maxEdits = Number.isInteger(o.maxEdits) ? o.maxEdits : 3;
  const margin = Number.isInteger(o.margin) ? o.margin : 3;
  const maxUnknown = Number.isInteger(o.maxUnknown) ? o.maxUnknown : 4;
  const read = normalizeCode(text, o.rule === undefined ? READ_RULE : o.rule);
  if (read === null || read.length === 0) return { ok: false, why: 'the read is not a seal code' };
  const unknown = read.split('').filter((c) => c === '?').length;
  if (unknown > maxUnknown) return { ok: false, why: 'too little of the seal could be read', read };
  if (!Array.isArray(seals)) return { ok: false, why: 'no deck to resolve against', read };
  const scored = [];
  seals.forEach((seal, index) => {
    const code = sealCode(seal);
    if (code !== null) scored.push({ index, seal, edits: readDistance(read, code.replace(/-/g, '')) });
  });
  if (scored.length === 0) return { ok: false, why: 'no card in the deck has a seal', read };
  scored.sort((a, b) => a.edits - b.edits);
  const best = scored[0], next = scored[1];
  if (best.edits > maxEdits) return { ok: false, why: 'no card in the deck is within ' + maxEdits + ' edits of the read', read, nearest: best.edits };
  if (next && next.edits - best.edits < margin) return { ok: false, why: 'the read could be more than one card', read };
  return { ok: true, index: best.index, seal: best.seal, edits: best.edits, unknown, read };
}

// bandLayout(width, height) — where the band sits. Geometry is fixed on the 440×616 card and scales
// with the picture, so a reader finds it in a resized copy too.
export const REF_W = 440, REF_H = 616;
export const BAND = { x: 20, y: 556, w: 400, h: 36, dot: 3 };
export function bandLayout(width, height) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null;
  const sx = width / REF_W, sy = height / REF_H;
  const chars = CODE_SYMBOLS + CODE_SYMBOLS / GROUP - 1;
  const textW = (chars * ADVANCE - 1) * BAND.dot, textH = GLYPH_H * BAND.dot;
  const tx = Math.floor((REF_W - textW) / 2), ty = BAND.y + Math.floor((BAND.h - textH) / 2);
  return { sx, sy, chars, band: { x: BAND.x * sx, y: BAND.y * sy, w: BAND.w * sx, h: BAND.h * sy }, text: { x: tx * sx, y: ty * sy, dotW: BAND.dot * sx, dotH: BAND.dot * sy } };
}

// paintBand(rect, code, width, height, colours) — draws the band by handing rectangles to rect(x, y,
// w, h, rgb): the background, then one block per inked dot. Returns how many dots were inked.
export const BAND_PAPER = [243, 234, 210], BAND_INK = [21, 18, 28];
export function paintBand(rect, code, width, height) {
  const L = bandLayout(width, height);
  if (!L || typeof rect !== 'function' || !isStr(code) || code.length !== L.chars) return 0;
  for (const ch of code) if (!GLYPHS[ch]) return 0;
  rect(L.band.x, L.band.y, L.band.w, L.band.h, BAND_PAPER);
  let inked = 0;
  for (let k = 0; k < code.length; k++) {
    const g = GLYPHS[code[k]];
    for (const [r, c] of DOTS) {
      if (g[r][c] !== '#') continue;
      rect(L.text.x + (k * ADVANCE + c) * L.text.dotW, L.text.y + r * L.text.dotH, L.text.dotW, L.text.dotH, BAND_INK);
      inked++;
    }
  }
  return inked;
}

// readBand(luma, width, height) — reads the printed code back out of a picture. luma(x, y) → 0..255 is
// handed in. Each symbol cell is sampled at its 35 dot centres, thresholded halfway between its own
// darkest and lightest sample, and matched to the nearest glyph; a cell with too little contrast, or
// more than two dots from every glyph, reads '?'. Returns the read (separators kept) and each cell.
export function readBand(luma, width, height) {
  const L = bandLayout(width, height);
  if (typeof luma !== 'function' || !L) return null;
  const symbols = ALPHABET.split('');
  const cells = [];
  let read = '';
  for (let k = 0; k < L.chars; k++) {
    if (k % (GROUP + 1) === GROUP) { read += '-'; continue; }
    const v = DOTS.map(([r, c]) => {
      const y = luma(L.text.x + (k * ADVANCE + c + 0.5) * L.text.dotW, L.text.y + (r + 0.5) * L.text.dotH);
      return Number.isFinite(y) ? y : 255;
    });
    const lo = Math.min(...v), hi = Math.max(...v);
    if (hi - lo < 48) { cells.push({ symbol: '?', nearest: null, distance: null, contrast: hi - lo }); read += '?'; continue; }
    const mid = (lo + hi) / 2, ink = v.map((y) => (y < mid ? '#' : '.')).join('');
    let best = null, bestD = Infinity;
    for (const s of symbols) {
      const d = hamming(inkOf(s), ink);
      if (d < bestD) { bestD = d; best = s; }             // the first glyph at the least distance wins
    }
    const sure = bestD <= Math.floor((MIN_GLYPH_DISTANCE - 1) / 2);
    cells.push({ symbol: sure ? best : '?', nearest: best, distance: bestD, contrast: hi - lo });
    read += sure ? best : '?';
  }
  return { read, cells, unknown: cells.filter((c) => c.symbol === '?').length };
}

// ── the survival run (data/survive-prereg.json) ─────────────────────────────────────────────────────
// tallySurvival(seals, reads, transforms, rule) — from the raw reads alone, re-resolved here: nothing the run
// reported about which card it found is taken on trust. reads[t.id][i] is card i's read under transform t. Graded
// under read rule 0.1 unless told otherwise — the rule it was sealed with.
export function tallySurvival(seals, reads, transforms, rule = '0.1') {
  if (!Array.isArray(seals) || seals.length === 0 || !reads || typeof reads !== 'object' || !Array.isArray(transforms) || transforms.length === 0) return { ok: false, why: 'seals, reads and transforms' };
  const rows = [];
  for (const t of transforms) {
    const rs = t && reads[t.id];
    if (!Array.isArray(rs) || rs.length !== seals.length) return { ok: false, why: 'every transform needs one read per card' };
    const row = { id: t.id, realistic: t.realistic === true, n: rs.length, exact: 0, right: 0, wrong: 0, refused: 0, unknown: 0 };
    rs.forEach((r, i) => {
      const read = r && isStr(r.read) ? r.read : '';
      const code = (sealCode(seals[i]) || '').replace(/-/g, '');
      if (normalizeCode(read, rule) === code) row.exact++;
      row.unknown += (read.match(/\?/g) || []).length;
      const k = resolveCode(read, seals, { rule });
      if (!k.ok) row.refused++;
      else if (k.seal === seals[i]) row.right++;
      else row.wrong++;
    });
    row.meanUnknown = Math.round((row.unknown / row.n) * 100) / 100;
    rows.push(row);
  }
  return { ok: true, rows };
}

// judgeSurvival(tally) — the four rules sealed in data/survive-prereg.json, each with the number that decided it.
export function judgeSurvival(tally) {
  if (!tally || tally.ok !== true || !Array.isArray(tally.rows) || tally.rows.some((r) => !r || typeof r !== 'object')) return { ok: false, why: 'a tally from tallySurvival' };
  const by = Object.fromEntries(tally.rows.map((r) => [r.id, r]));
  const real = tally.rows.filter((r) => r.realistic);
  const wrong = tally.rows.reduce((s, r) => s + r.wrong, 0);
  const png = by.png, third = by.png35;
  const rules = [
    { id: 'stripped-exact', pass: !!png && png.exact === png.n, value: png ? png.exact + '/' + png.n + ' exact' : 'not run' },
    { id: 'platform-ladder', pass: real.length > 0 && real.every((r) => r.right === r.n), value: real.map((r) => r.right).reduce((a, b) => a + b, 0) + '/' + real.reduce((a, r) => a + r.n, 0) + ' right' },
    { id: 'never-wrong', pass: wrong === 0, value: wrong + ' wrong' },
    { id: 'third-size', pass: !!third && third.right / third.n >= 0.9, value: third ? third.right + '/' + third.n + ' right' : 'not run' },
  ];
  return { ok: true, rules, passed: rules.filter((r) => r.pass).length, of: rules.length };
}

// ── shipping a read-rule change (data/uv-prereg.json) ───────────────────────────────────────────────
// compareRules(reads, seals, from, to) — every read [{ read, card }] resolved under two read rules: how many are right,
// wrong, refused and exact under each, which it fixes (not right before, right after), which it breaks (right before,
// not after), and which exact reads it would lose.
export function compareRules(reads, seals, from, to) {
  if (!Array.isArray(reads) || !Array.isArray(seals) || seals.length === 0 || !READ_RULES.includes(from) || !READ_RULES.includes(to) || reads.some((r) => !isObj(r) || !Number.isInteger(r.card) || !seals[r.card])) return { ok: false, why: 'reads [{ read, card }], the deck, and two read rules' };
  const tally = () => ({ right: 0, wrong: 0, refused: 0, exact: 0 });
  const before = tally(), after = tally(), fixed = [], broken = [], lostExact = [];
  const judge = (r, rule) => {
    const code = sealCode(seals[r.card]).replace(/-/g, ''), k = resolveCode(r.read, seals, { rule });
    return { exact: normalizeCode(r.read, rule) === code, outcome: !k.ok ? 'refused' : k.seal === seals[r.card] ? 'right' : 'wrong' };
  };
  reads.forEach((r, i) => {
    const a = judge(r, from), b = judge(r, to);
    before[a.outcome]++; after[b.outcome]++;
    if (a.exact) before.exact++;
    if (b.exact) after.exact++;
    if (a.outcome !== 'right' && b.outcome === 'right') fixed.push(i);
    if (a.outcome === 'right' && b.outcome !== 'right') broken.push(i);
    if (a.exact && !b.exact) lostExact.push(i);
  });
  return { ok: true, n: reads.length, before, after, fixed, broken, lostExact };
}

// judgeUV(parts) — the five rules sealed for shipping U→V, each with the number that decided it. parts: compareRules
// results for the recorded replies, the recorded replies that hold a U, the survival run's pixel reads and every
// V-card written with U; and the survival tallies under both rules.
export function judgeUV(parts) {
  const c = (x) => isObj(x) && x.ok === true && isObj(x.before) && isObj(x.after) && Array.isArray(x.broken) && Array.isArray(x.lostExact);
  const p = isObj(parts) ? parts : {};
  if (!c(p.recorded) || !c(p.uReads) || !c(p.pixels) || !c(p.everyV) || !isObj(p.survivalBefore) || !isObj(p.survivalAfter)) return { ok: false, why: 'recorded, uReads, pixels and everyV from compareRules, and the survival tallies before and after' };
  const broken = p.recorded.broken.length + p.pixels.broken.length, lost = p.recorded.lostExact.length + p.pixels.lostExact.length;
  const wrong = p.recorded.after.wrong + p.pixels.after.wrong;
  const rules = [
    { id: 'fixes-the-seven', pass: p.uReads.n > 0 && p.uReads.after.right === p.uReads.n && p.uReads.before.right === 0, value: p.uReads.after.right + ' of ' + p.uReads.n + ' now resolve to the right card (' + p.uReads.before.right + ' before)' },
    { id: 'breaks-nothing', pass: broken === 0 && lost === 0, value: broken + ' broken, ' + lost + ' exact reads lost, across ' + (p.recorded.n + p.pixels.n) + ' reads' },
    { id: 'never-wrong', pass: wrong === 0, value: wrong + ' wrong cards across ' + (p.recorded.n + p.pixels.n) + ' reads' },
    { id: 'pixels-unchanged', pass: JSON.stringify(p.survivalBefore) === JSON.stringify(p.survivalAfter), value: JSON.stringify(p.survivalBefore) === JSON.stringify(p.survivalAfter) ? 'every row identical' : 'the tally changed' },
    { id: 'every-v-as-u', pass: p.everyV.n > 0 && p.everyV.after.right === p.everyV.n && p.everyV.before.right === 0, value: p.everyV.after.right + ' of ' + p.everyV.n + ' now resolve (' + p.everyV.before.right + ' before)' },
  ];
  return { ok: true, rules, passed: rules.filter((r) => r.pass).length, of: rules.length };
}

export default { ALPHABET, GLYPHS, READ_RULES, READ_RULE, compareRules, judgeUV, sealCode, normalizeCode, readDistance, resolveCode, bandLayout, paintBand, readBand, glyphDistance, tallySurvival, judgeSurvival };
