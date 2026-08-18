// build-page.mjs — the Forge, as a room you can walk into.
//
// ⚑ THE PAGE RUNS THE GATED KERNEL. card.mjs is inlined verbatim between the markers, so the code the
// mutation gate attacked is the code that mints the card you download. The two impure steps —
// compressing and hashing — are the browser's own CompressionStream and crypto.subtle, handed in.
// Shipping a copy of zlib to a page that already has one would be worse than useless.
import { readFileSync, writeFileSync } from 'node:fs';

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

const html = readFileSync(new URL('../page.template.html', import.meta.url), 'utf8');
const a = html.indexOf(OPEN), b = html.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('the kernel markers are missing from page.template.html');
const fa = html.indexOf(FOLD_OPEN), fb = html.indexOf(FOLD_CLOSE);
if (fa < 0 || fb < 0) throw new Error('the fold-kernel markers are missing from page.template.html');

// splice the LATER markers first so the earlier offsets stay valid
let out = html.slice(0, fa + FOLD_OPEN.length) + '\n' + foldKernel + '\n' + html.slice(fb);
const a2 = out.indexOf(OPEN), b2 = out.indexOf(CLOSE);
out = out.slice(0, a2 + OPEN.length) + '\n' + kernel + '\n' + out.slice(b2);
writeFileSync(new URL('../index.html', import.meta.url), out);

for (const fn of ['function embed', 'function read', 'function rarity', 'function crc32']) {
  if (!out.includes(fn)) throw new Error(`the page does not contain ${fn} — the inline did not take`);
}
if (/^export /m.test(out.slice(a, out.indexOf(CLOSE)))) throw new Error('module syntax survived into the page');
console.log(`index.html — kernel inlined, ${kernel.split('\n').length} lines, page ${(out.length / 1024).toFixed(0)}KB`);
