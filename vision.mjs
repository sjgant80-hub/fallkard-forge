// ════════════════════════════════════════════════════════════════════════════════════════════════
// vision.mjs · THE PAID READ — can a vision model read a card's printed seal (CARD-SPEC §7.1)?
//
// The survival run (data/survive.json) measured the page's own pixel reader. This grades the other reader the
// band was designed for: a vision model shown only the card picture, never the code. Every reply is graded here,
// deterministically, against the committed codes — no model judges a model — and the calls are priced from the
// provider's own token counts. Sealed in data/vision-prereg.json before the first paid call.
//
// Pure: no I/O, no clock. Imports only the gated sealmark kernel.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { sealCode, normalizeCode, resolveCode } from './sealmark.mjs';

const isStr = (v) => typeof v === 'string';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// extractCode(reply) — the code a reply gives. First choice: a run of four groups of four (letters, digits or ?)
// joined by hyphens or dashes, as the code is printed — the last such run in the reply, so a four-letter word beside
// it cannot join it. Failing that, the same with any separator (spaces, dots, underscores), the run that ends last.
// A reply with neither is taken whole, trimmed.
const DASHED = /(?=([0-9A-Za-z?]{4}(?:\s*[-–—]\s*[0-9A-Za-z?]{4}){3}))/g;
const RUN = /(?=([0-9A-Za-z?]{4}(?:[\s\-–—_.·]+[0-9A-Za-z?]{4}){3}))/g;
const lastRun = (reply, re) => [...reply.matchAll(re)].map((m) => ({ text: m[1], end: m.index + m[1].length })).sort((x, y) => y.end - x.end)[0];
export function extractCode(reply) {
  if (!isStr(reply)) return null;
  const run = lastRun(reply, DASHED) || lastRun(reply, RUN);
  return run ? run.text : reply.trim();
}

// tallyVision(seals, replies, conditions, rule) — graded under read rule 0.1 unless told otherwise, the rule the paid
// read was sealed with. Per condition: how many replies read the code exactly (as the spec reads
// it: case-blind, O→0, I/L→1), how many were exact to the letter as printed, and which card each resolves to.
// replies[c.id][i] is card i's reply under condition c (a string, or null for a call that did not answer).
export function tallyVision(seals, replies, conditions, rule = '0.1') {
  if (!Array.isArray(seals) || seals.length === 0 || seals.some((x) => sealCode(x) === null) || !isObj(replies) || !Array.isArray(conditions) || conditions.length === 0) return { ok: false, why: 'seals, replies and conditions' };
  const rows = [];
  for (const c of conditions) {
    const rs = isObj(c) ? replies[c.id] : null;
    if (!Array.isArray(rs) || rs.length !== seals.length) return { ok: false, why: 'every condition needs one reply per card' };
    const row = { id: c.id, n: rs.length, answered: 0, exact: 0, printed: 0, right: 0, wrong: 0, refused: 0 };
    rs.forEach((reply, i) => {
      const code = sealCode(seals[i]);
      const got = extractCode(reply);
      if (isStr(reply)) row.answered++;
      if (got === code) row.printed++;
      if (normalizeCode(got, rule) === code.replace(/-/g, '')) row.exact++;
      const k = resolveCode(got, seals, { rule });
      if (!k.ok) row.refused++;
      else if (k.seal === seals[i]) row.right++;
      else row.wrong++;
    });
    rows.push(row);
  }
  return { ok: true, rows };
}

// judgeVision(tally) — the five rules sealed in data/vision-prereg.json, each with the number that decided it.
export function judgeVision(tally) {
  if (!isObj(tally) || tally.ok !== true || !Array.isArray(tally.rows) || tally.rows.some((r) => !isObj(r))) return { ok: false, why: 'a tally from tallyVision' };
  const by = Object.fromEntries(tally.rows.map((r) => [r.id, r]));
  const full = by.full, plat = by.jpeg60at60, third = by.png35;
  const wrong = tally.rows.reduce((s, r) => s + r.wrong, 0);
  const rules = [
    { id: 'full-exact', pass: !!full && full.exact / full.n >= 60 / 64, value: full ? full.exact + '/' + full.n + ' exact' : 'not run' },
    { id: 'full-right', pass: !!full && full.right === full.n, value: full ? full.right + '/' + full.n + ' right' : 'not run' },
    { id: 'platform-right', pass: !!plat && plat.right === plat.n, value: plat ? plat.right + '/' + plat.n + ' right' : 'not run' },
    { id: 'never-wrong', pass: wrong === 0, value: wrong + ' wrong' },
    { id: 'third-size', pass: !!third && third.right / third.n >= 0.5, value: third ? third.right + '/' + third.n + ' right' : 'not run' },
  ];
  return { ok: true, rules, passed: rules.filter((r) => r.pass).length, of: rules.length };
}

// spend(usages, price, gbpPerUsd, cache) — what the calls cost at the model's list price, from the provider's own
// counts, priced by kind: fresh input and output at the list rates, cache writes and reads at their multiples of the
// input rate (cache is only needed when a cached kind is non-zero).
const USAGE_KINDS = ['input_tokens', 'cache_write_5m', 'cache_write_1h', 'cache_read', 'output_tokens'];
export function spend(usages, price, gbpPerUsd, cache) {
  if (!Array.isArray(usages) || usages.some((u) => !isObj(u) || !Number.isInteger(u.input_tokens) || !Number.isInteger(u.output_tokens) || USAGE_KINDS.some((k) => u[k] !== undefined && !(Number.isInteger(u[k]) && u[k] >= 0)))) return { ok: false, why: 'usage: integer input_tokens and output_tokens per call, and whole cached counts' };
  if (!isObj(price) || !isNum(price.inPerM) || !isNum(price.outPerM) || price.currency !== 'USD' || !isNum(gbpPerUsd) || !(gbpPerUsd > 0)) return { ok: false, why: 'a USD list price per million tokens and the pound rate' };
  const t = Object.fromEntries(USAGE_KINDS.map((k) => [k, usages.reduce((s, u) => s + (u[k] || 0), 0)]));
  const cached = t.cache_write_5m + t.cache_write_1h + t.cache_read;
  const c = isObj(cache) && [cache.write5m, cache.write1h, cache.read].every(isNum) ? cache : null;
  if (cached > 0 && !c) return { ok: false, why: 'cached tokens need the cache multiples' };
  const inputUnits = t.input_tokens + (c ? t.cache_write_5m * c.write5m + t.cache_write_1h * c.write1h + t.cache_read * c.read : 0);
  const usd = (inputUnits * price.inPerM + t.output_tokens * price.outPerM) / 1e6;
  return { ok: true, calls: usages.length, input: t.input_tokens + cached, fresh: t.input_tokens, cacheWrite: t.cache_write_5m + t.cache_write_1h, cacheRead: t.cache_read, output: t.output_tokens, usd: Math.round(usd * 1e4) / 1e4, gbp: Math.round(usd * gbpPerUsd * 1e4) / 1e4 };
}

export default { extractCode, tallyVision, judgeVision, spend };
