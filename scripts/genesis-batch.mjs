#!/usr/bin/env node
// Forge Genesis cards n=--from..--to in one run, then re-read EVERY card from disk and re-check it
// (seal, Ed25519 signature, edition in build == manifest, claim gate). Writes cards/, index.json and a receipt.
// usage: node scripts/genesis-batch.mjs --from 1 --to 1000 --key identity.json --out dir [--decoder reader.html] [--forged YYYY-MM-DD]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadIdentity, sha256 } from '../forge.mjs';
import { forgeGenesis, readGenesis, stampEdition, sealOf, pad } from '../genesis.mjs';
import { renderCard } from '../art.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const from = Number(arg('--from', 1)), to = Number(arg('--to', 1000));
const out = arg('--out'), keyPath = arg('--key'), decoder = arg('--decoder'), forged = arg('--forged');
if (!out || !keyPath) { console.error('usage: --from n --to m --key identity.json --out dir [--decoder reader.html]'); process.exit(2); }
const id = loadIdentity(keyPath);
const template = readFileSync(join(here, '..', 'genesis', 'card.template.html'), 'utf8');
const CLAIMS = ['re-run it yourself', 'Ed25519 seal', 'the gate', 'verified patterns', 'germination', 'runs on your device', 'no central host'];
mkdirSync(join(out, 'cards'), { recursive: true });

const t0 = Date.now(), index = {}, results = [];
for (let n = from; n <= to; n++) {
  const isDecoder = n === 1 && decoder;
  const base = isDecoder ? readFileSync(decoder, 'utf8') : template;
  const tags = isDecoder ? 'genesis,decoder' : 'genesis';
  const seal = sealOf(stampEdition(base, n));
  const image = renderCard({ tags, seal });
  const { png, manifest } = forgeGenesis({ n, build: base, claims: CLAIMS, image, tags, forged, sign: id.sign, signer: id.pubB64 });
  if (manifest.seal !== seal) throw new Error(`seal drift on ${n}`);
  const file = join(out, 'cards', `genesis-${pad(n)}.png`);
  writeFileSync(file, png);
  const r = readGenesis(readFileSync(file));           // re-check from the bytes on disk
  results.push({ n, file: `cards/genesis-${pad(n)}.png`, seal, png_sha256: sha256(png), verdict: r.ok ? 'AUTHENTIC' : r.reason, tier: r.earnedTier });
  index[pad(n)] = seal;
}
const authentic = results.filter((x) => x.verdict === 'AUTHENTIC').length;
const indexJson = JSON.stringify(index, null, 1);
writeFileSync(join(out, 'index.json'), indexJson);
const receipt = { what: 'genesis batch forge + per-card re-check', from, to, count: results.length, authentic,
  refused: results.length - authentic, signer: id.pubB64, index_sha256: sha256(Buffer.from(indexJson)),
  node: process.version, ms: Date.now() - t0, at: new Date().toISOString(), cards: results };
writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 1));
console.log(`forged ${results.length}, re-checked AUTHENTIC ${authentic}, refused ${results.length - authentic}, index ${receipt.index_sha256}`);
process.exit(authentic === results.length ? 0 : 1);
