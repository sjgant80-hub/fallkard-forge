#!/usr/bin/env node
// scripts/vision.mjs — the paid read: can a vision model read a card's printed seal?
//
//   node scripts/vision.mjs --cards      forge 65 fresh cards with THE PAGE's own forge (headless Chrome) and write each
//                                        one's picture three ways into data/vision/ (+ cards.json with every sha256).
//                                        Card 64 is the plumbing card; cards 0–63 are the test. Refuses to overwrite.
//   node scripts/vision.mjs --seal       write data/vision-prereg.json from the committed cards (refuses to overwrite)
//   node scripts/vision.mjs --check      exit 1 unless the committed pre-registration is exactly what --seal writes
//   node scripts/vision.mjs --plumbing   the one plumbing card → data/vision-plumbing.json
//   node scripts/vision.mjs --run        the 64 cards × 3 pictures → data/vision.json (needs a passed plumbing check)
//
// The paid modes refuse unless the pre-registration is committed and on GitHub, and each runs once. Every picture goes
// ALONE to claude-sonnet-5 through the official claude CLI (the subscription's sanctioned path), with no tools, no MCP,
// from an empty directory outside the user profile — the pipe proven in kar-pixel-cost's read-back. The model is shown
// the picture and one instruction; the code is never in any argument or message. si-didy's purse is asked before every
// call and charged after with the provider's own counts. This script never reads or handles a credential.
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { sealCode } from '../sealmark.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const DIR = join(ROOT, 'data', 'vision'), CARDS = join(DIR, 'cards.json');
const PRE = join(ROOT, 'data', 'vision-prereg.json');
const die = (m) => { console.error(m); process.exit(1); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const has = (f) => process.argv.includes(f);

const CONDITIONS = [
  { id: 'full', label: 'the stripped card, full size (PNG)', type: 'image/png', ext: 'png', scale: 1 },
  { id: 'jpeg60at60', label: 'JPEG 60 at 60% size — a platform copy', type: 'image/jpeg', ext: 'jpg', quality: 0.6, scale: 0.6 },
  { id: 'png35', label: 'PNG at 35% size — where the page\'s pixel reader refused every card', type: 'image/png', ext: 'png', scale: 0.35 },
];
const N = 64, PLUMB = 64, SEED = 20261001;
const SYSTEM = 'You read printed codes from images.';
const INSTRUCTION = 'This picture is a card. Near the bottom it has a printed code of four groups of four characters. Read the code exactly and reply with the code only.';

// ── headless Chrome on the page itself ─────────────────────────────────────────────────────────────────
async function withPage(fn) {
  const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const p = join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
    if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const profile = mkdtempSync(join(tmpdir(), 'vision-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu', 'http://127.0.0.1:' + server.address().port + '/index.html'], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 100 && !wsUrl; i++) {
      const f = join(profile, 'DevToolsActivePort');
      if (existsSync(f)) {
        const [p] = readFileSync(f, 'utf8').split('\n');
        const list = await (await fetch('http://127.0.0.1:' + p + '/json')).json().catch(() => []);
        const page = list.find((t) => t.type === 'page' && t.url.includes('/index.html'));
        if (page) wsUrl = page.webSocketDebuggerUrl;
      }
      if (!wsUrl) await new Promise((r) => setTimeout(r, 200));
    }
    if (!wsUrl) throw new Error('Chrome did not open the page');
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
    let seq = 0; const waiting = new Map();
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
    const evaluate = (expression) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, (m) => (m.error || m.result.exceptionDetails ? no(new Error(JSON.stringify(m.error || m.result.exceptionDetails).slice(0, 400))) : ok(m.result.result.value))); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } })); });
    for (let i = 0; i < 50 && !(await evaluate('!!window.fallkardForge')); i++) await new Promise((r) => setTimeout(r, 200));
    const out = await fn(evaluate);
    ws.close();
    return out;
  } finally {
    chrome.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold it a moment */ }
  }
}

if (has('--cards')) {
  if (existsSync(CARDS)) die('data/vision/cards.json exists — the cards are made once');
  mkdirSync(DIR, { recursive: true });
  const made = await withPage((evaluate) => evaluate(`(async () => {
    const F = window.fallkardForge, C = ${JSON.stringify(CONDITIONS)};
    let s = ${SEED} >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const words = ['amber', 'cedar', 'delta', 'ember', 'fable', 'glyph', 'harbor', 'ivory', 'juniper', 'kestrel', 'lumen', 'meadow', 'nectar', 'orbit', 'prism', 'quartz'];
    const b64 = (u8) => { let t = ''; for (const c of u8) t += String.fromCharCode(c); return btoa(t); };
    const out = [];
    for (let i = 0; i < ${N + 1}; i++) {
      const body = Array.from({ length: 24 }, () => words[Math.floor(rnd() * words.length)]).join(' ');
      const c = await F.forge('<!doctype html><title>vision ' + i + '</title><h1>vision card ' + i + '</h1><p>' + body + '</p>', 'owl:high-left,rose:blue:1');
      const bmp = await createImageBitmap(new Blob([c.png], { type: 'image/png' }));
      const pics = {};
      for (const t of C) {
        const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * t.scale); cv.height = Math.round(bmp.height * t.scale);
        const x = cv.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, cv.width, cv.height);
        const blob = await new Promise((r) => cv.toBlob(r, t.type, t.quality));
        pics[t.id] = { b64: b64(new Uint8Array(await blob.arrayBuffer())), w: cv.width, h: cv.height, type: blob.type };
      }
      out.push({ seal: c.seal, pics });
    }
    return out;
  })()`));
  const cards = made.map((c, i) => {
    const pics = {};
    for (const t of CONDITIONS) {
      const buf = Buffer.from(c.pics[t.id].b64, 'base64');
      if (c.pics[t.id].type !== t.type) die('card ' + i + ' ' + t.id + ': Chrome wrote ' + c.pics[t.id].type);
      const file = 'c' + String(i).padStart(2, '0') + '-' + t.id + '.' + t.ext;
      writeFileSync(join(DIR, file), buf);
      pics[t.id] = { file, sha256: sha(buf), bytes: buf.length, w: c.pics[t.id].w, h: c.pics[t.id].h };
    }
    return { i, seal: c.seal, code: sealCode(c.seal), plumbing: i === PLUMB, pics };
  });
  writeFileSync(CARDS, JSON.stringify({ kind: 'fallkard-forge-vision-cards', v: 1, seed: SEED, conditions: CONDITIONS, cards }, null, 1) + '\n');
  console.log('made ' + cards.length + ' cards (' + N + ' test + 1 plumbing) × ' + CONDITIONS.length + ' pictures in data/vision/');
  process.exit(0);
}

// ── the pre-registration ─────────────────────────────────────────────────────────────────────────────
function prereg() {
  const C = JSON.parse(readFileSync(CARDS, 'utf8'));
  const test = C.cards.filter((c) => !c.plumbing), plumb = C.cards.find((c) => c.plumbing);
  return {
    kind: 'fallkard-forge-vision-prereg', v: 1, written: '2026-09-30',
    statement: 'Sealed, committed and pushed before the first paid call. The printed seal (CARD-SPEC §7.1) was designed so a person, a vision model and a pixel reader can all read it; the survival run measured the pixel reader. This fixes, in advance, the pictures, the model, the words it is given, the grading, the bars, and a prediction. The result is published whichever way it lands.',
    question: 'Shown only a card\'s picture, does a vision model read its printed code back exactly — and can it read where the page\'s own pixel reader could not?',
    approvedBy: 'Simon, relayed verbatim: "yes do the paid run"',
    cards: { n: test.length, seed: C.seed, forge: 'the page\'s own forge in headless Chrome; each code is the first 80 bits of the card\'s seal, printed by the gated sealmark kernel', inputs: { 'data/vision/cards.json': sha(Buffer.from(readFileSync(CARDS, 'utf8').replace(/\r\n/g, '\n'))) } },
    conditions: C.conditions.map(({ id, label, type, scale, quality }) => ({ id, label, type, scale, quality: quality ?? null })),
    pictures: Object.fromEntries(test.flatMap((c) => C.conditions.map((t) => [c.pics[t.id].file, c.pics[t.id].sha256]))),
    call: {
      model: 'claude-sonnet-5',
      route: 'the official claude CLI, one process per picture, from a fresh empty directory under C:\\tmp (outside the user profile, so no CLAUDE.md is loaded) — the pipe proven and amended in kar-pixel-cost\'s read-back',
      args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5', '--system-prompt', '<system>', '--tools', '', '--setting-sources', 'project', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', '--no-chrome', '--max-budget-usd', '0.05'],
      system: SYSTEM, instruction: INSTRUCTION,
      content: ['image: the committed picture, base64, its own media type', 'text: the instruction'],
      sampling: 'the CLI default (adaptive thinking, high effort); temperature is not settable on this path, so each picture is read once and that read is graded',
      order: 'condition by condition — every full-size picture, then every platform copy, then every 35% copy — each in card order',
    },
    blind: 'The model is given the system line, one picture and the instruction — nothing else. The code never appears in any argument or message, the file name is never sent, there are no tools and no MCP servers, and the working directory is empty. Each call\'s own init event (tools, MCP servers, credential source) is recorded as the receipt.',
    plumbing: { card: plumb.i, picture: plumb.pics.full.file, sha256: plumb.pics.full.sha256, why: 'one extra card, not among the 64, goes through the identical path first to prove the pipe', passIf: ['the call succeeds', 'no tools and no MCP servers', 'only claude-sonnet-5 is used', 'no cache write', 'at most 1,000 input tokens — nothing but the system line, one picture and the instruction went in'], ifItFails: 'no test picture is sent; the pipe is fixed, amended here with the reason, pushed, and the plumbing check re-run on the same card', counted: 'its tokens are in the reported spend' },
    grading: {
      by: 'vision.mjs, deterministically, against the committed codes — no model judges a model',
      extract: 'extractCode: the last run of four groups of four joined by hyphens or dashes, as printed; failing that, the run with any separators that ends last; failing that, the whole reply trimmed',
      exact: 'normalizeCode(extracted) equals the card\'s code — read as the spec reads a code: case-blind, O→0, I and L→1',
      printed: 'also reported: the extracted text equal to the code exactly as printed, letter for letter',
      resolve: 'resolveCode(extracted, the 64 seals) with its defaults (≤3 edits, margin 3, ≤4 unreadable) → right card, wrong card, or refused',
      missing: 'a call that did not answer is graded as no reply: not exact, refused',
    },
    rules: [
      { id: 'full-exact', rule: 'at least 60 of the 64 full-size cards are read exactly' },
      { id: 'full-right', rule: 'all 64 full-size cards resolve to the right card' },
      { id: 'platform-right', rule: 'all 64 platform copies (JPEG 60 at 60%) resolve to the right card' },
      { id: 'never-wrong', rule: 'across all 192 reads, not one resolves to the wrong card' },
      { id: 'third-size', rule: 'at 35% size — where the pixel reader refused all 64 — at least half resolve to the right card' },
    ],
    verdict: 'judgeVision(tallyVision(...)) in vision.mjs applies exactly these five',
    purse: { module: 'si-didy/purse.mjs', how: 'mayCall before each call, charged after with the provider\'s own counts (all input kinds + output)', run: { calls: N * C.conditions.length, tokens: 400000 }, plumbing: { calls: 1, tokens: 3000 } },
    spend: 'the provider\'s own counts from each call\'s result, priced by kind with vision.mjs spend(): fresh input and output at the claude-sonnet-5 list price locked in prices.lock.json, cache writes and reads at the multiples below, then the locked pound rate. The CLI\'s own cost figure is recorded, not used (it prices this model at a rise the pricing page says will not happen). Which credential paid is recorded from each call\'s init event.',
    cacheMultiples: { write5m: 1.25, write1h: 2, read: 0.1, of: 'the base input price', source: 'https://platform.claude.com/docs/en/about-claude/pricing', checked: '2026-09-30' },
    predictions: {
      said: 'before the run, by Kar',
      'full-exact': 'pass — the band is big and plain; I expect 62 or more exact',
      'full-right': 'pass',
      'platform-right': 'pass',
      'never-wrong': 'pass',
      'third-size': 'FAIL — at 35% each letter is about 5×7 pixels; I expect a model to guess letters rather than refuse, and most reads to land too far from any card',
    },
  };
}
const stable = (o) => JSON.stringify(o, null, 1) + '\n';
if (has('--seal')) {
  if (existsSync(PRE)) die('data/vision-prereg.json exists — it is sealed');
  if (!existsSync(CARDS)) die('make the cards first: --cards');
  writeFileSync(PRE, stable(prereg()));
  console.log('sealed data/vision-prereg.json · sha256 ' + sha(Buffer.from(stable(prereg()))));
  process.exit(0);
}
if (has('--check')) {
  const same = existsSync(PRE) && existsSync(CARDS) && readFileSync(PRE, 'utf8').replace(/\r\n/g, '\n') === stable(prereg());
  console.log(same ? 'the vision pre-registration matches its cards' : 'data/vision-prereg.json differs from what --seal writes');
  process.exit(same ? 0 : 1);
}
if (!has('--plumbing') && !has('--run')) die('usage: node scripts/vision.mjs --cards | --seal | --check | --plumbing | --run');

// ── the paid read ────────────────────────────────────────────────────────────────────────────────────
const PLUMBING = has('--plumbing');
const OUT = join(ROOT, 'data', PLUMBING ? 'vision-plumbing.json' : 'vision.json');
if (existsSync(OUT)) die(OUT.split(/[\\/]/).pop() + ' exists — it runs once');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', 'data/vision-prereg.json', 'data/vision', 'scripts/vision.mjs', 'vision.mjs', 'sealmark.mjs')) die('commit the pre-registration, the cards, this script and the kernels first');
git('fetch', '-q', 'origin');
try { git('merge-base', '--is-ancestor', 'HEAD', 'origin/main'); } catch { die('push first — HEAD is not on origin/main'); }
const pre = JSON.parse(readFileSync(PRE, 'utf8'));
if (stable(pre) !== stable(prereg())) die('the committed pre-registration is not what this script seals');
const sealedIn = git('log', '-1', '--format=%H', '--', 'data/vision-prereg.json');
const C = JSON.parse(readFileSync(CARDS, 'utf8'));

let jobs;
if (PLUMBING) jobs = [{ card: pre.plumbing.card, condition: 'full', file: pre.plumbing.picture, sha256: pre.plumbing.sha256 }];
else {
  if (!existsSync(join(ROOT, 'data', 'vision-plumbing.json'))) die('run the plumbing check first: --plumbing');
  if (!JSON.parse(readFileSync(join(ROOT, 'data', 'vision-plumbing.json'), 'utf8')).pass) die('the plumbing check did not pass — fix the pipe and amend first');
  const test = C.cards.filter((c) => !c.plumbing);
  jobs = pre.conditions.flatMap((t) => test.map((c) => ({ card: c.i, condition: t.id, file: c.pics[t.id].file, sha256: pre.pictures[c.pics[t.id].file] })));
}

const cap = PLUMBING ? pre.purse.plumbing : pre.purse.run;
process.env.SOUL_MAX_CALLS = String(cap.calls);
process.env.SOUL_MAX_TOKENS = String(cap.tokens);
const { openPurse, mayCall, charged, state, proves } = await import(pathToFileURL(process.env.PURSE_MODULE || join(homedir(), 'si-didy', 'purse.mjs')).href);
const purse = await openPurse();

const CLI = (() => {
  const npm = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : join(homedir(), '.npm-global');
  for (const p of [join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'), join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'), join(homedir(), '.local', 'bin', 'claude')]) if (existsSync(p)) return p;
  return null;
})();
if (!CLI) die('the claude CLI binary was not found');
const CALL_ROOT = process.platform === 'win32' ? 'C:\\tmp' : '/tmp';
if (resolve(CALL_ROOT).toLowerCase().startsWith(resolve(homedir()).toLowerCase())) die('the call directory must sit outside the user profile');
for (let d = resolve(CALL_ROOT); ; d = resolve(d, '..')) {
  for (const f of ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md'), 'AGENTS.md']) if (existsSync(join(d, f))) die('an instruction file sits above the call directory: ' + join(d, f));
  if (resolve(d, '..') === d) break;
}
const args = pre.call.args.map((a) => (a === '<system>' ? pre.call.system : a));
const MEDIA = { png: 'image/png', jpg: 'image/jpeg' };

function readOne(buf, mediaType) {
  return new Promise((done) => {
    const cwd = mkdtempSync(join(CALL_ROOT, 'kard-vision-'));
    const child = spawn(CLI, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '', init = null, result = null;
    const timer = setTimeout(() => child.kill(), 240000);
    child.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1);
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') init = ev;
        else if (ev.type === 'result') { result = ev; child.stdin.end(); }
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => { clearTimeout(timer); try { rmSync(cwd, { recursive: true, force: true }); } catch {} done({ code, init, result, stderr: err.slice(0, 300) }); });
    child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: buf.toString('base64') } },
      { type: 'text', text: pre.call.instruction },
    ] } }) + '\n');
  });
}

const rows = [];
for (const j of jobs) {
  const buf = readFileSync(join(DIR, j.file));
  if (sha(buf) !== j.sha256) die(j.file + ' is not the sealed picture');
  const may = await mayCall(purse, 'subscription-cli');
  if (!may.ok) { console.error('the purse refused: ' + may.why); rows.push({ ...j, reply: null, refusedByPurse: may.why }); continue; }
  const r = await readOne(buf, MEDIA[j.file.split('.').pop()]);
  const res = r.result || {}, u = res.usage || {}, cc = u.cache_creation || {};
  const usage = { input_tokens: u.input_tokens || 0, cache_write_5m: cc.ephemeral_5m_input_tokens || 0, cache_write_1h: cc.ephemeral_1h_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, output_tokens: u.output_tokens || 0 };
  if ((u.cache_creation_input_tokens || 0) !== usage.cache_write_5m + usage.cache_write_1h) die('a cache write is not split into 5m and 1h');
  if (r.result) await charged(purse, { input_tokens: usage.input_tokens + usage.cache_write_5m + usage.cache_write_1h + usage.cache_read, output_tokens: usage.output_tokens });
  const ok = !!r.result && !res.is_error;
  rows.push({ ...j, ok, reply: ok && typeof res.result === 'string' ? res.result : null, usage, modelUsage: res.modelUsage || null, cliCostUsd: res.total_cost_usd ?? null, ms: res.duration_ms ?? null,
    init: r.init ? { model: r.init.model, tools: r.init.tools, mcp_servers: r.init.mcp_servers, apiKeySource: r.init.apiKeySource, version: r.init.claude_code_version || null } : null,
    receipt: (await proves(purse, purse.receipts.length - 1)).ok, error: ok ? null : (res.subtype || 'no result') + (r.stderr ? ' · ' + r.stderr : '') });
  console.log(String(rows.length).padStart(4) + '/' + jobs.length + '  ' + j.file.padEnd(22) + (ok ? ' in ' + (usage.input_tokens + usage.cache_write_5m + usage.cache_write_1h + usage.cache_read) + ' out ' + usage.output_tokens : ' FAILED'));
}
const st = state(purse);
const doc = { kind: PLUMBING ? 'fallkard-forge-vision-plumbing' : 'fallkard-forge-vision', v: 1, sealedIn, ranAt: new Date().toISOString(), purse: { line: st.line, calls: st.calls, tokens: st.tokens, refused: st.refused, lastRefusal: st.lastRefusal }, rows };
if (PLUMBING) {
  const r = rows[0], models = r.modelUsage ? Object.keys(r.modelUsage) : [];
  const input = r.usage ? r.usage.input_tokens + r.usage.cache_write_5m + r.usage.cache_write_1h + r.usage.cache_read : Infinity;
  const checks = [
    ['the call succeeds', !!r.ok],
    ['no tools and no MCP servers', !!r.init && Array.isArray(r.init.tools) && r.init.tools.length === 0 && Array.isArray(r.init.mcp_servers) && r.init.mcp_servers.length === 0],
    ['only claude-sonnet-5 was used', models.length > 0 && models.every((m) => m.startsWith('claude-sonnet-5'))],
    ['no cache write', !!r.usage && r.usage.cache_write_5m + r.usage.cache_write_1h === 0],
    ['at most 1,000 input tokens (' + input + ')', input <= 1000],
  ];
  doc.checks = checks.map(([what, pass]) => ({ what, pass }));
  doc.pass = checks.every(([, p]) => p);
  for (const [what, pass] of checks) console.log((pass ? '  ✓ ' : '  ✗ ') + what);
}
writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
console.log((PLUMBING ? 'plumbing ' + (doc.pass ? 'PASSED' : 'FAILED') : 'read ' + rows.filter((r) => r.ok).length + ' of ' + jobs.length + ' pictures') + ' · ' + st.line);
