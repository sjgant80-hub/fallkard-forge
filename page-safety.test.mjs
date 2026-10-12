// page-safety.test.mjs — the shipped page must never put a card's own text into the page as markup.
//
// Found by the adversarial review (2026-10-12): a card can carry a konomi-artifact bundle, and verifyArtifact's check
// text quotes the bundle's own claims (its tier). The reader appended that text with innerHTML unescaped, so a card
// whose bundle claimed the tier `<img src=x onerror=…>` ran script in the page — measured on the then-live page:
// dropping it ran the payload. These tests pin both halves: the kernel really does quote the bundle (so escaping
// at the page is load-bearing), and the built page escapes every place a card's text can reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyArtifact } from './artifact.mjs';
import { rarity } from './card.mjs';

const PAGE = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const HOSTILE = '<img src=x onerror=alert(1)>';

test('verifyArtifact quotes a bundle\'s own tier in its check text — so the page must escape it', async () => {
  const seal = 'a'.repeat(64);
  const va = await verifyArtifact({ sealComputed: seal, bundle: { tier: HOSTILE, mint: { kpid: 'kcc:x:gen0:aaaaaaaa', fork_sha: seal, parent_kpid: null } },
    verify: async () => false, assessorPass: false, depth: 0, readingKeyHonest: false }, rarity);
  assert.ok(va.checks.some((c) => String(c.why).includes(HOSTILE)), 'the hostile tier reaches the check text verbatim');
});

test('the built page escapes every artifact check before it touches the page', () => {
  assert.ok(PAGE.includes("va.checks.map(c => fact(esc((c.ok ? '\\u2713 ' : '\\u2717 ') + c.name), esc(c.why)))"), 'check name and text are escaped');
  assert.ok(!PAGE.includes('+ c.name, c.why))'), 'the unescaped form is gone');
});

test('the tier chip escapes what it is given', () => {
  assert.ok(PAGE.includes('const tierChip = (t) => `<span class="tier t-${esc(t)}">${esc(t)}</span>`;'));
});

test('text read off a card or a picture is escaped where the reader shows it', () => {
  for (const s of ["fact('tags', esc(manifest.tags)", "fact('forged', esc(manifest.forged))", "fact('why', esc(p.why))",
    "fact('why', esc(whyNoChunks))", "'gone — ' + esc(whyNoChunks)", "fact('printed seal', esc(p.band.read))",
    "fact('tags', esc(r.manifest.tags)", "fact('why', esc(v.reason))", "'<b>' + esc(whole.label) + '</b><div"]) {
    assert.ok(PAGE.includes(s), s);
  }
});

test('decompression is capped, and received cards are judged one at a time with a cap per link', () => {
  assert.ok(PAGE.includes('const MAX_BUILD = 8 * 1024 * 1024;'));
  assert.ok(PAGE.includes("if (n > max) { rd.cancel().catch(() => {}); throw new Error("));
  assert.ok(PAGE.includes('if (whole && ++cards <= TR_MAX_CARDS) queue = queue.then('));
});

test('the proof of key is bound to this link\'s certificates on both sides', () => {
  assert.ok(PAGE.includes('helloText(m.nonce, id.pubB64, tr.peerKey, fp.mine, fp.theirs)'), 'the prover signs its own end first');
  assert.ok(PAGE.includes('helloText(tr.myNonce, tr.peerKey, id.pubB64, fp.theirs, fp.mine)'), 'the verifier expects the prover\'s end first');
});
