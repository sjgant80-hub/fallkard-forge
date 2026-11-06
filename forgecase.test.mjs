// forgecase.test.mjs — the cost case on the Forge's page, held to the sourced basis it reads and to arithmetic done
// here independently. Every external figure comes from vendor/sovereign-enterprise/data/basis.json, pinned below by
// its hash, so a typed-in or hand-edited figure fails this suite before it can reach the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULTS, BASIS_KEYS, figures, sourcesOf, over, forgeCase } from './forgecase.mjs';

const RAW = readFileSync(new URL('./vendor/sovereign-enterprise/data/basis.json', import.meta.url));
const BASIS = JSON.parse(RAW.toString('utf8'));
const r2 = (x) => Math.round(x * 100) / 100;

test('the basis is the vendored file, byte for byte, and every figure the case reads is sourced', () => {
  assert.equal(createHash('sha256').update(RAW).digest('hex'), '83e9c2effa2f81596dcfa7110f030940032c1910cdf928d27d628ae59d73bb42',
    'vendor/sovereign-enterprise/data/basis.json is the sovereign-enterprise file — never edited here');
  assert.deepEqual([...BASIS_KEYS], ['wageMedianHourly', 'cpi', 'electricityPencePerKwh', 'laptopExtraWatts']);
  const s = sourcesOf(BASIS);
  assert.equal(s.length, 4);
  for (const x of s) {
    assert.match(x.source, /^https:\/\//, x.key + ' names its source');
    assert.equal(typeof x.what, 'string');
    assert.equal(x.value, BASIS[x.key].value);
  }
  assert.deepEqual(sourcesOf(null), [], 'no basis, no sources — never a throw');
  assert.deepEqual(figures(BASIS), { wage: BASIS.wageMedianHourly.value, cpi: BASIS.cpi.value, pence: BASIS.electricityPencePerKwh.value, watts: BASIS.laptopExtraWatts.value });
});

test('the case at its example inputs, against arithmetic done here', () => {
  const r = forgeCase(BASIS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.inputs, { ...DEFAULTS });
  const w = BASIS.wageMedianHourly.value, cpi = BASIS.cpi.value, p = BASIS.electricityPencePerKwh.value, kw = BASIS.laptopExtraWatts.value / 1000;
  const hours = 40 * 52 * 6 / 60;
  assert.equal(r.lines.hoursToday, hours);
  assert.equal(r.lines.staff, r2(hours * w));
  assert.equal(r.lines.hoursBack, r2(hours * 0.75));
  assert.equal(r.lines.takenOff, r2(r2(hours * w) * 0.75));
  assert.equal(r.lines.tool, 0);
  assert.equal(r.lines.power, r2(40 * 52 * 5 / 3600 * kw * p / 100));
  assert.equal(r.perYear.today, r2(hours * w));
  assert.equal(r.perYear.withForge, r2(r.lines.staff - r.lines.takenOff + r.lines.power));
  const three = (v) => r2(v + v * (1 + cpi) + v * (1 + cpi) * (1 + cpi));
  assert.equal(r.over.today, three(r.perYear.today));
  assert.equal(r.over.withForge, three(r.perYear.withForge));
  assert.equal(r.savingPerYear, r2(r.perYear.today - r.perYear.withForge));
  assert.equal(r.savingOver, r2(r.over.today - r.over.withForge));
  // the golden numbers, so a change to the basis or the arithmetic is seen, not absorbed
  assert.deepEqual([r.lines.staff, r.perYear.withForge, r.over.today, r.savingOver], [4091.36, 1022.85, 12658.51, 9493.85]);
});

test('the reader\'s own inputs are used, and a tool they pay for today counts only in the "today" column', () => {
  const r = forgeCase(BASIS, { filesPerWeek: 10, minutesPerCheck: 3, share: 0.5, secondsPerRead: 60, toolPerMonth: 100, years: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.inputs.filesPerWeek, 10);
  const hours = 10 * 52 * 3 / 60, staff = r2(hours * BASIS.wageMedianHourly.value);
  assert.equal(r.lines.hoursToday, hours);
  assert.equal(r.lines.tool, 1200);
  assert.equal(r.perYear.today, r2(staff + 1200));
  assert.equal(r.perYear.withForge, r2(staff - r2(staff * 0.5) + r.lines.power));
  assert.equal(r.lines.power, r2(10 * 52 * 60 / 3600 * 15 / 1000 * 24.51 / 100));
  assert.equal(r.over.today, r.perYear.today, 'one year is the year itself');
  // a partial input keeps the defaults for the rest
  const half = forgeCase(BASIS, { filesPerWeek: 80 });
  assert.equal(half.inputs.minutesPerCheck, DEFAULTS.minutesPerCheck);
  assert.equal(half.lines.hoursToday, 80 * 52 * 6 / 60);
});

test('every edge is inside, and one step past it is refused with the reason', () => {
  const ok = (input) => forgeCase(BASIS, input).ok;
  const why = (input) => forgeCase(BASIS, input).why;
  for (const edge of [{ filesPerWeek: 0 }, { minutesPerCheck: 0 }, { minutesPerCheck: 480 }, { share: 0 }, { share: 1 },
    { secondsPerRead: 0 }, { secondsPerRead: 3600 }, { toolPerMonth: 0 }, { years: 1 }, { years: 10 }]) assert.equal(ok(edge), true, JSON.stringify(edge));
  assert.match(why({ minutesPerCheck: 480.5 }), /^minutes/);
  assert.match(why({ share: 1.01 }), /^the share/);
  assert.match(why({ secondsPerRead: 3601 }), /^seconds/);
  assert.match(why({ years: 11 }), /^years/);
  assert.match(why({ years: 0 }), /^years/);
  assert.match(why({ years: 2.5 }), /^years/);
  for (const bad of [-1, NaN, Infinity, '5', null, true]) {
    assert.match(why({ filesPerWeek: bad }), /^files/, 'files ' + String(bad));
    assert.match(why({ minutesPerCheck: bad }), /^minutes/, 'minutes ' + String(bad));
    assert.match(why({ share: bad }), /^the share/, 'share ' + String(bad));
    assert.match(why({ secondsPerRead: bad }), /^seconds/, 'seconds ' + String(bad));
    assert.match(why({ toolPerMonth: bad }), /^what a tool/, 'tool ' + String(bad));
    assert.match(why({ years: bad }), /^years/, 'years ' + String(bad));
  }
});

test('no basis, a broken basis or a basis missing one figure gives a reason, never a number and never a throw', () => {
  const need = 'a sourced basis with every figure the case reads';
  assert.deepEqual(forgeCase(null), { ok: false, why: need });
  assert.deepEqual(forgeCase(undefined), { ok: false, why: need });
  assert.deepEqual(forgeCase({}), { ok: false, why: need });
  assert.equal(figures(null), null);
  assert.equal(figures({}), null);
  for (const k of BASIS_KEYS) {
    const { [k]: _, ...rest } = BASIS;
    assert.deepEqual(forgeCase(rest), { ok: false, why: need }, 'without ' + k);
    assert.deepEqual(forgeCase({ ...BASIS, [k]: { value: '19.67' } }), { ok: false, why: need }, k + ' as text');
  }
  assert.deepEqual(forgeCase(BASIS, { get filesPerWeek() { throw new Error('x'); } }), { ok: false, why: 'the inputs could not be read' });
  for (const junk of [5, 'x', [], () => {}]) assert.equal(forgeCase(BASIS, junk).ok, true, 'junk input is no input: ' + typeof junk);
});

test('over() carries a yearly figure across the years, rising by CPI after the first', () => {
  assert.equal(over(100, 0.1, 1), 100);
  assert.equal(over(100, 0.1, 2), 210);
  assert.equal(over(100, 0.1, 3), 331);
  assert.equal(over(100, 0, 4), 400);
  assert.equal(over(0, 0.5, 5), 0);
});
