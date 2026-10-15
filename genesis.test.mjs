import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeIdentity, read } from './forge.mjs';
import { claimGate, forgeGenesis, readGenesis, editionInBuild, stampEdition, sealOf } from './genesis.mjs';
import { renderCard } from './art.mjs';

const id = makeIdentity();
const build = readFileSync(new URL('./genesis/card.template.html', import.meta.url), 'utf8');
const CLAIMS = ['re-run it yourself', 'Ed25519 seal', 'germination'];
const mk = (n, o = {}) => forgeGenesis({ n, build, claims: CLAIMS, image: renderCard({ tags: 'genesis', seal: sealOf(stampEdition(build, n)) }), tags: 'genesis', sign: id.sign, signer: id.pubB64, ...o });

test('claim gate: allowed claims pass, forbidden ones are caught', () => {
  assert.equal(claimGate('re-run it yourself; Ed25519 seal; runs on your device').ok, true);
  for (const bad of ['a self-aware agent', 'Ψ score', 'it is conscious', 'the card is alive', 'measured self-improvement', 'watch it climb'])
    assert.equal(claimGate(bad).ok, false, bad);
});

test('forge refuses forbidden claims in claims or build, and requires "re-run it yourself"', () => {
  assert.throws(() => mk(5, { claims: ['re-run it yourself', 'self-aware'] }), /claim gate refused claims/);
  assert.throws(() => mk(5, { build: build.replace('</body>', 'It is alive.</body>') }), /claim gate refused build/);
  assert.throws(() => mk(5, { claims: ['Ed25519 seal'] }), /re-run it yourself/);
  assert.throws(() => mk(5, { sign: undefined, signer: undefined }), /signed/);
  assert.throws(() => mk(0)); assert.throws(() => mk(1001));
});

test('a genesis card re-checks AUTHENTIC, with the edition in both seal and signature', () => {
  const { png, manifest } = mk(42);
  const r = readGenesis(png);
  assert.equal(r.ok, true); assert.equal(r.edition, 42);
  assert.deepEqual(manifest.edition, { series: 'genesis', no: 42, of: 1000 });
  assert.equal(editionInBuild(r.hatch()), 42);
  assert.equal(read(png).ok, true); // still a normal card to the plain reader
});

test('changing the edition number in the manifest breaks the signature', () => {
  const { png } = mk(7);
  const s = png.toString('latin1').replace('"no":7', '"no":8');
  const r = readGenesis(Buffer.from(s, 'latin1'));
  assert.equal(r.ok, false);
});

test('forge extra cannot override core or tier fields', async () => {
  const { forge } = await import('./forge.mjs');
  for (const k of ['rarity', 'seal', 'signer', 'assessor_pass'])
    assert.throws(() => forge({ build: '<p>x</p>', image: renderCard({ tags: '', seal: '' }), extra: { [k]: 'x' } }), /extra may not set/);
});
