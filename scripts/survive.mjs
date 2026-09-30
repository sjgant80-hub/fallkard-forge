#!/usr/bin/env node
// scripts/survive.mjs — does the printed seal survive what a platform does to a card?
//
//   node scripts/survive.mjs --seal    write data/survive-prereg.json (refuses to overwrite) — commit and push it
//   node scripts/survive.mjs --check   exit 1 unless the committed pre-registration is exactly what --seal writes
//   node scripts/survive.mjs --run     refuses unless the pre-registration is committed and on GitHub, then runs it
//                                      once and writes data/survive.json
//
// The run drives THE PAGE ITSELF (index.html, served on localhost, headless Chrome over the DevTools
// protocol): it forges 64 fresh cards with the page's own forge, puts them in the page's deck, pushes every
// card's picture through each transform with Chrome's own encoders — which strips the chunks, as any
// re-encode does — and reads each result back with the page's own fallback reader. Every outcome the page
// reports is then re-derived here in Node from the committed reads with the gated kernel, and the run stops
// if the two ever disagree.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { sealCode, resolveCode } from '../sealmark.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PRE = join(ROOT, 'data', 'survive-prereg.json'), OUT = join(ROOT, 'data', 'survive.json');
const die = (m) => { console.error(m); process.exit(1); };

const TRANSFORMS = [
  { id: 'png', label: 'stripped PNG, full size', type: 'image/png', scale: 1, realistic: true },
  { id: 'jpeg90', label: 'JPEG quality 90', type: 'image/jpeg', quality: 0.9, scale: 1, realistic: true },
  { id: 'jpeg50', label: 'JPEG quality 50', type: 'image/jpeg', quality: 0.5, scale: 1, realistic: true },
  { id: 'jpeg20', label: 'JPEG quality 20', type: 'image/jpeg', quality: 0.2, scale: 1, realistic: true },
  { id: 'webp60', label: 'WebP quality 60', type: 'image/webp', quality: 0.6, scale: 1, realistic: true },
  { id: 'png75', label: 'PNG at 75% size', type: 'image/png', scale: 0.75, realistic: true },
  { id: 'png50', label: 'PNG at 50% size', type: 'image/png', scale: 0.5, realistic: true },
  { id: 'jpeg75at50', label: 'JPEG 75 at 50% size', type: 'image/jpeg', quality: 0.75, scale: 0.5, realistic: true },
  { id: 'jpeg60at60', label: 'JPEG 60 at 60% size', type: 'image/jpeg', quality: 0.6, scale: 0.6, realistic: true },
  { id: 'png35', label: 'PNG at 35% size', type: 'image/png', scale: 0.35, realistic: false },
  { id: 'png25', label: 'PNG at 25% size', type: 'image/png', scale: 0.25, realistic: false },
  { id: 'jpeg5', label: 'JPEG quality 5', type: 'image/jpeg', quality: 0.05, scale: 1, realistic: false },
];

function prereg() {
  return {
    kind: 'fallkard-forge-survive-prereg', v: 1, written: '2026-09-30',
    statement: 'Sealed, committed and pushed before the run. A card posted to a platform can lose its chunks and be recompressed or shrunk; CARD-SPEC §7.1 says the printed seal still finds the card in the holder\'s deck. This fixes, in advance, the cards, the damage, the reader, the bars, and a prediction. The result is published whichever way it lands.',
    question: 'Once a card has lost its chunks and its picture has been recompressed or shrunk, does the printed seal still resolve to the right card in the deck — and never to the wrong one?',
    pilot: 'During development one card was pushed through seven transforms (stripped PNG; JPEG 90, 50 and 20; WebP 60; half size as PNG and as JPEG 75) and read back exactly in all seven. That pilot is why this ladder goes further, down to a quarter size and JPEG quality 5: to find where it breaks.',
    cards: { n: 64, seed: 20260930, payload: 'a small HTML build per card, its text drawn from a seeded PRNG (mulberry32) so every card and every seal is fresh and reproducible', tags: 'owl:high-left,rose:blue:1', forge: 'the page\'s own forge (the same code as the Forge-one button)' },
    deck: 'all 64 cards, in the page\'s own deck',
    transforms: TRANSFORMS.map(({ id, label, type, quality, scale, realistic }) => ({ id, label, type, quality: quality ?? null, scale, realistic })),
    how: 'createImageBitmap of the forged PNG, drawn onto a canvas of round(size × scale) with imageSmoothingQuality high, then canvas.toBlob(type, quality) — Chrome\'s own encoders stand in for a platform\'s. Any re-encode drops the chunks. The result is read by the page\'s own readPicture (the gated readBand, then resolveCode against the deck with its defaults: at most 3 edits, a margin of 3, at most 4 unreadable symbols).',
    rules: [
      { id: 'stripped-exact', rule: 'every stripped full-size PNG reads back exactly — no edit and no unreadable symbol — 64 of 64' },
      { id: 'platform-ladder', rule: 'under every realistic transform (the first nine), all 64 cards resolve to the right card' },
      { id: 'never-wrong', rule: 'under all twelve transforms, not one read resolves to the wrong card' },
      { id: 'third-size', rule: 'at 35% size, at least 90% of the 64 cards still resolve to the right card' },
    ],
    alsoReported: 'for every transform: how many reads were exact, how many resolved right, wrong or were refused, and the mean unreadable symbols. The 25% and JPEG-5 rungs are there to find the edge and judge nothing.',
    predictions: {
      said: 'before the run, by Kar',
      'stripped-exact': 'pass',
      'platform-ladder': 'pass',
      'never-wrong': 'pass — a doubtful read is refused, not guessed',
      'third-size': 'FAIL — at 35% a dot is about one pixel, and I expect whole glyphs to smear',
      png25: 'mostly refused, none wrong',
      jpeg5: 'most still resolve: the band is two tones in big blocks, which is what JPEG keeps best',
    },
    notMeasured: 'real platforms (Discord, X, WhatsApp and the rest) — Chrome\'s encoders stand in for them, and each platform still has to be tried for real; and a vision model reading the band, which is a paid run and waits for Simon\'s key.',
  };
}

const stable = (o) => JSON.stringify(o, null, 1) + '\n';
if (process.argv.includes('--seal')) {
  if (existsSync(PRE)) die('data/survive-prereg.json exists — it is sealed');
  writeFileSync(PRE, stable(prereg()));
  console.log('sealed data/survive-prereg.json · sha256 ' + createHash('sha256').update(stable(prereg())).digest('hex'));
  process.exit(0);
}
if (process.argv.includes('--check')) {
  const same = existsSync(PRE) && readFileSync(PRE, 'utf8').replace(/\r\n/g, '\n') === stable(prereg());
  console.log(same ? 'the survival pre-registration matches its generator' : 'data/survive-prereg.json differs from what --seal writes');
  process.exit(same ? 0 : 1);
}
if (!process.argv.includes('--run')) die('usage: node scripts/survive.mjs --seal | --check | --run');

// ── the run ──────────────────────────────────────────────────────────────────────────────────────────
if (existsSync(OUT)) die('data/survive.json exists — the run happens once');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', 'data/survive-prereg.json', 'scripts/survive.mjs', 'sealmark.mjs', 'index.html')) die('commit the pre-registration, this script, the kernel and the page first');
git('fetch', '-q', 'origin');
try { git('merge-base', '--is-ancestor', 'HEAD', 'origin/main'); } catch { die('push first — HEAD is not on origin/main'); }
const sealedIn = git('log', '-1', '--format=%H', '--', 'data/survive-prereg.json');
const pre = JSON.parse(readFileSync(PRE, 'utf8'));
if (stable(pre) !== stable(prereg())) die('the committed pre-registration is not what this script seals');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const port = server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'survive-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu', 'http://127.0.0.1:' + port + '/index.html'], { stdio: 'ignore' });
const wsUrl = await (async () => {
  for (let i = 0; i < 100; i++) {
    const f = join(profile, 'DevToolsActivePort');
    if (existsSync(f)) {
      const [p] = readFileSync(f, 'utf8').split('\n');
      const list = await (await fetch('http://127.0.0.1:' + p + '/json')).json().catch(() => []);
      const page = list.find((t) => t.type === 'page' && t.url.includes('/index.html'));
      if (page) return page.webSocketDebuggerUrl;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome did not open the page');
})();
const ws = new WebSocket(wsUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
let seq = 0; const waiting = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
const evaluate = (expression) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, (m) => (m.error || m.result.exceptionDetails ? no(new Error(JSON.stringify(m.error || m.result.exceptionDetails).slice(0, 400))) : ok(m.result.result.value))); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
for (let i = 0; i < 50 && !(await evaluate('!!window.fallkardForge')); i++) await new Promise((r) => setTimeout(r, 200));

// forge the cards and fill the deck — all inside the page
const cards = await evaluate(`(async () => {
  const F = window.fallkardForge;
  await F.deckClear();
  let s = ${pre.cards.seed} >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const words = ['owl', 'rose', 'seal', 'fold', 'kard', 'witness', 'lattice', 'ember', 'quiet', 'river', 'ledger', 'gate', 'spiral', 'hatch', 'forge', 'deck'];
  window.__cards = [];
  for (let i = 0; i < ${pre.cards.n}; i++) {
    const body = Array.from({ length: 24 }, () => words[Math.floor(rnd() * words.length)]).join(' ');
    const c = await F.forge('<!doctype html><title>card ' + i + '</title><h1>card ' + i + '</h1><p>' + body + '</p>', ${JSON.stringify(pre.cards.tags)});
    await F.deckAdd({ seal: c.seal, payloadB64: c.payloadB64, manifest: c.manifest, added: 'survive' });
    window.__cards.push(c);
  }
  return window.__cards.map((c) => ({ seal: c.seal, code: F.sealCode(c.seal), bytes: c.png.length }));
})()`);
if (cards.length !== pre.cards.n || (await evaluate('window.fallkardForge.deckAll().then((d) => d.length)')) !== pre.cards.n) die('the deck did not fill');

// every card through every transform, read back by the page's own reader
const reads = {};
for (const t of pre.transforms) {
  reads[t.id] = await evaluate(`(async () => {
    const F = window.fallkardForge, t = ${JSON.stringify(t)}, out = [];
    for (const c of window.__cards) {
      const bmp = await createImageBitmap(new Blob([c.png], { type: 'image/png' }));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * t.scale); cv.height = Math.round(bmp.height * t.scale);
      const x = cv.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((r) => cv.toBlob(r, t.type, t.quality === null ? undefined : t.quality));
      const p = await F.readPicture(blob);
      out.push({ read: p.band ? p.band.read : null, unknown: p.band ? p.band.unknown : null, resolved: p.ok ? p.entry.seal : null, authentic: p.ok ? p.authentic : null, why: p.ok ? null : p.why, bytes: blob.size, type: blob.type, w: p.width, h: p.height });
    }
    return out;
  })()`);
  console.log(t.id.padEnd(11) + ' ' + reads[t.id].filter((r, i) => r.resolved === cards[i].seal).length + '/64 right');
}
const ua = await evaluate('navigator.userAgent');
ws.close(); chrome.kill(); server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it a moment */ }

// re-derive every outcome in Node with the gated kernel; stop if the page and the kernel ever disagree
const seals = cards.map((c) => c.seal);
for (const t of pre.transforms) reads[t.id].forEach((r, i) => {
  const k = resolveCode(r.read, seals);
  const page = r.resolved, node = k.ok ? k.seal : null;
  if (page !== node) die(t.id + ' card ' + i + ': the page resolved ' + page + ', the kernel ' + node);
  if (sealCode(cards[i].seal) !== cards[i].code) die('card ' + i + ': the page printed a code the kernel would not');
});
writeFileSync(OUT, JSON.stringify({ kind: 'fallkard-forge-survive', v: 1, sealedIn, ranAt: new Date().toISOString(), browser: ua, cards, reads }, null, 1) + '\n');
console.log('wrote data/survive.json — every outcome re-derived by the kernel and agreed');
