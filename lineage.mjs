#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// lineage.mjs · provenance depth walk + earned rarity  (CARD-SPEC §5)
//
// Rarity is EARNED and VERIFIABLE, never manufactured. A card can *claim* any tier it likes in
// its manifest; this walks the actual card graph and computes what the deck can PROVE.
//
//   depth 0  a root card (parent: null)
//   depth n  parent present in the deck, at depth n-1
//   orphan   parent declared but NOT present — depth is UNPROVABLE, so it does not count
//   cycle    a card reachable from itself — no depth, flagged
//
// The point: an unprovable ancestor buys nothing. If you cannot show the chain, you do not have
// the depth. Any card whose claimed tier exceeds its provable tier is reported as an OVERCLAIM —
// the anti-polonium check at the provenance layer (a card that says one thing and is another).
//
// Note on `holo`: it additionally requires an honest reading-key match — whether the picture
// truly describes the payload. That is a fluency judgement a machine cannot make, so this tool
// will never *award* holo. It can only confirm the mechanical half (assessor_pass + depth >= 3)
// and report the card as holo-ELIGIBLE, pending human attestation.
// ════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { read, rarity } from './forge.mjs';

// ── load every card in a directory into a seal-indexed deck ────────────────
export function loadDeck(dir) {
  const cards = new Map();     // seal → entry
  const unreadable = [];
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    const file = join(dir, name);
    if (!statSync(file).isFile()) continue;
    let r;
    try { r = read(readFileSync(file)); }
    catch (err) { unreadable.push({ name, reason: String(err.message || err) }); continue; }
    if (!r.manifest) { unreadable.push({ name, reason: r.reason }); continue; }
    // a card whose seal does not verify is not admissible provenance
    cards.set(r.manifest.seal, {
      name, file,
      manifest: r.manifest,
      sealOk: r.ok,
      parent: r.manifest.parent || null,
    });
  }
  return { cards, unreadable };
}

// ── walk each card to its root, proving depth ─────────────────────────────
// Returns the same entries annotated with { depth, status, chain }.
// status: 'root' | 'linked' | 'orphan' | 'cycle' | 'broken-seal'
export function walkDepths(cards) {
  const memo = new Map();

  function resolve(seal, seen) {
    if (memo.has(seal)) return memo.get(seal);
    const entry = cards.get(seal);
    if (!entry) return { depth: null, status: 'missing', chain: [] };

    if (seen.has(seal)) return { depth: null, status: 'cycle', chain: [...seen] };
    seen.add(seal);

    let out;
    if (!entry.parent) {
      out = { depth: 0, status: 'root', chain: [seal] };
    } else if (!cards.has(entry.parent)) {
      // the ancestor is asserted but absent — the chain cannot be shown, so it does not count
      out = { depth: 0, status: 'orphan', chain: [seal] };
    } else {
      const up = resolve(entry.parent, seen);
      out = up.status === 'cycle'
        ? { depth: null, status: 'cycle', chain: up.chain }
        : { depth: up.depth + 1, status: 'linked', chain: [seal, ...up.chain] };
    }

    seen.delete(seal);
    memo.set(seal, out);
    return out;
  }

  const walked = new Map();
  for (const [seal, entry] of cards) {
    const r = resolve(seal, new Set());
    walked.set(seal, {
      ...entry,
      depth: r.depth,
      status: entry.sealOk ? r.status : 'broken-seal',
      chain: r.chain,
    });
  }
  return walked;
}

// ── what the deck can prove, vs what each card claims ─────────────────────
const TIER_ORDER = ['common', 'uncommon', 'rare', 'holo'];
const tierIndex = (t) => { const i = TIER_ORDER.indexOf(String(t)); return i < 0 ? 0 : i; };

export function auditDeck(dir) {
  const { cards, unreadable } = loadDeck(dir);
  const walked = walkDepths(cards);

  const rows = [];
  for (const [seal, e] of walked) {
    const provable = e.status === 'broken-seal' || e.status === 'cycle'
      ? 'common'                                    // unprovable provenance earns nothing
      : rarity({ assessorPass: !!e.manifest.assessor_pass, depth: e.depth || 0, readingKeyHonest: false });

    // holo needs a human fluency attestation this tool cannot make — report eligibility only
    const holoEligible = !!e.manifest.assessor_pass && (e.depth || 0) >= 3
      && e.status !== 'broken-seal' && e.status !== 'cycle';

    const claimed = e.manifest.rarity || 'common';
    rows.push({
      name: e.name, seal, depth: e.depth, status: e.status,
      claimed, provable, holoEligible,
      overclaim: tierIndex(claimed) > tierIndex(provable) && !(claimed === 'holo' && holoEligible),
      chainLength: e.chain.length,
    });
  }

  rows.sort((a, b) => (b.depth ?? -1) - (a.depth ?? -1) || a.name.localeCompare(b.name));
  return {
    rows,
    unreadable,
    overclaims: rows.filter(r => r.overclaim),
    orphans: rows.filter(r => r.status === 'orphan'),
    cycles: rows.filter(r => r.status === 'cycle'),
    broken: rows.filter(r => r.status === 'broken-seal'),
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────
function cli(argv) {
  const dir = argv[3] || 'examples';
  if (argv[2] !== 'audit') {
    console.error('fallkard lineage · usage: node lineage.mjs audit <deck-dir>');
    process.exit(2);
  }
  const a = auditDeck(dir);
  console.log(`deck: ${dir} · ${a.rows.length} card(s)\n`);
  console.log('  depth  status       claimed    provable   card');
  console.log('  ─────  ───────────  ─────────  ─────────  ────────────────────');
  for (const r of a.rows) {
    const flag = r.overclaim ? '  ← OVERCLAIM' : (r.holoEligible ? '  ← holo-eligible (needs attestation)' : '');
    console.log(`  ${String(r.depth ?? '?').padEnd(5)}  ${r.status.padEnd(11)}  ${r.claimed.padEnd(9)}  ${r.provable.padEnd(9)}  ${r.name}${flag}`);
  }
  for (const u of a.unreadable) console.log(`  ­      unreadable   —          —          ${u.name}  (${u.reason})`);

  console.log('');
  if (a.overclaims.length) console.log(`  ✗ ${a.overclaims.length} overclaim(s) — a card claims a tier the deck cannot prove`);
  if (a.orphans.length)    console.log(`  · ${a.orphans.length} orphan(s) — parent asserted but absent; depth does not count`);
  if (a.cycles.length)     console.log(`  ✗ ${a.cycles.length} cycle(s) — card reachable from itself`);
  if (a.broken.length)     console.log(`  ✗ ${a.broken.length} broken seal(s) — not admissible provenance`);
  if (!a.overclaims.length && !a.cycles.length && !a.broken.length) console.log('  ✓ every claimed tier is backed by the deck');

  process.exit(a.overclaims.length || a.cycles.length || a.broken.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) cli(process.argv);
