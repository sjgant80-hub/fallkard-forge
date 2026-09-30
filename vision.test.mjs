// vision.test.mjs — the paid read's grader: extracting a code from a reply, tallying, the sealed rules, the spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, tallyVision, judgeVision, spend } from './vision.mjs';
import { sealCode } from './sealmark.mjs';

const SEAL_A = '3f9a0c21d4e87b65a10f2c3d4e5f60718293a4b5c6d7e8f90112233445566778';   // 7YD0-R8EM-X1XP-B88F
const SEAL_B = 'c07e11aa92b3445d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5';
const SEAL_C = 'e1' + 'd'.repeat(62);

test('extractCode: the last four-by-four run in a reply, else the reply trimmed', () => {
  assert.equal(extractCode('7YD0-R8EM-X1XP-B88F'), '7YD0-R8EM-X1XP-B88F');
  assert.equal(extractCode('The code is: 7yd0 r8em x1xp b88f.'), '7yd0 r8em x1xp b88f');
  assert.equal(extractCode('7YD0–R8EM—X1XP_B88F'), '7YD0–R8EM—X1XP_B88F');
  assert.equal(extractCode('7YD0·R8EM·X1XP·B88F'), '7YD0·R8EM·X1XP·B88F');
  assert.equal(extractCode('first AAAA-BBBB-CCCC-DDDD then 7YD0-R8EM-X1XP-B88F'), '7YD0-R8EM-X1XP-B88F');
  assert.equal(extractCode('7Y?0-R8EM-X1XP-B88F'), '7Y?0-R8EM-X1XP-B88F');
  assert.equal(extractCode('code 7YD0 R8EM X1XP B88F'), '7YD0 R8EM X1XP B88F');          // a four-letter word before it is not part of it
  assert.equal(extractCode('7YD0-R8EM-X1XP-B88F then done'), '7YD0-R8EM-X1XP-B88F');        // hyphenated wins, words after it too
  assert.equal(extractCode('then 7YD0 - R8EM - X1XP - B88F'), '7YD0 - R8EM - X1XP - B88F');
  assert.equal(extractCode('AAAA BBBB CCCC DDDD, or 7YD0-R8EM-X1XP-B88F'), '7YD0-R8EM-X1XP-B88F');
  // with only spaces AND words after the code, the fallback takes the run that ends last — the sealed limitation
  assert.equal(extractCode('7YD0 R8EM X1XP B88F then done'), 'X1XP B88F then done');
  assert.equal(extractCode('  7YD0R8EM  '), '7YD0R8EM');
  assert.equal(extractCode('AAAA-BBBB-CCCC'), 'AAAA-BBBB-CCCC');
  assert.equal(extractCode(''), '');
  for (const bad of [null, undefined, 5, {}]) assert.equal(extractCode(bad), null);
});

test('tallyVision: exact as the spec reads, exact as printed, and which card each reply finds', () => {
  const S = [SEAL_A, SEAL_B, SEAL_C];
  const code = (i) => sealCode(S[i]);
  const C = [{ id: 'full' }, { id: 'png35' }];
  const replies = {
    full: [code(0), 'Code: ' + code(1).toLowerCase(), code(2).replace(/0/g, 'O')],
    png35: ['7YD0-R8EM-X1XP-BB8F', 'nothing legible', null],
  };
  const t = tallyVision(S, replies, C);
  assert.equal(t.ok, true);
  assert.deepEqual(t.rows.map((r) => [r.id, r.n, r.answered, r.exact, r.printed, r.right, r.wrong, r.refused]), [
    ['full', 3, 3, 3, code(2).includes('0') ? 1 : 2, 3, 0, 0],
    ['png35', 3, 2, 0, 0, 1, 0, 2],
  ]);
  // a reply nearer another card resolves to it, and counts as wrong
  const w = tallyVision(S, { x: [code(1), code(1), code(2)] }, [{ id: 'x' }]);
  assert.deepEqual([w.rows[0].right, w.rows[0].wrong], [2, 1]);
  for (const [s, r, c] of [[[], replies, C], [['nope'], replies, C], [[SEAL_A, 'x'], replies, C], [S, null, C], [S, [], C], [S, replies, []], [null, replies, C], ['x', replies, C]]) assert.match(tallyVision(s, r, c).why, /^seals, replies and conditions$/);
  for (const [s, r, c] of [[S, { full: [1] }, [{ id: 'full' }]], [S, replies, [null]], [S, replies, [{ id: 'missing' }]]]) assert.match(tallyVision(s, r, c).why, /^every condition needs one reply per card$/);
});

test('judgeVision: the five sealed rules, each bar at its edge', () => {
  const row = (id, o) => ({ id, n: 64, answered: 64, exact: 64, printed: 64, right: 64, wrong: 0, refused: 0, ...o });
  const at = (rid, rows) => judgeVision({ ok: true, rows }).rules.find((r) => r.id === rid);
  assert.equal(at('full-exact', [row('full', { exact: 60 })]).pass, true);
  assert.equal(at('full-exact', [row('full', { exact: 59 })]).pass, false);
  assert.equal(at('full-exact', [row('full', { exact: 59 })]).value, '59/64 exact');
  assert.equal(at('full-right', [row('full', { right: 63 })]).pass, false);
  assert.equal(at('full-right', [row('full')]).pass, true);
  assert.equal(at('platform-right', [row('jpeg60at60', { right: 63 })]).pass, false);
  assert.equal(at('platform-right', [row('jpeg60at60')]).pass, true);
  assert.equal(at('never-wrong', [row('a'), row('b', { wrong: 1 })]).pass, false);
  assert.equal(at('never-wrong', [row('a'), row('b', { wrong: 1 })]).value, '1 wrong');
  assert.equal(at('third-size', [row('png35', { right: 32 })]).pass, true);
  assert.equal(at('third-size', [row('png35', { right: 31 })]).pass, false);
  const none = judgeVision({ ok: true, rows: [row('other')] });
  assert.deepEqual(none.rules.map((r) => [r.id, r.pass, r.value]), [['full-exact', false, 'not run'], ['full-right', false, 'not run'], ['platform-right', false, 'not run'], ['never-wrong', true, '0 wrong'], ['third-size', false, 'not run']]);
  const all = judgeVision({ ok: true, rows: [row('full'), row('jpeg60at60'), row('png35')] });
  assert.deepEqual([all.passed, all.of], [5, 5]);
  for (const bad of [null, {}, { ok: false }, { ok: true, rows: 'x' }, { ok: true, rows: [null] }, { ok: true, rows: [[1]] }]) assert.match(judgeVision(bad).why, /tally/);
});

test('spend: priced by kind at the list price', () => {
  const P = { inPerM: 2, outPerM: 10, currency: 'USD' }, C = { write5m: 1.25, write1h: 2, read: 0.1 };
  assert.deepEqual(spend([{ input_tokens: 1000, output_tokens: 500 }, { input_tokens: 0, output_tokens: 0 }], P, 0.75396), { ok: true, calls: 2, input: 1000, fresh: 1000, cacheWrite: 0, cacheRead: 0, output: 500, usd: 0.007, gbp: 0.0053 });
  assert.deepEqual(spend([{ input_tokens: 2, cache_write_1h: 3265, output_tokens: 123 }], P, 0.75396, C), { ok: true, calls: 1, input: 3267, fresh: 2, cacheWrite: 3265, cacheRead: 0, output: 123, usd: 0.0143, gbp: 0.0108 });
  assert.equal(spend([{ input_tokens: 0, cache_write_5m: 100000, output_tokens: 0 }], P, 1, C).usd, 0.25);
  assert.equal(spend([{ input_tokens: 0, cache_read: 100000, output_tokens: 0 }], P, 1, C).usd, 0.02);
  assert.deepEqual(spend([], P, 0.75), { ok: true, calls: 0, input: 0, fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, gbp: 0 });
  assert.equal(spend([{ input_tokens: 5, cache_read: 0, output_tokens: 0 }], P, 1).ok, true);
  for (const cc of [undefined, null, { ...C, read: 'x' }, { ...C, read: NaN }, { write5m: 1, write1h: 2 }]) assert.match(spend([{ input_tokens: 0, cache_read: 1, output_tokens: 0 }], P, 1, cc).why, /cache multiples/);
  for (const u of [null, 'x', [null], [{ input_tokens: 1.5, output_tokens: 0 }], [{ input_tokens: 1 }], [{ input_tokens: 1, output_tokens: 0, cache_read: -1 }], [{ input_tokens: 1, output_tokens: 0, cache_write_1h: 0.5 }]]) assert.match(spend(u, P, 0.75).why, /usage/);
  for (const [p, fx] of [[null, 0.75], [{ ...P, inPerM: NaN }, 0.75], [{ ...P, outPerM: Infinity }, 0.75], [P, NaN], [{ ...P, inPerM: 'x' }, 0.75], [{ ...P, outPerM: null }, 0.75], [{ ...P, currency: 'GBP' }, 0.75], [P, 0], [P, 'x']]) assert.match(spend([], p, fx).why, /list price/);
});

test('fuzz: the paid-read grader never throws', () => {
  const junk = [undefined, null, 0, '', 'x', [], {}, [null], [{}], { full: 5 }, [{ id: 'full' }], () => 1];
  for (const a of junk) for (const b of junk) for (const c of junk) assert.doesNotThrow(() => { extractCode(a); tallyVision(a, b, c); tallyVision([SEAL_A], b, c); judgeVision(a); judgeVision({ ok: true, rows: a }); spend(a, b, 0.75, c); });
});

test('the committed paid read, re-graded from its raw replies by the kernel', async () => {
  const { readFileSync } = await import('node:fs');
  const J = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
  const pre = J('./data/vision-prereg.json'), run = J('./data/vision.json'), cards = J('./data/vision/cards.json').cards.filter((c) => !c.plumbing);
  const seals = cards.map((c) => c.seal), pos = Object.fromEntries(cards.map((c, i) => [c.i, i]));
  const replies = Object.fromEntries(pre.conditions.map((c) => [c.id, seals.map(() => null)]));
  for (const r of run.rows) replies[r.condition][pos[r.card]] = r.reply;
  assert.equal(run.rows.length, 192);
  const t = tallyVision(seals, replies, pre.conditions);
  assert.deepEqual(t.rows.map((r) => [r.id, r.answered, r.exact, r.right, r.refused, r.wrong]), [
    ['full', 64, 64, 64, 0, 0], ['jpeg60at60', 64, 60, 64, 0, 0], ['png35', 64, 43, 57, 7, 0],
  ]);
  assert.deepEqual(judgeVision(t).rules.map((r) => [r.id, r.pass]), [['full-exact', true], ['full-right', true], ['platform-right', true], ['never-wrong', true], ['third-size', true]]);
  const plumb = J('./data/vision-plumbing.json').rows.map((r) => r.usage);
  const lock = J('./prices.lock.json').entries;
  const s = spend([...run.rows.map((r) => r.usage), ...plumb], lock.find((e) => e.id === 'claude-sonnet-5'), lock.find((e) => e.id === 'fx-gbp-usd').gbpPerUsd, pre.cacheMultiples);
  assert.deepEqual([s.calls, s.input, s.output, s.usd, s.gbp], [193, 83741, 3954, 0.207, 0.1561]);
});

test('tallyVision grades under read rule 0.1 unless told otherwise', () => {
  const S = [SEAL_A, SEAL_B];
  const u = sealCode(SEAL_B).replace(/V/g, 'U');
  const replies = { full: [sealCode(SEAL_A), 'The code is ' + u] };
  const a = tallyVision(S, replies, [{ id: 'full' }]).rows[0], b = tallyVision(S, replies, [{ id: 'full' }], '0.2').rows[0];
  assert.deepEqual([a.exact, a.right, a.refused], [1, 1, 1]);
  assert.deepEqual([b.exact, b.right, b.refused], [2, 2, 0]);
  assert.deepEqual(tallyVision(S, replies, [{ id: 'full' }], '0.1').rows[0].refused, 1);
});
