// sealmark.test.mjs — the visible seal (CARD-SPEC §7.1): the code, the font, the reading and the resolving.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHABET, CODE_SYMBOLS, GROUP, GLYPH_W, GLYPH_H, ADVANCE, MIN_GLYPH_DISTANCE, GLYPHS, REF_W, REF_H, BAND, BAND_PAPER, BAND_INK,
  READ_RULES, READ_RULE, compareRules, judgeUV, glyphDistance, sealCode, normalizeCode, readDistance, resolveCode, bandLayout, paintBand, readBand, tallySurvival, judgeSurvival,
} from './sealmark.mjs';

// a code back to the hex it came from — an independent inverse, so sealCode is not checked against itself
const codeToHex = (code) => {
  const bits = code.replace(/-/g, '').split('').map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, '0')).join('');
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
};
// a tiny raster: rect() paints luma, luma() samples it — what the Node forge and the page each hand in
const raster = (w, h) => {
  const px = new Float64Array(w * h).fill(90);
  const toLuma = (rgb) => 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return {
    px, w, h,
    rect: (x, y, rw, rh, rgb) => { for (let yy = Math.round(y); yy < Math.round(y + rh); yy++) for (let xx = Math.round(x); xx < Math.round(x + rw); xx++) if (xx >= 0 && yy >= 0 && xx < w && yy < h) px[yy * w + xx] = toLuma(rgb); },
    luma: (x, y) => { const xx = Math.floor(x), yy = Math.floor(y); return xx >= 0 && yy >= 0 && xx < w && yy < h ? px[yy * w + xx] : undefined; },
  };
};
// area-average a raster down by an integer factor, as a platform's resize would
const shrink = (r, f) => {
  const w = Math.floor(r.w / f), h = Math.floor(r.h / f), out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += r.px[(y * f + dy) * r.w + x * f + dx]; out[y * w + x] = s / (f * f); }
  return { w, h, luma: (x, y) => { const xx = Math.floor(x), yy = Math.floor(y); return xx >= 0 && yy >= 0 && xx < w && yy < h ? out[yy * w + xx] : undefined; } };
};
const SEAL_A = '3f9a0c21d4e87b65a10f2c3d4e5f60718293a4b5c6d7e8f90112233445566778';
const SEAL_B = 'c07e11aa92b3445d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5';

test('the font: 32 symbols and a separator, 5×7, every pair at least MIN_GLYPH_DISTANCE dots apart', () => {
  assert.equal(ALPHABET.length, 32);
  assert.equal(new Set(ALPHABET).size, 32);
  for (const bad of 'ILOU') assert.ok(!ALPHABET.includes(bad), bad + ' is not in the alphabet');
  assert.deepEqual(Object.keys(GLYPHS).sort(), [...ALPHABET, '-'].sort());
  for (const [k, g] of Object.entries(GLYPHS)) {
    assert.equal(g.length, GLYPH_H, k);
    for (const row of g) { assert.equal(row.length, GLYPH_W, k); assert.match(row, /^[#.]+$/); }
    assert.ok(g.join('').includes('#'), k + ' has ink');
  }
  let min = Infinity;
  for (let i = 0; i < 32; i++) for (let j = i + 1; j < 32; j++) min = Math.min(min, glyphDistance(ALPHABET[i], ALPHABET[j]));
  assert.equal(min, MIN_GLYPH_DISTANCE);
  assert.equal(glyphDistance('A', 'A'), 0);
  assert.equal(glyphDistance('8', 'B'), 8);
  assert.equal(glyphDistance('M', 'N'), 5);
  for (const [a, b] of [['A', 'O'], ['A', 'a'], [null, 'A'], ['A', 3]]) assert.equal(glyphDistance(a, b), null);
  assert.deepEqual([CODE_SYMBOLS, GROUP, ADVANCE, REF_W, REF_H], [16, 4, 6, 440, 616]);
});

test('sealCode: the first 80 bits of the seal, Crockford base32, grouped in fours', () => {
  assert.equal(sealCode('f'.repeat(64)), 'ZZZZ-ZZZZ-ZZZZ-ZZZZ');
  assert.equal(sealCode('0'.repeat(64)), '0000-0000-0000-0000');
  assert.equal(sealCode(SEAL_A), '7YD0-R8EM-X1XP-B88F');
  assert.equal(codeToHex(sealCode(SEAL_A)), SEAL_A.slice(0, 20));
  assert.equal(codeToHex(sealCode(SEAL_B)), SEAL_B.slice(0, 20));
  assert.equal(sealCode(SEAL_A.toUpperCase()), sealCode(SEAL_A));
  assert.equal(sealCode(SEAL_A.slice(0, 20)), sealCode(SEAL_A));
  assert.equal(sealCode('8000000000000000000' + '0'), 'G000-0000-0000-0000');
  assert.equal(sealCode('0000000000000000001f'), '0000-0000-0000-000Z');
  for (const bad of [null, 5, '', 'abc', 'a'.repeat(19), 'g' + 'a'.repeat(30), ' ' + 'a'.repeat(30)]) assert.equal(sealCode(bad), null);
});

test('normalizeCode: case-blind, O→0, I and L→1, separators dropped, ? kept, anything else refused', () => {
  assert.equal(normalizeCode('7yd0-r8em x1xp_b88f'), '7YD0R8EMX1XPB88F');
  assert.equal(normalizeCode('OoIiLl'), '001111');
  assert.equal(normalizeCode('7YD?·R8EM'), '7YD?R8EM');
  assert.equal(normalizeCode('.a'), 'A');
  assert.equal(normalizeCode(''), '');
  for (const bad of ['7YD0!', 'é', null, 42]) assert.equal(normalizeCode(bad), null);
  // rule 0.1, the rule every sealed experiment was graded with: U is no symbol
  for (const bad of ['U', 'u123']) assert.equal(normalizeCode(bad, '0.1'), null);
  assert.equal(normalizeCode('OoIiLl', '0.1'), '001111');
  // rule 0.2, current: U reads as V — the creatures' fold
  assert.deepEqual([READ_RULES, READ_RULE], [['0.1', '0.2'], '0.2']);
  assert.equal(normalizeCode('U'), 'V');
  assert.equal(normalizeCode('u123'), 'V123');
  assert.equal(normalizeCode('6WHU-DDBJ', '0.2'), '6WHVDDBJ');
  assert.equal(normalizeCode('uoil', '0.2'), 'V011');
  for (const bad of ['0.3', '', null, 2]) assert.equal(normalizeCode('ABC', bad), null);
});

test('readDistance: edits, with ? matching anything for free', () => {
  assert.equal(readDistance('ABCD', 'ABCD'), 0);
  assert.equal(readDistance('ABXD', 'ABCD'), 1);
  assert.equal(readDistance('AB?D', 'ABCD'), 0);
  assert.equal(readDistance('ABCCD', 'ABCD'), 1);
  assert.equal(readDistance('ABD', 'ABCD'), 1);
  assert.equal(readDistance('', 'ABC'), 3);
  assert.equal(readDistance('ABC', ''), 3);
  assert.equal(readDistance('????', 'ABCD'), 0);
  assert.equal(readDistance('BA', 'AB'), 2);
  for (const [a, b] of [[null, 'A'], ['A', 7]]) assert.equal(readDistance(a, b), null);
});

test('resolveCode: the nearest card in the deck, corrected — or a refusal, never a guess', () => {
  const deck = [SEAL_B, SEAL_A, 'not a seal'];
  const exact = resolveCode('7YD0-R8EM-X1XP-B88F', deck);
  assert.deepEqual([exact.ok, exact.index, exact.seal, exact.edits, exact.unknown], [true, 1, SEAL_A, 0, 0]);
  // the slips measured in kar-pixel-cost's read-back: case, O for 0, an extra symbol, a wrong one
  assert.equal(resolveCode('7yd0 r8em x1xp b88f', deck).edits, 0);
  assert.equal(resolveCode('7YDO-R8EM-X1XP-B88F', deck).edits, 0);
  assert.deepEqual([resolveCode('7YD00-R8EM-X1XP-B88F', deck).ok, resolveCode('7YD00-R8EM-X1XP-B88F', deck).edits], [true, 1]);
  assert.deepEqual([resolveCode('7YD0-R8EM-X1XP-888F', deck).seal, resolveCode('7YD0-R8EM-X1XP-888F', deck).edits], [SEAL_A, 1]);
  assert.equal(resolveCode('7Y?0-R8?M-X1XP-B88F', deck).unknown, 2);
  assert.equal(resolveCode('7Y?0-R8?M-X1XP-B88F', deck).edits, 0);
  // three edits is the default limit, four is refused
  assert.equal(resolveCode('ZZZ0-R8EM-X1XP-B88F', deck).ok, true);
  assert.match(resolveCode('ZZZZ-R8EM-X1XP-B88F', deck).why, /within 3 edits/);
  assert.equal(resolveCode('ZZZZ-R8EM-X1XP-B88F', deck).nearest, 4);
  assert.equal(resolveCode('ZZZZ-R8EM-X1XP-B88F', deck, { maxEdits: 4 }).ok, true);
  // too many unseen symbols
  assert.equal(resolveCode('????-R8EM-X1XP-B88F', deck).ok, true);
  assert.match(resolveCode('?????-R8EM-X1XP-B88F', deck).why, /too little/);
  assert.equal(resolveCode('?????R8EMX1XPB88F', deck, { maxUnknown: 5 }).ok, true);
  // two cards close together: a read between them is refused, not guessed
  const twin = '3f9a0c21d4e87b65a10e' + 'f'.repeat(44);           // same code but its last symbol
  assert.notEqual(sealCode(twin), sealCode(SEAL_A));
  assert.match(resolveCode('7YD0-R8EM-X1XP-B88F', [SEAL_A, twin]).why, /more than one card/);
  assert.equal(resolveCode('7YD0-R8EM-X1XP-B88F', [SEAL_A, twin], { margin: 1 }).ok, true);
  assert.equal(resolveCode('7YD0-R8EM-X1XP-B88F', [SEAL_A, SEAL_B], { margin: 99 }).ok, false);
  // a deck of one needs no margin
  assert.equal(resolveCode('7YD0-R8EM-X1XP-B88F', [SEAL_A]).ok, true);
  // rule 0.1 refuses a U; rule 0.2 reads it as V and finds the card
  assert.match(resolveCode('U', deck, { rule: '0.1' }).why, /not a seal code/);
  assert.match(resolveCode('7YD0-R8EM-X1XP-B88F', deck, { rule: '9.9' }).why, /not a seal code/);
  const vCard = sealCode(SEAL_B);
  assert.ok(vCard.includes('V'));
  assert.equal(resolveCode(vCard.replace(/V/g, 'U'), deck).seal, SEAL_B);
  assert.equal(resolveCode(vCard.replace(/V/g, 'U'), deck, { rule: '0.2' }).edits, 0);
  assert.equal(resolveCode(vCard.replace(/V/g, 'U'), deck, { rule: '0.1' }).ok, false);
  for (const [t, d, re] of [['!', deck, /not a seal code/], ['', deck, /not a seal code/], [null, deck, /not a seal code/], ['7YD0', null, /no deck/], ['7YD0', ['x', 5], /no card in the deck has a seal/], ['7YD0', [], /no card in the deck has a seal/]]) assert.match(resolveCode(t, d).why, re);
});

test('bandLayout: fixed on the 440×616 card, scaled with the picture', () => {
  const L = bandLayout(440, 616);
  assert.deepEqual(L.band, { x: BAND.x, y: BAND.y, w: BAND.w, h: BAND.h });
  assert.equal(L.chars, 19);
  assert.deepEqual(L.text, { x: 50, y: 563, dotW: 3, dotH: 3 });
  const H = bandLayout(220, 308);
  assert.deepEqual([H.sx, H.sy, H.text.x, H.text.y, H.text.dotW, H.band.w], [0.5, 0.5, 25, 281.5, 1.5, 200]);
  for (const [w, h] of [[0, 616], [440, 0], [440, -1], [-440, 616], [NaN, 1], [1, NaN], ['440', 616], [440, '616'], [Infinity, 1], [1, Infinity]]) assert.equal(bandLayout(w, h), null);
});

test('paintBand: the paper, then one block per inked dot', () => {
  const calls = [];
  const inked = paintBand((...a) => calls.push(a), sealCode(SEAL_A), 440, 616);
  const expectInk = sealCode(SEAL_A).split('').reduce((s, ch) => s + GLYPHS[ch].join('').split('#').length - 1, 0);
  assert.equal(inked, expectInk);
  assert.equal(calls.length, expectInk + 1);
  assert.deepEqual(calls[0], [20, 556, 400, 36, BAND_PAPER]);
  assert.deepEqual(calls[1].slice(2), [3, 3, BAND_INK]);
  assert.ok(calls.slice(1).every((c) => c[4] === BAND_INK));
  // the first inked dot of '7' is its top-left
  assert.deepEqual(calls[1].slice(0, 2), [50, 563]);
  for (const bad of [[() => {}, 'SHORT', 440, 616], [() => {}, sealCode(SEAL_A).replace('7', 'U'), 440, 616], [null, sealCode(SEAL_A), 440, 616], [() => {}, sealCode(SEAL_A), 0, 616], [() => {}, 5, 440, 616]]) assert.equal(paintBand(...bad), 0);
});

test('readBand: a painted code reads back exactly — clean, damaged, and at half size', () => {
  const code = sealCode(SEAL_A);
  const r = raster(440, 616);
  paintBand(r.rect, code, 440, 616);
  const clean = readBand(r.luma, 440, 616);
  assert.equal(clean.read, code);
  assert.equal(clean.unknown, 0);
  assert.equal(clean.cells.length, 16);
  assert.ok(clean.cells.every((c) => c.distance === 0 && c.contrast > 100));
  // two damaged dots in every glyph: still exact (the font's minimum distance is 5)
  const L = bandLayout(440, 616);
  const flip = (k, r0, c0) => { const x = Math.round(L.text.x + (k * ADVANCE + c0) * 3), y = Math.round(L.text.y + r0 * 3); const now = r.px[(y + 1) * 440 + x + 1]; r.rect(x, y, 3, 3, now < 100 ? BAND_PAPER : BAND_INK); };
  for (let k = 0; k < 19; k++) { if (k % 5 === 4) continue; flip(k, 0, 0); flip(k, 6, 4); }
  const hurt = readBand(r.luma, 440, 616);
  assert.equal(hurt.read, code);
  assert.ok(hurt.cells.every((c) => c.distance === 2));
  // a third damaged dot in one glyph: that cell is not trusted, and the deck still resolves it
  flip(0, 3, 2);
  const worse = readBand(r.luma, 440, 616);
  assert.equal(worse.read[0], '?');
  assert.equal(worse.unknown, 1);
  assert.equal(resolveCode(worse.read, [SEAL_B, SEAL_A]).seal, SEAL_A);
  // half size, area-averaged like a platform's resize
  const big = raster(880, 1232);
  paintBand(big.rect, code, 880, 1232);
  assert.equal(readBand(big.luma, 880, 1232).read, code);
  assert.equal(readBand(shrink(big, 2).luma, 440, 616).read, code);
  assert.equal(readBand(shrink(big, 4).luma, 220, 308).read, code);
  // no band at all: nothing has contrast, every symbol is unseen
  const blank = raster(440, 616);
  const none = readBand(blank.luma, 440, 616);
  assert.equal(none.read, '????-????-????-????');
  assert.equal(none.unknown, 16);
  assert.equal(none.cells[0].contrast, 0);
  // a sampler that answers nothing reads as paper
  assert.equal(readBand(() => undefined, 440, 616).unknown, 16);
  for (const bad of [[null, 440, 616], [r.luma, 0, 616], [r.luma, 440, NaN]]) assert.equal(readBand(...bad), null);
});

test('readBand: a dot exactly on the threshold reads as paper; a tie goes to the first glyph in the alphabet', () => {
  const L = bandLayout(440, 616);
  const grey = () => { const r = raster(440, 616); paintBand((x, y, w, h, rgb) => r.rect(x, y, w, h, rgb === BAND_INK ? [100, 100, 100] : [200, 200, 200]), '8000-0000-0000-0000', 440, 616); return r; };
  const setDot = (r, k, row, col, v) => r.rect(L.text.x + (k * ADVANCE + col) * 3, L.text.y + row * 3, 3, 3, [v, v, v]);
  // an ink dot of the first glyph moved to exactly halfway (150): not ink, so one dot off '8'
  const r1 = grey();
  setDot(r1, 0, 0, 1, 150);
  const c1 = readBand(r1.luma, 440, 616).cells[0];
  assert.deepEqual([c1.symbol, c1.nearest, c1.distance], ['8', '8', 1]);
  // a pattern exactly between '8' and 'B': four of the eight dots where they differ, moved to B's side
  const g8 = GLYPHS['8'].join(''), gB = GLYPHS['B'].join('');
  const diff = [...g8].map((ch, i) => (ch === gB[i] ? -1 : i)).filter((i) => i >= 0);
  assert.equal(diff.length, 8);
  const r2 = grey();
  for (const i of diff.slice(0, 4)) setDot(r2, 0, Math.floor(i / GLYPH_W), i % GLYPH_W, gB[i] === '#' ? 100 : 200);
  const c2 = readBand(r2.luma, 440, 616).cells[0];
  const ink = [...g8].map((ch, i) => (diff.slice(0, 4).includes(i) ? gB[i] : ch)).join('');
  const dist = ALPHABET.split('').map((s) => [s, [...GLYPHS[s].join('')].reduce((d, ch, i) => d + (ch === ink[i] ? 0 : 1), 0)]);
  const least = Math.min(...dist.map(([, d]) => d)), atLeast = dist.filter(([, d]) => d === least).map(([s]) => s);
  assert.ok(atLeast.length >= 2, 'a real tie');
  assert.deepEqual([c2.symbol, c2.nearest, c2.distance], ['?', atLeast[0], least]);
});

test('readBand: a contrast of 48 is enough, 47 is not', () => {
  const at = (paper, ink) => { const code = '0000-0000-0000-0000'; const r = raster(440, 616); paintBand((x, y, w, h, rgb) => r.rect(x, y, w, h, rgb === BAND_INK ? [ink, ink, ink] : [paper, paper, paper]), code, 440, 616); return readBand(r.luma, 440, 616); };
  assert.equal(at(148, 100).read, '0000-0000-0000-0000');
  assert.equal(at(147, 100).unknown, 16);
});

test('fuzz: the visible-seal kernel never throws on garbage', () => {
  const junk = [undefined, null, 0, -1, NaN, Infinity, '', 'x', '????', 'ZZZZ-ZZZZ', [], {}, [null], () => 5, () => NaN, { maxEdits: 'x' }];
  for (const a of junk) for (const b of junk) assert.doesNotThrow(() => {
    glyphDistance(a, b); sealCode(a); normalizeCode(a); readDistance(a, b); resolveCode(a, b); resolveCode(a, [SEAL_A], b);
    bandLayout(a, b); paintBand(a, b, 440, 616); readBand(a, b, 616); readBand(a, 440, 616);
  });
});

test('tallySurvival + judgeSurvival: outcomes re-derived from the raw reads, then the four sealed rules', () => {
  const S = [SEAL_A, SEAL_B, 'e1' + 'd'.repeat(62)];
  const code = (i) => sealCode(S[i]);
  const T = [{ id: 'png', realistic: true }, { id: 'jpeg', realistic: true }, { id: 'png35', realistic: false }, { id: 'edge' }];
  const reads = {
    png: [{ read: code(0) }, { read: code(1).toLowerCase() }, { read: code(2) }],
    jpeg: [{ read: code(0).replace(/.$/, '?') }, { read: code(1) }, { read: code(2) }],
    png35: [{ read: '????-????-????-????' }, { read: code(1) }, { read: code(2) }],
    edge: [{ read: code(1) }, null, { read: 5 }],
  };
  const t = tallySurvival(S, reads, T);
  assert.equal(t.ok, true);
  assert.deepEqual(t.rows.map((r) => [r.id, r.realistic, r.n, r.exact, r.right, r.wrong, r.refused, r.unknown, r.meanUnknown]), [
    ['png', true, 3, 3, 3, 0, 0, 0, 0],
    ['jpeg', true, 3, 2, 3, 0, 0, 1, 0.33],
    ['png35', false, 3, 2, 2, 0, 1, 16, 5.33],
    ['edge', false, 3, 0, 0, 1, 2, 0, 0],
  ]);
  const j = judgeSurvival(t);
  assert.deepEqual(j.rules.map((r) => [r.id, r.pass, r.value]), [
    ['stripped-exact', true, '3/3 exact'], ['platform-ladder', true, '6/6 right'], ['never-wrong', false, '1 wrong'], ['third-size', false, '2/3 right'],
  ]);
  assert.deepEqual([j.passed, j.of], [2, 4]);
  // each bar at its edge
  const at = (id, rows) => judgeSurvival({ ok: true, rows }).rules.find((r) => r.id === id).pass;
  const row = (id, o) => ({ id, realistic: false, n: 10, exact: 10, right: 10, wrong: 0, refused: 0, ...o });
  assert.equal(at('stripped-exact', [row('png', { exact: 9 })]), false);
  assert.equal(at('stripped-exact', [row('png35')]), false);
  assert.equal(at('platform-ladder', [row('a', { realistic: true }), row('b', { realistic: true, right: 9 })]), false);
  assert.equal(at('platform-ladder', [row('a', { realistic: true }), row('b', { realistic: false, right: 0 })]), true);
  assert.equal(at('platform-ladder', [row('a')]), false);
  assert.equal(at('third-size', [row('png35', { right: 9 })]), true);
  assert.equal(at('third-size', [row('png35', { right: 8 })]), false);
  assert.equal(at('third-size', [row('png')]), false);
  assert.deepEqual(judgeSurvival({ ok: true, rows: [row('x')] }).rules.map((r) => r.value), ['not run', '0/0 right', '0 wrong', 'not run']);
  for (const [s, r, tt] of [[[], reads, T], [S, null, T], [S, reads, []], [S, reads, 'x'], [S, { png: [] }, [{ id: 'png' }]], [S, reads, [null]], ['x', reads, T]]) assert.match(tallySurvival(s, r, tt).why, /seals|every transform/);
  for (const bad of [null, {}, { ok: false }, { ok: true, rows: 'x' }, { ok: true, rows: [null] }, { ok: true, rows: [5] }]) assert.match(judgeSurvival(bad).why, /tally/);
});

test('fuzz: the survival tally never throws', () => {
  const junk = [undefined, null, 0, '', 'x', [], {}, [null], [{}], { png: 5 }, [{ id: 'png' }]];
  for (const a of junk) for (const b of junk) for (const c of junk) assert.doesNotThrow(() => { tallySurvival(a, b, c); judgeSurvival(a); judgeSurvival({ ok: true, rows: a }); });
});

test('the committed survival run, re-derived from its raw reads by the kernel', async () => {
  const { readFileSync } = await import('node:fs');
  const pre = JSON.parse(readFileSync(new URL('./data/survive-prereg.json', import.meta.url), 'utf8'));
  const run = JSON.parse(readFileSync(new URL('./data/survive.json', import.meta.url), 'utf8'));
  const seals = run.cards.map((c) => c.seal);
  assert.equal(seals.length, 64);
  assert.ok(run.cards.every((c) => c.code === sealCode(c.seal)), 'every printed code is the kernel\'s');
  const t = tallySurvival(seals, run.reads, pre.transforms);
  assert.deepEqual(t.rows.map((r) => [r.id, r.exact, r.right, r.refused, r.wrong]), [
    ['png', 64, 64, 0, 0], ['jpeg90', 64, 64, 0, 0], ['jpeg50', 64, 64, 0, 0], ['jpeg20', 64, 64, 0, 0], ['webp60', 64, 64, 0, 0],
    ['png75', 64, 64, 0, 0], ['png50', 64, 64, 0, 0], ['jpeg75at50', 64, 64, 0, 0], ['jpeg60at60', 64, 64, 0, 0],
    ['png35', 0, 0, 64, 0], ['png25', 0, 0, 64, 0], ['jpeg5', 64, 64, 0, 0],
  ]);
  const j = judgeSurvival(t);
  assert.deepEqual(j.rules.map((r) => [r.id, r.pass]), [['stripped-exact', true], ['platform-ladder', true], ['never-wrong', true], ['third-size', false]]);
});

test('read rules: tallySurvival grades under 0.1 unless told otherwise', () => {
  const S = [SEAL_A, SEAL_B];
  const uRead = sealCode(SEAL_B).replace(/V/g, 'U');
  const reads = { t: [{ read: sealCode(SEAL_A) }, { read: uRead }] };
  const T = [{ id: 't', realistic: true }];
  const r01 = tallySurvival(S, reads, T).rows[0], r02 = tallySurvival(S, reads, T, '0.2').rows[0];
  assert.deepEqual([r01.exact, r01.right, r01.refused], [1, 1, 1]);
  assert.deepEqual([r02.exact, r02.right, r02.refused], [2, 2, 0]);
  assert.equal(tallySurvival(S, reads, T, '0.1').rows[0].refused, 1);
  assert.equal(tallySurvival(S, reads, T, 'x').rows[0].refused, 2);
});

test('compareRules: every read under two rules — fixed, broken, exact kept or lost', () => {
  const deck = [SEAL_A, SEAL_B, 'e1' + 'd'.repeat(62)];
  const u = sealCode(SEAL_B).replace(/V/g, 'U');
  const reads = [{ read: u, card: 1 }, { read: sealCode(SEAL_A), card: 0 }, { read: sealCode(SEAL_A), card: 2 }, { read: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', card: 0 }];
  const f = compareRules(reads, deck, '0.1', '0.2');
  assert.deepEqual([f.n, f.before, f.after, f.fixed, f.broken, f.lostExact], [4, { right: 1, wrong: 1, refused: 2, exact: 1 }, { right: 2, wrong: 1, refused: 1, exact: 2 }, [0], [], []]);
  const b = compareRules(reads, deck, '0.2', '0.1');                              // the other way round breaks it
  assert.deepEqual([b.fixed, b.broken, b.lostExact], [[], [0], [0]]);
  assert.deepEqual(compareRules([], deck, '0.1', '0.2').before, { right: 0, wrong: 0, refused: 0, exact: 0 });
  for (const bad of [[null, deck, '0.1', '0.2'], [reads, [], '0.1', '0.2'], [reads, null, '0.1', '0.2'], [reads, deck, '0.3', '0.2'], [reads, deck, '0.1', null], [[{ read: 'A', card: 9 }], deck, '0.1', '0.2'], [[{ read: 'A', card: 'x' }], deck, '0.1', '0.2'], [[null], deck, '0.1', '0.2']]) assert.match(compareRules(...bad).why, /two read rules/);
});

test('judgeUV: the five sealed rules for shipping U→V, each at its edge', () => {
  const cmp = (before, after, broken = [], lostExact = [], n = 7) => ({ ok: true, n, before: { right: 0, wrong: 0, refused: 0, exact: 0, ...before }, after: { right: 0, wrong: 0, refused: 0, exact: 0, ...after }, fixed: [], broken, lostExact });
  const good = { recorded: cmp({ right: 185 }, { right: 192 }, [], [], 192), uReads: cmp({ right: 0 }, { right: 7 }), pixels: cmp({ right: 600 }, { right: 600 }, [], [], 768), everyV: cmp({ right: 0 }, { right: 40 }, [], [], 40), survivalBefore: { rows: [1] }, survivalAfter: { rows: [1] } };
  const j = judgeUV(good);
  assert.deepEqual(j.rules.map((r) => [r.id, r.pass]), [['fixes-the-seven', true], ['breaks-nothing', true], ['never-wrong', true], ['pixels-unchanged', true], ['every-v-as-u', true]]);
  assert.deepEqual([j.passed, j.of, j.rules[0].value, j.rules[1].value, j.rules[2].value], [5, 5, '7 of 7 now resolve to the right card (0 before)', '0 broken, 0 exact reads lost, across 960 reads', '0 wrong cards across 960 reads']);
  const at = (patch, id) => judgeUV({ ...good, ...patch }).rules.find((r) => r.id === id).pass;
  assert.equal(at({ uReads: cmp({ right: 0 }, { right: 6 }) }, 'fixes-the-seven'), false);
  assert.equal(at({ uReads: cmp({ right: 1 }, { right: 7 }) }, 'fixes-the-seven'), false);
  assert.equal(at({ uReads: cmp({}, {}, [], [], 0) }, 'fixes-the-seven'), false);
  assert.equal(at({ recorded: cmp({ right: 185 }, { right: 192 }, [3], [], 192) }, 'breaks-nothing'), false);
  assert.equal(at({ pixels: cmp({ right: 600 }, { right: 600 }, [], [4], 768) }, 'breaks-nothing'), false);
  assert.equal(at({ recorded: cmp({ right: 185 }, { right: 191, wrong: 1 }, [], [], 192) }, 'never-wrong'), false);
  assert.equal(at({ pixels: cmp({ right: 600 }, { right: 599, wrong: 1 }, [], [], 768) }, 'never-wrong'), false);
  assert.equal(at({ survivalAfter: { rows: [2] } }, 'pixels-unchanged'), false);
  assert.equal(judgeUV({ ...good, survivalAfter: { rows: [2] } }).rules[3].value, 'the tally changed');
  assert.equal(at({ everyV: cmp({ right: 0 }, { right: 39 }, [], [], 40) }, 'every-v-as-u'), false);
  assert.equal(at({ everyV: cmp({ right: 2 }, { right: 40 }, [], [], 40) }, 'every-v-as-u'), false);
  assert.equal(at({ everyV: cmp({}, {}, [], [], 0) }, 'every-v-as-u'), false);
  for (const bad of [null, {}, { ...good, recorded: null }, { ...good, uReads: { ok: false } }, { ...good, pixels: { ...good.pixels, broken: 'x' } }, { ...good, everyV: { ...good.everyV, after: null } }, { ...good, survivalBefore: null }, { ...good, survivalAfter: 5 }]) assert.match(judgeUV(bad).why, /compareRules/);
});
