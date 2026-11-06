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
const SEAL_NAMES = ['ALPHABET', 'READ_RULES', 'READ_RULE', 'sealCode', 'normalizeCode', 'resolveCode', 'bandLayout', 'paintBand', 'readBand', 'BAND_PAPER', 'BAND_INK', 'tallySurvival', 'judgeSurvival', 'compareRules', 'judgeUV'];
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

// THE PAID READ — vision.mjs inlined (scoped; it uses the sealmark names already in the page), its sealed
// pre-registration always, and once it has run, the raw replies and the provider's token counts. The page grades
// and prices them itself with the inlined kernel — no paid-read number is typed.
const VIS_OPEN = '/* __VISION_KERNEL__ */', VIS_CLOSE = '/* __END_VISION_KERNEL__ */';
const VIS_NAMES = ['extractCode', 'tallyVision', 'judgeVision', 'spend'];
const visBody = readFileSync(new URL('../vision.mjs', import.meta.url), 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default[\s\S]*?;\s*$/m, '')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '');
const visKernel = '// ── vision.mjs ──\nconst { ' + VIS_NAMES.join(', ') + ' } = (() => {\n' + visBody + '\nreturn { ' + VIS_NAMES.join(', ') + ' };\n})();';
const VD_OPEN = '/* __VISION_DATA__ */', VD_CLOSE = '/* __END_VISION_DATA__ */';
const visPre = readJson('data/vision-prereg.json'), visRun = readJson('data/vision.json'), visPlumb = readJson('data/vision-plumbing.json'), visCards = readJson('data/vision/cards.json');
const lock = readJson('prices.lock.json');
const VISION = visPre && {
  prereg: { rules: visPre.rules, predictions: visPre.predictions, conditions: visPre.conditions, instruction: visPre.call.instruction, model: visPre.call.model, n: visPre.cards.n },
  run: visRun && (() => {
    const test = visCards.cards.filter((c) => !c.plumbing);
    const pos = Object.fromEntries(test.map((c, i) => [c.i, i]));
    const replies = Object.fromEntries(visPre.conditions.map((c) => [c.id, test.map(() => null)]));
    for (const r of visRun.rows) replies[r.condition][pos[r.card]] = r.reply;
    const price = lock.entries.find((e) => e.id === visPre.call.model);
    return {
      sealedIn: visRun.sealedIn.slice(0, 7), seals: test.map((c) => c.seal), replies,
      usages: visRun.rows.filter((r) => r.usage).map((r) => r.usage), plumbing: (visPlumb ? visPlumb.rows : []).filter((r) => r.usage).map((r) => r.usage),
      price: { inPerM: price.inPerM, outPerM: price.outPerM, currency: price.currency }, gbpPerUsd: lock.entries.find((e) => e.id === 'fx-gbp-usd').gbpPerUsd,
      cacheMultiples: visPre.cacheMultiples, credential: [...new Set(visRun.rows.map((r) => r.init && r.init.apiKeySource))],
      cliUsd: Math.round(visRun.rows.reduce((a, r) => a + (r.cliCostUsd || 0), 0) * 1e4) / 1e4, purse: visRun.purse.line,
    };
  })(),
};
const visData = 'const VISION = ' + JSON.stringify(VISION || null).replace(/</g, '\\u003c') + ';';

// THE FIRST THING THE GAME SHIPPED — read rule 0.2 (U reads as V). The page re-derives the measurement itself from
// the paid read's replies and the survival run's reads it already carries; this block brings only the seal's words.
const SH_OPEN = '/* __SHIP_DATA__ */', SH_CLOSE = '/* __END_SHIP_DATA__ */';
const uvPre = readJson('data/uv-prereg.json'), uvRun = readJson('data/uv-run.json');
const SHIP = uvPre && { prereg: { rules: uvPre.rules, predictions: uvPre.predictions, credit: uvPre.credit, change: uvPre.change }, run: uvRun && { sealedIn: uvRun.sealedIn.slice(0, 7) } };
const shipData = 'const SHIP = ' + JSON.stringify(SHIP || null).replace(/</g, '\\u003c') + ';';
const sealBody = readFileSync(new URL('../sealmark.mjs', import.meta.url), 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default[\s\S]*?;\s*$/m, '')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '');
const sealKernel = '// ── sealmark.mjs ──\nconst { ' + SEAL_NAMES.join(', ') + ' } = (() => {\n' + sealBody + '\nreturn { ' + SEAL_NAMES.join(', ') + ' };\n})();';

// THE TRADE (MESH step 2) — trade.mjs (gated) plus the two vendored transport pieces it rides on: fall-os's
// hand-pasted-invite WebRTC link and fall-federate's invite check. Each scoped, like the studio kernels.
const TRADE_OPEN = '/* __TRADE_KERNEL__ */', TRADE_CLOSE = '/* __END_TRADE_KERNEL__ */';
const TRADE_PARTS = {
  'trade.mjs': ['LIMITS', 'MAX_CARD_B64', 'cardParts', 'makeAssembler', 'inviteIdOf', 'keyOfInviteId', 'fingerprintOf', 'helloText', 'admit'],
  'vendor/fall-os/webrtc.mjs': ['makeLink'],
  'vendor/fall-federate/signaling.mjs': ['makeInvite', 'readInvite'],
};
const tradeKernel = Object.entries(TRADE_PARTS).map(([f, names]) => {
  const body = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
    .replace(/^#!.*\r?\n/, '')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default[\s\S]*?;\s*$/m, '')
    .replace(/^export (function|const|async function)/gm, '$1')
    .replace(/^export \{[^}]*\};?\s*$/gm, '');
  return '// ── ' + f + ' ──\nconst { ' + names.join(', ') + ' } = (() => {\n' + body + '\nreturn { ' + names.join(', ') + ' };\n})();';
}).join('\n');

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
for (const [o, c, body, what] of [[SH_OPEN, SH_CLOSE, shipData, 'ship-data'], [VD_OPEN, VD_CLOSE, visData, 'vision-data'], [VIS_OPEN, VIS_CLOSE, visKernel, 'vision-kernel']]) {
  const x = out.indexOf(o), y = out.indexOf(c);
  if (x < 0 || y < 0) throw new Error('the ' + what + ' markers are missing from page.template.html');
  out = out.slice(0, x + o.length) + '\n' + body + '\n' + out.slice(y);
}
const va = out.indexOf(SURV_OPEN), vb = out.indexOf(SURV_CLOSE);
if (va < 0 || vb < 0) throw new Error('the survive-data markers are missing from page.template.html');
out = out.slice(0, va + SURV_OPEN.length) + '\n' + survBlock + '\n' + out.slice(vb);
const ma = out.indexOf(SEAL_OPEN), mb = out.indexOf(SEAL_CLOSE);
if (ma < 0 || mb < 0) throw new Error('the sealmark markers are missing from page.template.html');
out = out.slice(0, ma + SEAL_OPEN.length) + '\n' + sealKernel + '\n' + out.slice(mb);
const ta = out.indexOf(TRADE_OPEN), tb = out.indexOf(TRADE_CLOSE);
if (ta < 0 || tb < 0) throw new Error('the trade-kernel markers are missing from page.template.html');
out = out.slice(0, ta + TRADE_OPEN.length) + '\n' + tradeKernel + '\n' + out.slice(tb);
const a2 = out.indexOf(OPEN), b2 = out.indexOf(CLOSE);
out = out.slice(0, a2 + OPEN.length) + '\n' + kernel + '\n' + out.slice(b2);

// the FAQ for answer engines (schema.org FAQPage) — its numbers come from the sealed, committed measurements, never typed
{
  const QB = '<!-- ⟦FAQ-BEGIN⟧ generated by scripts/build-page.mjs from the sealed results -->', QE = '<!-- ⟦FAQ-END⟧ -->';
  const qa = out.indexOf(QB), qe = out.indexOf(QE);
  if (qa < 0 || qe < 0) throw new Error('the faq markers are missing from page.template.html');
  const faq = [
    ['What is a FallKard card?', 'A normal PNG that openly carries a real single-file build in two declared PNG text chunks, with a manifest and a sha256 seal. It renders as a picture anywhere; the Forge reads it back, verifies the seal and, only if you click, hatches the build in a sandbox. Nothing is hidden in the pixels.'],
    ['What happens if a platform strips the card or turns it into a JPEG?', 'Every card prints the first 80 bits of its seal on its face as a 16-symbol code. The reader reads that code off the pixels, or you type it, and finds the card in your deck: the cards this device already holds. The build then comes from your deck and must match the full seal. A read that could be two cards is refused, never guessed.'],
  ];
  if (uvPre && uvRun) {
    const r = uvRun.result, c = r.byCondition.png35, reads = r.parts.recorded.n + r.parts.pixels.n;
    faq.push(['What did the creatures of kard-evolve ship into the card format?', 'Read rule 0.2: a U is read as the V it was. A vision model reading small copies of cards saw V as U, a letter no code uses, so those reads were refused. Creatures evolving code-reading rules in kard-evolve found the fold from those misreads with nothing telling them to look. Sealed before it was measured, it held ' + r.judged.passed + ' of ' + r.judged.of + ' rules: at 35% size the model\'s reads went from ' + c.before.right + ' to ' + c.after.right + ' of ' + c.n + ' right cards, with ' + (r.parts.recorded.after.wrong + r.parts.pixels.after.wrong) + ' wrong across ' + reads + ' reads.']);
  }
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }).replace(/</g, '\\u003c');
  out = out.slice(0, qa + QB.length) + '\n<script type="application/ld+json">' + ld + '</script>\n' + out.slice(qe);
}

const htmlEsc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const splice = (src, open, close, body, what) => {
  const x = src.indexOf(open), y = src.indexOf(close);
  if (x < 0 || y < 0) throw new Error('the ' + what + ' markers are missing from page.template.html');
  return src.slice(0, x + open.length) + '\n' + body + '\n' + src.slice(y);
};

// THE COST CASE (For a business) — forgecase.mjs inlined verbatim and scoped, fed the basis entries it reads, taken
// from the vendored, sourced file it is tested against. No figure in the case is typed into the page.
{
  const CASE_NAMES = ['DEFAULTS', 'BASIS_KEYS', 'sourcesOf', 'forgeCase'];
  const body = readFileSync(new URL('../forgecase.mjs', import.meta.url), 'utf8')
    .replace(/^#!.*\r?\n/, '')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default[\s\S]*?;\s*$/m, '')
    .replace(/^export (function|const|async function)/gm, '$1')
    .replace(/^export \{[^}]*\};?\s*$/gm, '');
  out = splice(out, '/* __CASE_KERNEL__ */', '/* __END_CASE_KERNEL__ */',
    '// ── forgecase.mjs ──\nconst { ' + CASE_NAMES.join(', ') + ' } = (() => {\n' + body + '\nreturn { ' + CASE_NAMES.join(', ') + ' };\n})();', 'case-kernel');
  const { BASIS_KEYS } = await import(new URL('../forgecase.mjs', import.meta.url).href);
  const basis = JSON.parse(readFileSync(new URL('../vendor/sovereign-enterprise/data/basis.json', import.meta.url), 'utf8'));
  const picked = Object.fromEntries(BASIS_KEYS.map((k) => [k, basis[k]]));
  out = splice(out, '/* __CASE_DATA__ */', '/* __END_CASE_DATA__ */',
    '// the basis entries the case reads, from vendor/sovereign-enterprise/data/basis.json\nconst CASE_BASIS = ' + JSON.stringify(picked).replace(/</g, '\\u003c') + ';', 'case-data');
}

// HOW IT WORKS, traced from a real card: the genesis card in examples/, read by the command line, by the standalone
// reader's judgement and by the gate — every figure on the page comes out of that file here, none is typed.
{
  const { read: cliRead, parseChunks: chunksOf } = await import(new URL('../forge.mjs', import.meta.url).href);
  const { sealCode } = await import(new URL('../sealmark.mjs', import.meta.url).href);
  const { validateComposition } = await import(new URL('../studio.mjs', import.meta.url).href);
  const RC = await import(new URL('../reader-core.mjs', import.meta.url).href);
  const { spawnSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  const rel = 'examples/seal-000.png';
  const file = readFileSync(new URL('../' + rel, import.meta.url));
  const r = cliRead(file);
  if (!r.manifest || !r.payload) throw new Error('the traced card does not read');
  const build = r.hatch();
  const recomputed = createHash('sha256').update(r.payload).digest('hex');
  const gate = validateComposition(build);
  const chunks = chunksOf(file).map((c) => {
    const text = /^(tEXt|zTXt|iTXt)$/.test(c.type);
    return c.type + (text ? ' “' + Buffer.from(c.data).toString('latin1', 0, Buffer.from(c.data).indexOf(0)) + '”' : '') + ' ' + c.data.length.toLocaleString('en-GB') + ' B';
  });
  const { fileURLToPath } = await import('node:url');
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../forge.mjs', import.meta.url)), 'read', rel],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
  const cliFirst = String(cli.stdout || '').split('\n')[0].trim();
  if (cli.status !== 0 || !cliFirst) throw new Error('the command line did not read the traced card: ' + (cli.stderr || '').slice(0, 200));
  const j = await RC.judge(new Uint8Array(file));
  const v = RC.verdictOf(j);
  const firstLine = build.split('\n').find((l) => l.trim()) || '';
  const rows = [
    ['the file', '<code>' + htmlEsc(rel) + '</code> · ' + file.length.toLocaleString('en-GB') + ' bytes, a PNG any viewer shows'],
    ['its chunks, in order', chunks.map(htmlEsc).join(' · ') + ' — the picture is the IHDR and IDAT; the card adds only the two named chunks before IEND'],
    ['the build inside', Buffer.byteLength(build, 'utf8').toLocaleString('en-GB') + ' bytes of HTML, starting <code>' + htmlEsc(firstLine.trim().slice(0, 60)) + '</code>'],
    ['compressed', r.payload.length.toLocaleString('en-GB') + ' bytes of gzip — what the seal covers'],
    ['the seal on its label', '<code>' + htmlEsc(r.manifest.seal) + '</code>'],
    ['the seal worked out again', '<code>' + htmlEsc(recomputed) + '</code> — ' + (recomputed === r.manifest.seal ? 'the same, byte for byte' : 'DIFFERENT')],
    ['the code printed on its face', '<code>' + htmlEsc(sealCode(r.manifest.seal)) + '</code> — the seal\'s first 80 bits, in Crockford base32'],
    ['signature', r.signed ? (r.sigOk ? 'Ed25519, verifies' : 'present, and it FAILS') : 'none — this card carries no signature, so no key vouches for who forged it; cards forged on this page or by the command line today are signed'],
    ['tier, re-derived from the build', htmlEsc(r.earnedTier) + (gate.ok ? ' — the build passes the sovereignty gate' : ' — the gate says: ' + htmlEsc(gate.reasons.join('; ')))],
    ['parent', r.manifest.parent ? '<code>' + htmlEsc(r.manifest.parent) + '</code>' : '(root) — this is the genesis card; the quine in <code>examples/</code> names it as its parent'],
    ['the command line says', '<code>' + htmlEsc(cliFirst) + '</code> (<code>node forge.mjs read ' + htmlEsc(rel) + '</code>, exit ' + cli.status + ')'],
    ['the standalone reader says', '<code>' + htmlEsc(v.text) + '</code> — and it ' + (v.hatch ? 'will open the build on a click' : 'will not open the build')],
  ];
  const table = '<div class="tablewrap"><table class="t"><tbody>' + rows.map(([k, val]) => '<tr><td>' + htmlEsc(k) + '</td><td>' + val + '</td></tr>').join('') + '</tbody></table></div>';
  const TB = '<!-- ⟦TRACE-BEGIN⟧ generated by scripts/build-page.mjs from examples/seal-000.png -->', TE = '<!-- ⟦TRACE-END⟧ -->';
  out = splice(out, TB, TE, table, 'trace');
}

// THE BLUEPRINT — organ by organ. What each organ does is written here; which test files exercise it, how many tests
// they hold, and how it is gated are READ from the repository (the test files' imports, the gate workflow, the
// baseline files), so the table cannot claim a gate the workflow does not run.
{
  const { readdirSync } = await import('node:fs');
  const ORGANS = [
    ['card.mjs', 'The card kernel for the browser: PNG chunks, embedding, reading, the label, the signable string and the earned tier. Inlined into this page and the standalone reader.'],
    ['forge.mjs', 'The command line and Node library: forge a card, sign it with the key in ~/.fallkard/identity.json, read one (it never throws), hatch only on request.'],
    ['reader-core.mjs', 'The standalone reader\'s judgement and every word of its verdict: the seal worked out again, the Ed25519 signature checked, the tier re-derived, card text escaped.'],
    ['studio.mjs', 'The sovereignty gate that earns a build its tier (a real document, nothing reaching outside, the architecture line), and the studio\'s catalogue and composer.'],
    ['sealmark.mjs', 'The printed seal: the code on every card face, its dot font, the pixel reader, and the deck match that refuses rather than guesses.'],
    ['art.mjs', 'The card picture drawn from its own tags and seal, so a picture cannot contradict its reading key.'],
    ['png.mjs', 'The PNG chunk primitives — CRC, parse, serialise — shared by the forge and the art.'],
    ['lineage.mjs', 'Walks a deck\'s parent links and reports what it can prove: depth, orphans, cycles, broken seals and overclaims.'],
    ['trade.mjs', 'Trading cards device to device: parts and reassembly, the proof of key bound to this link, and the verdict order transit → parse → seal → signature.'],
    ['vision.mjs', 'Grades a vision model\'s reads of the printed seal, for the sealed paid-read run.'],
    ['artifact.mjs', 'Sovereign-artifact bundles: who minted a build and what it forks from, signed with Ed25519 and verified from the file alone.'],
    ['babykcc.mjs', 'The studio\'s local, hash-chained record of what this browser minted. Accounting only: no network, no money, kept on the device.'],
    ['fold.mjs', 'The fold glyph: a crease pattern that either closes or does not, carried by the Fold-one cards.'],
    ['forgecase.mjs', 'The cost case in For a business, computed from the vendored, sourced basis.'],
  ];
  const root = new URL('..', import.meta.url);
  const yml = readFileSync(new URL('../.github/workflows/gate.yml', import.meta.url), 'utf8');
  const testFiles = readdirSync(root).filter((f) => /^(test|.+\.test)\.mjs$/.test(f)).sort();
  const testSrc = Object.fromEntries(testFiles.map((f) => [f, readFileSync(new URL('../' + f, import.meta.url), 'utf8')]));
  const counted = (src) => { const n = (src.match(/^test\(/gm) || []).length; return n ? n + ' test' + (n === 1 ? '' : 's') : 'a self-checking script'; };
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the test files a kernel's gate runs, read off the workflow: a matrix row (kernel: F, tests: …) or a step (mutate F … --test …)
  const gateTests = (file) => {
    const row = new RegExp('kernel: ' + reEsc(file) + ', tests: ([^,}]+)').exec(yml);
    const step = new RegExp('mutate ' + reEsc(file) + ' [^\\n]*--test "?(?:node --test |node )?([^"\\n|]+)').exec(yml);
    return [...new Set((row ? row[1] : step ? step[1] : '').trim().split(/\s+/).filter((t) => /\.mjs$/.test(t)))];
  };
  const baselineFor = (file) => {
    const m = new RegExp('kernel: ' + reEsc(file) + ',[^}]*baseline: (\\S+?) ?\\}').exec(yml);
    return m ? m[1] : 'witness.baseline.json';
  };
  const rowsB = ORGANS.map(([file, role]) => {
    const src = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const lines = src.replace(/\n$/, '').split('\n').length;
    const importers = testFiles.filter((t) => new RegExp("from '(?:\\./)+" + reEsc(file) + "'").test(testSrc[t]));
    const tests = gateTests(file).length ? gateTests(file) : importers;
    for (const t of tests) if (!testSrc[t]) throw new Error('the gate for ' + file + ' runs ' + t + ', which is not in the repository');
    const gated = [];
    if (new RegExp('\\.witness6/witness\\.mjs mutate ' + reEsc(file) + ' ').test(yml) || new RegExp('kernel: ' + reEsc(file) + ',').test(yml)) gated.push('v0.6');
    if (new RegExp('\\.witness/witness\\.mjs mutate ' + reEsc(file) + ' ').test(yml)) gated.push('v0.2');
    let excused = 0;
    if (gated.length) {
      const bl = JSON.parse(readFileSync(new URL('../' + baselineFor(file), import.meta.url), 'utf8'));
      const own = new Set(src.split('\n').map((l) => l.trim().slice(0, 90)));
      excused = bl.filter((e) => e && own.has(e.snippet)).length;
    }
    const gate = gated.length
      ? 'mutation-gated on every push (witness ' + gated.join(' and ') + '); ' + (excused ? excused + ' exemption' + (excused === 1 ? '' : 's') + ' on file, each with a written reason' : 'no exemptions')
      : 'tested, not mutation-gated';
    return '<tr><td><code>' + htmlEsc(file) + '</code><br><span class="sub">' + lines.toLocaleString('en-GB') + ' lines</span></td><td>' + htmlEsc(role) + '</td><td>'
      + (tests.length ? tests.map((t) => '<code>' + htmlEsc(t) + '</code> (' + (testSrc[t] ? counted(testSrc[t]) : 'MISSING') + ')').join('<br>') : '—') + '</td><td>' + htmlEsc(gate) + '</td></tr>';
  });
  const table = '<div class="tablewrap"><table class="t"><thead><tr><th>organ</th><th>what it does</th><th>the tests its gate runs</th><th>gate</th></tr></thead><tbody>'
    + rowsB.join('') + '</tbody></table></div>'
    + '<p class="sub">Also built from these on every push and required to match what is committed: this page (<code>index.html</code>, from <code>page.template.html</code>) and the standalone reader (<code>reader.html</code>, from <code>reader.template.html</code>). Vendored, with provenance: <code>vendor/fall-os/webrtc.mjs</code> (the WebRTC link), <code>vendor/fall-federate/signaling.mjs</code> (the invite check), <code>vendor/sovereign-enterprise/data/basis.json</code> (the cost case\'s sources).</p>';
  const BB = '<!-- ⟦BLUEPRINT-BEGIN⟧ generated by scripts/build-page.mjs from the repository -->', BE = '<!-- ⟦BLUEPRINT-END⟧ -->';
  out = splice(out, BB, BE, table, 'blueprint');
}
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
  let readme2 = readme.slice(0, ra + RB.length) + '\n' + L.join('\n') + '\n' + readme.slice(re);

  // the paid read's block, the same way
  const { extractCode, tallyVision, judgeVision, spend } = await import(new URL('../vision.mjs', import.meta.url).href);
  const { sealCode, normalizeCode } = await import(new URL('../sealmark.mjs', import.meta.url).href);
  const VB = '<!-- ⟦VISION-BEGIN⟧ generated by scripts/build-page.mjs — do not edit here -->', VE = '<!-- ⟦VISION-END⟧ -->';
  const vb = readme2.indexOf(VB), ve = readme2.indexOf(VE);
  if (vb < 0 || ve < 0) throw new Error('the vision markers are missing from README.md');
  const V = [];
  if (!VISION) V.push('Not sealed yet.');
  else if (!VISION.run) V.push('Sealed in `data/vision-prereg.json` before the first paid call: ' + VISION.prereg.rules.map((r) => r.rule).join('; ') + '. The result lands here whichever way it goes.');
  else {
    const R = VISION.run, P = VISION.prereg;
    const t = tallyVision(R.seals, R.replies, P.conditions), j = judgeVision(t);
    const sp = spend([...R.usages, ...R.plumbing], R.price, R.gbpPerUsd, R.cacheMultiples), spRun = spend(R.usages, R.price, R.gbpPerUsd, R.cacheMultiples);
    const label = Object.fromEntries(P.conditions.map((c) => [c.id, c.label]));
    const fmt = (n) => n.toLocaleString('en-GB');
    V.push('**The paid read: ' + j.passed + ' of ' + j.of + ' sealed rules held.** ' + P.n + ' more fresh cards; each picture went alone to ' + P.model + ' with one instruction and never the code, and every reply was graded against the committed codes by `vision.mjs` (sealed in `' + R.sealedIn + '` before the first paid call).');
    V.push('');
    V.push('| Picture | Read exactly | Right card | Refused | Wrong card |');
    V.push('|---|---|---|---|---|');
    for (const r of t.rows) V.push('| ' + label[r.id] + ' | ' + r.exact + '/' + r.n + ' | ' + r.right + '/' + r.n + ' | ' + r.refused + ' | ' + r.wrong + ' |');
    V.push('');
    V.push('| Sealed rule | Result | | Predicted |');
    V.push('|---|---|---|---|');
    for (const r of j.rules) V.push('| ' + P.rules.find((x) => x.id === r.id).rule + ' | ' + r.value + ' | ' + (r.pass ? 'PASS' : 'FAIL') + ' | ' + P.predictions[r.id] + ' |');
    const misses = R.replies.full.map((rep, i) => ({ rep, code: sealCode(R.seals[i]) })).filter((m) => normalizeCode(extractCode(m.rep), '0.1') !== m.code.replace(/-/g, ''));
    if (misses.length) { V.push(''); V.push('Full-size cards not read exactly (code → reply): ' + misses.map((m) => '`' + m.code + '` → `' + String(m.rep || '(no reply)').slice(0, 60).replace(/`/g, "'") + '`').join(' · ')); }
    V.push('');
    { const { resolveCode } = await import(new URL('../sealmark.mjs', import.meta.url).href);
      const all = P.conditions.flatMap((c) => R.replies[c.id].map((rep, i) => ({ rep, i })));
      const refused = all.filter(({ rep }) => !resolveCode(extractCode(rep), R.seals, { rule: '0.1' }).ok), uRead = refused.filter(({ rep }) => /u/i.test(extractCode(rep) || ''));
      const uFolded = uRead.filter(({ rep, i }) => { const k = resolveCode(extractCode(rep), R.seals, { rule: '0.2' }); return k.ok && k.seal === R.seals[i]; });
      if (refused.length) { V.push(''); V.push((uRead.length === refused.length ? 'Every refusal was the same slip' : uRead.length + ' of the ' + refused.length + ' refusals were one slip') + ': V read as U, a letter the alphabet leaves out, so the whole read was refused rather than guessed. Folding U to V, the way O is already folded to 0, finds the right card for ' + uFolded.length + ' of those ' + uRead.length + ' — checked after the run, so not part of this sealed result. It has since shipped as read rule 0.2, measured on its own seal (below).'); } }
    V.push('');
    V.push('Spend: ' + sp.calls + ' calls (' + spRun.calls + ' reads + ' + R.plumbing.length + ' plumbing check), ' + fmt(sp.input) + ' input and ' + fmt(sp.output) + ' output tokens by the provider\'s own count — **$' + sp.usd.toFixed(4) + ' (£' + sp.gbp.toFixed(4) + ')** at the ' + P.model + ' list price locked in `prices.lock.json`. Paid by the Claude subscription through the official CLI (credential source: ' + R.credential.join(', ') + ' — no API key), so that is what an API key would have paid, not new money.');
  }
  readme2 = readme2.slice(0, vb + VB.length) + '\n' + V.join('\n') + '\n' + readme2.slice(ve);

  // the shipped change's block, from its sealed, committed measurement (CI re-runs it with uv-ship.mjs --verify)
  const UB = '<!-- ⟦UV-BEGIN⟧ generated by scripts/build-page.mjs — do not edit here -->', UE = '<!-- ⟦UV-END⟧ -->';
  const ub = readme2.indexOf(UB), ue = readme2.indexOf(UE);
  if (ub < 0 || ue < 0) throw new Error('the uv markers are missing from README.md');
  const U = [];
  if (!uvPre) U.push('Not sealed yet.');
  else if (!uvRun) U.push('Sealed in `data/uv-prereg.json` before it was measured: ' + uvPre.rules.map((r) => r.rule).join('; ') + '. The result lands here whichever way it goes.');
  else {
    const r = uvRun.result, jj = r.judged, P = r.parts;
    const cond = { full: 'paid read — full size', jpeg60at60: 'paid read — platform copy', png35: 'paid read — 35% copy' };
    U.push('**Read rule 0.2 — U reads as V — measured on its own seal (`' + uvRun.sealedIn.slice(0, 7) + '`): ' + jj.passed + ' of ' + jj.of + ' sealed rules held.**');
    U.push('');
    U.push('| Reads | Right card, rule 0.1 | Right card, rule 0.2 | Wrong card, 0.2 | Broken |');
    U.push('|---|---|---|---|---|');
    for (const [id, c] of Object.entries(r.byCondition)) U.push('| ' + cond[id] + ' | ' + c.before.right + '/' + c.n + ' | ' + c.after.right + '/' + c.n + ' | ' + c.after.wrong + ' | ' + c.broken.length + ' |');
    U.push('| survival run — every pixel read | ' + P.pixels.before.right + '/' + P.pixels.n + ' | ' + P.pixels.after.right + '/' + P.pixels.n + ' | ' + P.pixels.after.wrong + ' | ' + P.pixels.broken.length + ' |');
    U.push('| every V-card written with U | ' + P.everyV.before.right + '/' + P.everyV.n + ' | ' + P.everyV.after.right + '/' + P.everyV.n + ' | ' + P.everyV.after.wrong + ' | ' + P.everyV.broken.length + ' |');
    U.push('');
    U.push('| Sealed rule | Result | | Predicted |');
    U.push('|---|---|---|---|');
    for (const x of jj.rules) U.push('| ' + uvPre.rules.find((y) => y.id === x.id).rule + ' | ' + x.value + ' | ' + (x.pass ? 'PASS' : 'FAIL') + ' | ' + uvPre.predictions[x.id] + ' |');
    U.push('');
    U.push('The reads it fixed (the card\'s code → what the model wrote): ' + r.fixed.map((f) => '`' + f.code + '` → `' + f.read + '`').join(' · ') + '.');
  }
  readme2 = readme2.slice(0, ub + UB.length) + '\n' + U.join('\n') + '\n' + readme2.slice(ue);
  writeFileSync(new URL('../README.md', import.meta.url), readme2);
}

// THE STANDALONE READER (reader.html) — the single file the quine card carries and anyone can save and open offline.
// ⚑ It used to be hand-written, and it fell behind: it said "VERIFIED" on a seal match alone, never checked the
// Ed25519 signature, showed the tier the card CLAIMED, and put card text into the page unescaped. Now it is built
// like the page — card.mjs inlined verbatim, and the sovereignty gate (validateComposition, lifted whole from
// studio.mjs) scoped in its own block — so the reader runs the same gated code as the Forge and the CLI.
{
  const R_OPEN = '/* __GATE_KERNEL__ */', R_CLOSE = '/* __END_GATE_KERNEL__ */';
  const studioSrc = readFileSync(new URL('../studio.mjs', import.meta.url), 'utf8');
  const g = /^export function validateComposition\(html\) \{\n[\s\S]*?\n\}\n/m.exec(studioSrc);
  if (!g) throw new Error('validateComposition was not found whole in studio.mjs');
  const gateKernel = '// ── studio.mjs · validateComposition, verbatim ──\nconst { validateComposition } = (() => {\n'
    + g[0].replace(/^export function/, 'function') + 'return { validateComposition };\n})();';
  let reader = readFileSync(new URL('../reader.template.html', import.meta.url), 'utf8');
  const ra = reader.indexOf(R_OPEN), rb = reader.indexOf(R_CLOSE);
  if (ra < 0 || rb < 0) throw new Error('the gate-kernel markers are missing from reader.template.html');
  reader = reader.slice(0, ra + R_OPEN.length) + '\n' + gateKernel + '\n' + reader.slice(rb);
  // the reader's judgement and its wording — reader-core.mjs, scoped, its imports satisfied by the two blocks above
  const C_OPEN = '/* __READER_CORE__ */', C_CLOSE = '/* __END_READER_CORE__ */';
  const CORE_NAMES = ['esc', 'judge', 'verdictOf', 'factsHtml', 'keyHtml', 'tierChip'];
  const coreBody = readFileSync(new URL('../reader-core.mjs', import.meta.url), 'utf8')
    .replace(/^#!.*\r?\n/, '')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export default[\s\S]*?;\s*$/m, '')
    .replace(/^export (function|const|async function|let)/gm, '$1')
    .replace(/^export \{[^}]*\};?\s*$/gm, '');
  const coreKernel = '// ── reader-core.mjs ──\nconst { ' + CORE_NAMES.join(', ') + ' } = (() => {\n' + coreBody + '\nreturn { ' + CORE_NAMES.join(', ') + ' };\n})();';
  const ca = reader.indexOf(C_OPEN), cb = reader.indexOf(C_CLOSE);
  if (ca < 0 || cb < 0) throw new Error('the reader-core markers are missing from reader.template.html');
  reader = reader.slice(0, ca + C_OPEN.length) + '\n' + coreKernel + '\n' + reader.slice(cb);
  const ka = reader.indexOf(OPEN), kb = reader.indexOf(CLOSE);
  if (ka < 0 || kb < 0) throw new Error('the card-kernel markers are missing from reader.template.html');
  reader = reader.slice(0, ka + OPEN.length) + '\n' + kernel + '\n' + reader.slice(kb);
  for (const fn of ['function read', 'function signable', 'function tierCheck', 'function rarity', 'function validateComposition', 'function parseChunks', 'function readZText', 'async function judge', 'function verdictOf']) {
    if (!reader.includes(fn)) throw new Error(`reader.html does not contain ${fn} — the inline did not take`);
  }
  if (/^export /m.test(reader)) throw new Error('module syntax survived into reader.html');
  writeFileSync(new URL('../reader.html', import.meta.url), reader);
}

for (const fn of ['function embed', 'function read', 'function rarity', 'function crc32', 'function sealCode', 'function readBand', 'function resolveCode', 'function admit', 'function makeAssembler', 'function makeLink', 'function readInvite']) {
  if (!out.includes(fn)) throw new Error(`the page does not contain ${fn} — the inline did not take`);
}
if (/^export /m.test(out.slice(a, out.indexOf(CLOSE)))) throw new Error('module syntax survived into the page');
console.log(`index.html — kernel inlined, ${kernel.split('\n').length} lines, page ${(out.length / 1024).toFixed(0)}KB`);
