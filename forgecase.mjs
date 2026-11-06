// forgecase.mjs — the cost case on the Forge's page ("For a business"): what it costs a team today to confirm that a
// file is the approved, unchanged version (open it, compare it, ask the sender, chase the reply), and what that costs
// once files travel as sealed, signed cards anyone checks in seconds. Every external figure is read from the vendored,
// sourced basis (vendor/sovereign-enterprise/data/basis.json, byte for byte from sjgant80-hub/sovereign-enterprise);
// the file counts, the minutes, the share and any current tool's bill are the reader's own.
//
// Floors, never top ends: staff time at the UK median hourly wage with on-costs left out; CPI applied to every later
// year. No price of ours appears here: the Forge is MIT and runs in the browser, and support, where a team wants it,
// is agreed per deployment and is not in this case. A tool the team pays for today enters only as the reader's own
// monthly figure, never as a price we typed.
//
// Pure, total, deterministic: garbage in gives { ok: false, why }, never a throw.

export const DEFAULTS = Object.freeze({ filesPerWeek: 40, minutesPerCheck: 6, share: 0.75, secondsPerRead: 5, toolPerMonth: 0, years: 3 });
export const BASIS_KEYS = Object.freeze(['wageMedianHourly', 'cpi', 'electricityPencePerKwh', 'laptopExtraWatts']);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const r2 = (x) => Math.round(x * 100) / 100;

/** the four basis figures the case reads, each a sourced number; null when one is missing or unreadable */
export function figures(basis) {
  const b = basis || {}, f = (k) => b[k] || {};
  const out = { wage: f('wageMedianHourly').value, cpi: f('cpi').value, pence: f('electricityPencePerKwh').value, watts: f('laptopExtraWatts').value };
  return Object.values(out).every(isNum) ? out : null;
}

/** where each figure came from, for the page to list beside the numbers */
export function sourcesOf(basis) {
  try { return BASIS_KEYS.map((k) => ({ key: k, value: basis[k].value, what: basis[k].what, source: basis[k].source })); } catch { return []; }
}

/** a yearly cost carried over `years`, rising by CPI each year after the first */
export function over(perYear, cpi, years) {
  let total = 0, factor = 1;
  for (let y = 0; y < years; y++) { total += perYear * factor; factor *= 1 + cpi; }
  return r2(total);
}

/** the reader's inputs, checked; a string naming the first one that is out of range, or null when all are fine */
function badInput(i) {
  if (!isNum(i.filesPerWeek)) return 'files a week: a number, 0 or more';
  if (!isNum(i.minutesPerCheck) || i.minutesPerCheck > 480) return 'minutes to confirm one file: 0 to 480';
  if (!isNum(i.share) || i.share > 1) return 'the share of that checking the seal replaces: 0 to 1';
  if (!isNum(i.secondsPerRead) || i.secondsPerRead > 3600) return 'seconds the laptop spends reading a card: 0 to 3600';
  if (!isNum(i.toolPerMonth)) return 'what a tool you use for this costs a month: a number, 0 or more';
  if (!Number.isInteger(i.years) || i.years < 1 || i.years > 10) return 'years: a whole number, 1 to 10';
  return null;
}

/** the case. input (all optional, defaults above): filesPerWeek, minutesPerCheck, share (0 to 1), secondsPerRead, toolPerMonth, years */
export function forgeCase(basis, input) {
  try {
    const f = figures(basis);
    if (!f) return { ok: false, why: 'a sourced basis with every figure the case reads' };
    const i = { ...DEFAULTS, ...(input || {}) };
    const why = badInput(i);
    if (why) return { ok: false, why };
    const hoursToday = r2(i.filesPerWeek * 52 * i.minutesPerCheck / 60);       // staff hours a year spent confirming files
    const staff = r2(hoursToday * f.wage);                                      // that time, at the median wage
    const hoursBack = r2(hoursToday * i.share);                                 // the hours a seal check gives back
    const takenOff = r2(staff * i.share);
    const tool = r2(i.toolPerMonth * 12);                                       // the reader's own current tool, a year
    const readHours = i.filesPerWeek * 52 * i.secondsPerRead / 3600;            // laptop time spent reading cards
    const power = r2(readHours * f.watts / 1000 * f.pence / 100);               // the extra draw of that time, a year
    const perYear = { today: r2(staff + tool), withForge: r2(staff - takenOff + power) };
    const total = { today: over(perYear.today, f.cpi, i.years), withForge: over(perYear.withForge, f.cpi, i.years) };
    return {
      ok: true, inputs: i, figures: f, lines: { hoursToday, staff, hoursBack, takenOff, tool, power }, perYear, over: total,
      savingPerYear: r2(perYear.today - perYear.withForge), savingOver: r2(total.today - total.withForge),
    };
  } catch { return { ok: false, why: 'the inputs could not be read' }; }
}

export default { DEFAULTS, BASIS_KEYS, figures, sourcesOf, over, forgeCase };
