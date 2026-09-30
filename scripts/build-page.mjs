// build-page.mjs — the Forge, as a room you can walk into.
//
// ⚑ THE PAGE RUNS THE GATED KERNEL. card.mjs is inlined verbatim between the markers, so the code the
// mutation gate attacked is the code that mints the card you download. The two impure steps —
// compressing and hashing — are the browser's own CompressionStream and crypto.subtle, handed in.
// Shipping a copy of zlib to a page that already has one would be worse than useless.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OPEN = '/* __CARD_KERNEL__ */';
const CLOSE = '/* __END_CARD_KERNEL__ */';

// Only the export KEYWORD goes. The \r? matters — these files are CRLF and `.` stops at \r.
const kernel = readFileSync(new URL('../card.mjs', import.meta.url), 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default[\s\S]*?;\s*$/m, '')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '');

const FOLD_OPEN = '/* __FOLD_KERNEL__ */';
const FOLD_CLOSE = '/* __END_FOLD_KERNEL__ */';
const foldKernel = readFileSync(new URL('../fold.mjs', import.meta.url), 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default[\s\S]*?;\s*$/m, '')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '');

const STUDIO_OPEN = '/* __STUDIO_KERNEL__ */';
const STUDIO_CLOSE = '/* __END_STUDIO_KERNEL__ */';
// Each kernel scoped in its own IIFE exposing only what the page uses — their private helpers
// (obj/str/canon/KAPPA) collide if inlined flat, and the page needs none of them.
const STUDIO_EXPORTS = {
  'artifact.mjs': ['ARTIFACT_KEYWORD', 'makeBundle', 'signBundle', 'verifyArtifact'],
  'babykcc.mjs': ['makeLedger', 'mint', 'verifyLedger', 'bridgeFace', 'bridgeOk'],
  'studio.mjs': ['ORGANS', 'compose', 'validateComposition'],
};
const studioKernel = Object.entries(STUDIO_EXPORTS).map(([f, names]) => {
  const body = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    .replace(/^#!.*\r?\n/, '')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default[\s\S]*?;\s*$/m, '')
    .replace(/^export (function|const|async function)/gm, '$1')
    .replace(/^export \{[^}]*\};?\s*$/gm, '');
  return '// \u2500\u2500 ' + f + ' \u2500\u2500\nconst { ' + names.join(', ') + ' } = (() => {\n' + body + '\nreturn { ' + names.join(', ') + ' };\n})();';
}).join('\n');

// THE VISIBLE SEAL (CARD-SPEC §7.1) — sealmark.mjs, scoped like the studio kernels: the page draws the band
// on every card it forges and reads it back off a stripped card with the same gated code.
const SEAL_OPEN = '/* __SEALMARK_KERNEL__ */';
const SEAL_CLOSE = '/* __END_SEALMARK_KERNEL__ */';
const SEAL_NAMES = ['ALPHABET', 'sealCode', 'normalizeCode', 'resolveCode', 'bandLayout', 'paintBand', 'readBand', 'BAND_PAPER', 'BAND_INK', 'tallySurvival', 'judgeSurvival'];
// the survival run: its sealed pre-registration always, and its raw reads once they exist — the page tallies
// them itself with the inlined kernel, so no survival number on the page is typed or trusted
const SURV_OPEN = '/* __SURVIVE_DATA__ */', SURV_CLOSE = '/* __END_SURVIVE_DATA__ */';
const readJson = (f) => { const u = new URL('../' + f, import.meta.url); return existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null; };
const survPre = readJson('data/survive-prereg.json'), survRun = readJson('data/survive.json');
const SURVIVE = survPre && {
  prereg: { rules: survPre.rules, predictions: survPre.predictions, transforms: survPre.transforms, pilot: survPre.pilot, notMeasured: survPre.notMeasured, n: survPre.cards.n },
  run: survRun && { sealedIn: survRun.sealedIn.slice(0, 7), ranAt: survRun.ranAt, browser: (/Chrome\/[\d.]+/.exec(survRun.browser) || [''])[0], seals: survRun.cards.map((c) => c.seal), reads: Object.fromEntries(Object.entries(survRun.reads).map(([k, rs]) => [k, rs.map((r) => ({ read: r.read }))])) },
};
const survBlock = 'const SURVIVE = ' + JSON.stringify(SURVIVE || null).replace(/</g, '\\u003c') + ';';
const sealBody = readFileSync(new URL('../sealmark.mjs', import.meta.url), 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default[\s\S]*?;\s*$/m, '')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '');
const sealKernel = '// ── sealmark.mjs ──\nconst { ' + SEAL_NAMES.join(', ') + ' } = (() => {\n' + sealBody + '\nreturn { ' + SEAL_NAMES.join(', ') + ' };\n})();';

const html = readFileSync(new URL('../page.template.html', import.meta.url), 'utf8');
const a = html.indexOf(OPEN), b = html.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('the kernel markers are missing from page.template.html');
const fa = html.indexOf(FOLD_OPEN), fb = html.indexOf(FOLD_CLOSE);
if (fa < 0 || fb < 0) throw new Error('the fold-kernel markers are missing from page.template.html');

const sa = html.indexOf(STUDIO_OPEN), sb = html.indexOf(STUDIO_CLOSE);
if (sa < 0 || sb < 0) throw new Error('the studio-kernel markers are missing from page.template.html');

// splice the LATER markers first so the earlier offsets stay valid
let out = html.slice(0, sa + STUDIO_OPEN.length) + '\n' + studioKernel + '\n' + html.slice(sb);
const fa2 = out.indexOf(FOLD_OPEN), fb2 = out.indexOf(FOLD_CLOSE);
out = out.slice(0, fa2 + FOLD_OPEN.length) + '\n' + foldKernel + '\n' + out.slice(fb2);
const va = out.indexOf(SURV_OPEN), vb = out.indexOf(SURV_CLOSE);
if (va < 0 || vb < 0) throw new Error('the survive-data markers are missing from page.template.html');
out = out.slice(0, va + SURV_OPEN.length) + '\n' + survBlock + '\n' + out.slice(vb);
const ma = out.indexOf(SEAL_OPEN), mb = out.indexOf(SEAL_CLOSE);
if (ma < 0 || mb < 0) throw new Error('the sealmark markers are missing from page.template.html');
out = out.slice(0, ma + SEAL_OPEN.length) + '\n' + sealKernel + '\n' + out.slice(mb);
const a2 = out.indexOf(OPEN), b2 = out.indexOf(CLOSE);
out = out.slice(0, a2 + OPEN.length) + '\n' + kernel + '\n' + out.slice(b2);
writeFileSync(new URL('../index.html', import.meta.url), out);

// README's survival block, generated from the same raw reads by the same kernel — never typed
{
  const { tallySurvival, judgeSurvival } = await import(new URL('../sealmark.mjs', import.meta.url).href);
  const RB = '<!-- ⟦SURVIVE-BEGIN⟧ generated by scripts/build-page.mjs — do not edit here -->', RE = '<!-- ⟦SURVIVE-END⟧ -->';
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const ra = readme.indexOf(RB), re = readme.indexOf(RE);
  if (ra < 0 || re < 0) throw new Error('the survive markers are missing from README.md');
  const L = [];
  if (!SURVIVE) L.push('Not sealed yet.');
  else if (!SURVIVE.run) L.push('Sealed in `data/survive-prereg.json` before the run: ' + SURVIVE.prereg.rules.map((r) => r.rule).join('; ') + '. The result lands here whichever way it goes.');
  else {
    const t = tallySurvival(SURVIVE.run.seals, SURVIVE.run.reads, SURVIVE.prereg.transforms), j = judgeSurvival(t);
    const label = Object.fromEntries(SURVIVE.prereg.transforms.map((x) => [x.id, x.label]));
    L.push('**The sealed run: ' + j.passed + ' of ' + j.of + ' rules held.** ' + SURVIVE.prereg.n + ' fresh cards, forged and read back by the live page itself (' + SURVIVE.run.browser + '\'s own encoders; rules sealed in `' + SURVIVE.run.sealedIn + '` before the run).');
    L.push('');
    L.push('| Damage | Read exactly | Right card | Refused | Wrong card | Unreadable per card |');
    L.push('|---|---|---|---|---|---|');
    for (const r of t.rows) L.push('| ' + label[r.id] + (r.realistic ? '' : ' (edge)') + ' | ' + r.exact + '/' + r.n + ' | ' + r.right + '/' + r.n + ' | ' + r.refused + ' | ' + r.wrong + ' | ' + r.meanUnknown + ' |');
    L.push('');
    L.push('| Sealed rule | Result | | Predicted |');
    L.push('|---|---|---|---|');
    for (const r of j.rules) L.push('| ' + SURVIVE.prereg.rules.find((x) => x.id === r.id).rule + ' | ' + r.value + ' | ' + (r.pass ? 'PASS' : 'FAIL') + ' | ' + SURVIVE.prereg.predictions[r.id] + ' |');
    L.push('');
    L.push('Not measured here: ' + SURVIVE.prereg.notMeasured);
  }
  writeFileSync(new URL('../README.md', import.meta.url), readme.slice(0, ra + RB.length) + '\n' + L.join('\n') + '\n' + readme.slice(re));
}

for (const fn of ['function embed', 'function read', 'function rarity', 'function crc32', 'function sealCode', 'function readBand', 'function resolveCode']) {
  if (!out.includes(fn)) throw new Error(`the page does not contain ${fn} — the inline did not take`);
}
if (/^export /m.test(out.slice(a, out.indexOf(CLOSE)))) throw new Error('module syntax survived into the page');
console.log(`index.html — kernel inlined, ${kernel.split('\n').length} lines, page ${(out.length / 1024).toFixed(0)}KB`);
