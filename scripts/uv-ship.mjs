#!/usr/bin/env node
// scripts/uv-ship.mjs — shipping the creatures' discovery into the card format: read rule 0.2 reads U as V.
//   node scripts/uv-ship.mjs --seal    write data/uv-prereg.json (refuses to overwrite) — commit and push it first
//   node scripts/uv-ship.mjs --check   exit 1 unless the committed pre-registration is exactly what --seal writes
//   node scripts/uv-ship.mjs --run     refuses unless the seal is committed and on GitHub; measures once; writes
//                                      data/uv-run.json
//   node scripts/uv-ship.mjs --verify  re-measures and exits 1 unless it matches data/uv-run.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { compareRules, judgeUV, tallySurvival } from '../sealmark.mjs';
import { extractCode } from '../vision.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PRE = join(ROOT, 'data', 'uv-prereg.json'), OUT = join(ROOT, 'data', 'uv-run.json');
const text = (f) => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const die = (m) => { console.error(m); process.exit(1); };
const has = (f) => process.argv.includes(f);
const SEALED = ['sealmark.mjs', 'vision.mjs', 'data/vision.json', 'data/vision/cards.json', 'data/survive.json', 'data/survive-prereg.json'];

// the files as they stood in a commit — once measured, the seal is checked against the commit that sealed it, so
// the kernels may go on improving without un-sealing a result that was measured before they did
const atCommit = (c) => (f) => execFileSync('git', ['-C', ROOT, 'show', c + ':' + f], { encoding: 'utf8', maxBuffer: 1 << 28 }).replace(/\r\n/g, '\n');

function prereg(read = text) {
  return {
    kind: 'fallkard-forge-uv-prereg', v: 1, written: '2026-09-30',
    approvedBy: 'Simon, relayed verbatim: "yes go kar ship it into the card format lfg"',
    statement: 'Sealed, committed and pushed before the change is measured. The first thing the creatures\' game ships to production: CARD-SPEC §7.1 read rule 0.2 reads U as V. The result is published whichever way it lands.',
    credit: {
      found: 'by the creatures of kard-evolve (https://sjgant80-hub.github.io/kard-evolve/): the sealed evolution\'s champion UV|515 carried U → V from generation 14, found by mutation and selection with nothing telling it to look (seal a1f6c43, record sha256 4529a418c273d6d602813c5f36b11d9993c7f275032cf592a6618524fa11df9b)',
      again: 'and by the self-observing creature (https://sjgant80-hub.github.io/kard-evolve/observer.html): with no answer key it looked at its own refused reads, suspected U and chose U → V at generation 1 (median over 8 seeds; seal 44f55ce)',
      from: 'the misreads it learned from are this repository\'s own sealed paid read (data/vision.json)',
    },
    change: {
      rule: 'normalizeCode(text, rule): rule 0.1 as before (case-blind, O→0, I and L→1); rule 0.2 also U→V. U is in no code, and V is the symbol the model saw as U every time.',
      where: 'the live reader and the new "type the code" path use rule 0.2. The survival run and the paid read, sealed under 0.1, stay graded under 0.1.',
    },
    sealed: Object.fromEntries(SEALED.map((f) => [f, sha(read(f))])),
    measured: {
      recorded: 'all 192 recorded replies of the paid read (full size, platform copy, 35%), each reply\'s code extracted as the paid read did, resolved against its 64 cards under 0.1 and under 0.2',
      uReads: 'the recorded replies whose code holds a U',
      pixels: 'all 768 pixel reads of the survival run (64 cards × 12 kinds of damage), resolved against their deck under 0.1 and under 0.2',
      everyV: 'every one of the paid read\'s 64 cards whose code holds a V, written with every V as U',
    },
    rules: [
      { id: 'fixes-the-seven', rule: 'every recorded reply that holds a U resolves to the right card under 0.2, and none did under 0.1' },
      { id: 'breaks-nothing', rule: 'no recorded reply and no pixel read that resolved to the right card under 0.1 resolves otherwise under 0.2, and no exact read stops being exact' },
      { id: 'never-wrong', rule: 'under 0.2, not one of the 192 recorded replies or 768 pixel reads names a wrong card' },
      { id: 'pixels-unchanged', rule: 'the survival run\'s tally under 0.2 is identical, row for row, to its tally under 0.1' },
      { id: 'every-v-as-u', rule: 'every V-card written with every V as U resolves to the right card under 0.2, and none did under 0.1' },
    ],
    predictions: {
      said: 'before measuring, by Kar',
      'fixes-the-seven': 'pass — 7 of 7; the 35% copies go from 57 to 64 right',
      'breaks-nothing': 'pass — a U was never a symbol, so a read with one was never right before',
      'never-wrong': 'pass',
      'pixels-unchanged': 'pass — the pixel reader never outputs a U',
      'every-v-as-u': 'pass',
    },
  };
}

function measure() {
  const vision = JSON.parse(text('data/vision.json')), cards = JSON.parse(text('data/vision/cards.json')).cards.filter((c) => !c.plumbing);
  const seals = cards.map((c) => c.seal), pos = Object.fromEntries(cards.map((c, i) => [c.i, i]));
  const recordedReads = vision.rows.map((r) => ({ read: extractCode(r.reply) || '', card: pos[r.card], condition: r.condition }));
  const survive = JSON.parse(text('data/survive.json')), spre = JSON.parse(text('data/survive-prereg.json'));
  const sseals = survive.cards.map((c) => c.seal);
  const pixelReads = spre.transforms.flatMap((t) => survive.reads[t.id].map((r, i) => ({ read: r.read || '', card: i })));
  const everyVReads = cards.map((c, i) => ({ read: c.code.replace(/V/g, 'U'), card: i })).filter((r) => r.read.includes('U'));
  const strip = (reads) => reads.map(({ read, card }) => ({ read, card }));
  const parts = {
    recorded: compareRules(strip(recordedReads), seals, '0.1', '0.2'),
    uReads: compareRules(strip(recordedReads.filter((r) => /u/i.test(r.read))), seals, '0.1', '0.2'),
    pixels: compareRules(pixelReads, sseals, '0.1', '0.2'),
    everyV: compareRules(everyVReads, seals, '0.1', '0.2'),
    survivalBefore: tallySurvival(sseals, survive.reads, spre.transforms, '0.1'),
    survivalAfter: tallySurvival(sseals, survive.reads, spre.transforms, '0.2'),
  };
  const byCondition = Object.fromEntries(['full', 'jpeg60at60', 'png35'].map((c) => [c, compareRules(strip(recordedReads.filter((r) => r.condition === c)), seals, '0.1', '0.2')]));
  const fixed = parts.uReads.fixed.map((i) => recordedReads.filter((r) => /u/i.test(r.read))[i]).map((r) => ({ card: r.card, condition: r.condition, read: r.read, code: cards[r.card].code }));
  return { parts, byCondition, fixed, judged: judgeUV(parts) };
}

const stable = (o) => JSON.stringify(o, null, 1) + '\n';
if (has('--seal')) {
  if (existsSync(PRE)) die('data/uv-prereg.json exists — it is sealed');
  writeFileSync(PRE, stable(prereg()));
  console.log('sealed data/uv-prereg.json · sha256 ' + sha(stable(prereg())));
  process.exit(0);
}
if (!existsSync(PRE)) die('not sealed yet — node scripts/uv-ship.mjs --seal');
const sealedIn = existsSync(OUT) ? JSON.parse(text('data/uv-run.json')).sealedIn : null;
if (has('--check')) {
  // before the run: the seal is what the working files give. After it: the seal is what the files gave in the commit
  // that sealed it, and the seal itself was not touched after that commit.
  const same = text('data/uv-prereg.json') === stable(prereg(sealedIn ? atCommit(sealedIn) : text))
    && (!sealedIn || atCommit(sealedIn)('data/uv-prereg.json') === text('data/uv-prereg.json'));
  console.log(same ? 'the U→V pre-registration matches its inputs' + (sealedIn ? ' as sealed in ' + sealedIn.slice(0, 7) : '') : 'data/uv-prereg.json differs from what its inputs give');
  process.exit(same ? 0 : 1);
}
const pre = JSON.parse(text('data/uv-prereg.json'));
if (has('--verify')) {
  if (!sealedIn) die('no data/uv-run.json to verify');
  // the measured data must be the data that was sealed; the kernels are today's, so this also proves they still agree
  const moved = SEALED.filter((f) => f.startsWith('data/') && sha(text(f)) !== pre.sealed[f]);
  if (moved.length) die('the sealed data changed since the seal: ' + moved.join(', '));
  const same = JSON.stringify(measure()) === JSON.stringify(JSON.parse(text('data/uv-run.json')).result);
  console.log(same ? 'REPRODUCED — the U→V measurement re-runs to its committed result' : 'NOT REPRODUCED');
  process.exit(same ? 0 : 1);
}
if (!has('--run')) die('usage: node scripts/uv-ship.mjs --seal | --check | --run | --verify');
if (sealedIn) die('data/uv-run.json exists — it is measured once');
if (stable(pre) !== stable(prereg())) die('the committed pre-registration is not what this script seals from these files');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain', 'data/uv-prereg.json', 'scripts/uv-ship.mjs', ...SEALED)) die('commit the seal, this script and the sealed files first');
git('fetch', '-q', 'origin');
try { git('merge-base', '--is-ancestor', 'HEAD', 'origin/main'); } catch { die('push first — HEAD is not on origin/main'); }
const sealCommit = git('log', '-1', '--format=%H', '--', 'data/uv-prereg.json');
const result = measure();
writeFileSync(OUT, stable({ kind: 'fallkard-forge-uv-run', v: 1, sealedIn: sealCommit, ranAt: new Date().toISOString(), result }));
console.log('measured · ' + result.judged.passed + ' of ' + result.judged.of + ' rules');
