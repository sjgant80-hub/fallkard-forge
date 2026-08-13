// card.test.mjs — PROOF-OF-PLAY for the card that carries a real build.
import {
  crc32, parseChunks, makeChunk, serialise, textChunk, readText,
  rarity, manifestFor, embed, read, concat, bytes, latin1,
  PNG_SIG, PAYLOAD_KEYWORD, MANIFEST_KEYWORD,
} from './card.mjs';
import { rarity as nodeRarity } from './forge.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); };

// The smallest thing that is legally a PNG for our purposes: signature, an IHDR, an IEND.
const plainPng = () => serialise([
  { type: 'IHDR', data: new Uint8Array(13) },
  { type: 'IEND', data: new Uint8Array(0) },
]);

console.log('\n=== §1 · it really is a PNG ===');
{
  const p = plainPng();
  for (let i = 0; i < 8; i++) ok(p[i] === PNG_SIG[i], i === 0 ? 'the signature is the PNG signature' : true);
  pass -= 7; // the loop above is one assertion, not eight
  const cs = parseChunks(p);
  ok(cs.length === 2 && cs[0].type === 'IHDR' && cs[1].type === 'IEND', 'a round trip gives back the chunks it was given');

  let threw = null;
  try { parseChunks(bytes('not a png at all')); } catch (e) { threw = e.message; }
  ok(/bad signature/.test(String(threw)), 'something that is not a PNG is refused by signature');
  threw = null;
  try { parseChunks(new Uint8Array(3)); } catch (e) { threw = e.message; }
  ok(/too short/.test(String(threw)), 'and so is a file too short to have one');
}

console.log('\n=== §2 · ⚑ A TRUNCATED CARD IS REFUSED, NOT PARTLY READ ===');
{
  const full = plainPng();
  let threw = null;
  try { parseChunks(full.subarray(0, full.length - 4)); } catch (e) { threw = e.message; }
  ok(/truncated/.test(String(threw)),
     '⚑ a card cut short THROWS — returning "what we managed to read" is how a corrupt card passes as real');

  const noEnd = serialise([{ type: 'IHDR', data: new Uint8Array(13) }]);
  threw = null;
  try { parseChunks(noEnd); } catch (e) { threw = e.message; }
  ok(/no IEND/.test(String(threw)), 'and so is one with no end marker at all');
}

console.log('\n=== §3 · the checksum is a real CRC32 ===');
{
  // Known-good vector: CRC32 of "123456789" is 0xCBF43926. If this drifts, every chunk this kernel
  // writes is rejected by every real PNG decoder, and the card silently stops being a picture.
  ok(crc32(bytes('123456789')) === 0xCBF43926, '⚑ matches the standard CRC32 test vector');
  ok(crc32(bytes('')) === 0, 'the empty string checksums to zero');
  ok(crc32(null) === 0 && crc32(undefined) === 0, 'garbage checksums without throwing');
  const c = makeChunk('tEXt', bytes('hi'));
  ok(c.length === 4 + 4 + 2 + 4, 'a chunk is length, type, data and checksum');
}

console.log('\n=== §4 · ⚑ THE TIER IS COMPUTED, AND MATCHES THE NODE FORGE ===');
{
  ok(rarity({ assessorPass: false }) === 'common', 'no pass is common');
  ok(rarity({ assessorPass: true }) === 'uncommon', 'a pass alone is uncommon');
  ok(rarity({ assessorPass: true, depth: 2 }) === 'rare', 'a pass two deep is rare');
  ok(rarity({ assessorPass: true, depth: 3, readingKeyHonest: true }) === 'holo', 'three deep and honest is holo');
  ok(rarity({ assessorPass: false, depth: 9, readingKeyHonest: true }) === 'common',
     '⚑ depth alone earns NOTHING — passing the assessor is the floor, and it cannot be skipped');
  ok(rarity(null) === 'common' && rarity('x') === 'common', 'garbage is common, never better');

  // ⚑ The one that stops a browser card and a command-line card disagreeing about what was earned.
  const cases = [
    { assessorPass: false, depth: 0, readingKeyHonest: false },
    { assessorPass: true, depth: 0, readingKeyHonest: false },
    { assessorPass: true, depth: 2, readingKeyHonest: false },
    { assessorPass: true, depth: 3, readingKeyHonest: true },
    { assessorPass: true, depth: 3, readingKeyHonest: false },
    { assessorPass: false, depth: 3, readingKeyHonest: true },
  ];
  const same = cases.every(c => rarity(c) === nodeRarity(c));
  ok(same, '⚑ agrees with forge.mjs on every combination — one card, one tier, wherever it was made');
}

console.log('\n=== §5 · a build goes in and comes back out ===');
{
  const payload = 'SGVsbG8gd29ybGQ=';
  const manifest = manifestFor({ seal: 'abc123', tags: 'owl:high-left', assessorPass: true, depth: 2, forged: '2026-08-13' });
  ok(manifest.rarity === 'rare', 'the manifest carries the computed tier');
  ok(manifest.v === '0.1' && manifest.parent === null, 'and the spec version, with no parent by default');

  const card = embed(plainPng(), payload, manifest);
  const r = read(card);
  ok(r.isCard === true, 'the card reads back as a card');
  ok(r.payloadB64 === payload, '⚑ the build comes back out byte for byte');
  ok(r.manifest.seal === 'abc123' && r.manifest.rarity === 'rare', 'and so does the manifest');
  ok(parseChunks(card).some(c => c.type === 'IEND'), 'it is still a valid PNG afterwards');
  ok(parseChunks(card).at(-1).type === 'IEND', '⚑ with IEND still LAST — anything after it is invisible to a decoder');
}

console.log('\n=== §6 · ⚑ RE-FORGING DOES NOT LEAVE THE OLD BUILD BEHIND ===');
{
  const once = embed(plainPng(), 'FIRST', manifestFor({ seal: 'one' }));
  const twice = embed(once, 'SECOND', manifestFor({ seal: 'two' }));
  const payloads = parseChunks(twice).filter(c => latin1(c.data).startsWith(PAYLOAD_KEYWORD));
  ok(payloads.length === 1, '⚑ a card forged twice carries ONE payload, not two');
  ok(read(twice).payloadB64 === 'SECOND', 'and it is the new one');
  ok(read(twice).manifest.seal === 'two', '⚑ so a fresh build can never sit beside a stale seal');
  const manifests = parseChunks(twice).filter(c => latin1(c.data).startsWith(MANIFEST_KEYWORD));
  ok(manifests.length === 1, 'and one manifest');
}

console.log('\n=== §7 · what a plain picture says ===');
{
  const r = read(plainPng());
  ok(r.isCard === false, 'a plain PNG is not a card');
  ok(/carries no build/.test(r.reason), 'and says so in words a person can read');

  const half = embed(plainPng(), '', manifestFor({ seal: 's' }));
  const stripped = serialise(parseChunks(half).filter(c => !latin1(c.data).startsWith(PAYLOAD_KEYWORD)));
  const hr = read(stripped);
  ok(hr.isCard === false && /no payload/.test(hr.reason), 'a manifest with the build removed is called out as missing the build');

  const badJson = serialise((() => {
    const cs = parseChunks(plainPng());
    return [...cs.slice(0, -1), textChunk(MANIFEST_KEYWORD, '{not json'), textChunk(PAYLOAD_KEYWORD, 'x'), cs.at(-1)];
  })());
  const br = read(badJson);
  ok(br.malformedManifest === true && br.isCard === false, '⚑ an unreadable manifest is NOT treated as a card');
}

console.log('\n=== §8 · the NUL separator, which is the whole tEXt format ===');
{
  const cs = [textChunk('konomi-manifest', 'value here')];
  ok(readText(cs, 'konomi-manifest') === 'value here', 'a keyword reads back its value');
  ok(readText(cs, 'konomi-payload') === null, 'a keyword that is not there reads null');
  ok(readText([], 'x') === null && readText(null, 'x') === null, 'and so does an empty set of chunks');
  ok(readText([{ type: 'tEXt', data: bytes('no-separator-here') }], 'no-separator-here') === null,
     '⚑ a tEXt chunk with no NUL is skipped rather than read as a key with no value');
  ok(readText(cs, 'konomi') === null,
     '⚑ and a keyword that is only a PREFIX does not match — otherwise one card field could impersonate another');
}

console.log('\n=== §10 · the edges the gate found nothing pinning ===');
{
  // A file that is EXACTLY the signature and nothing else. It is long enough to be a PNG and still
  // has no chunks — the two failures are different and a reader should say which.
  let threw = null;
  try { parseChunks(PNG_SIG.slice()); } catch (e) { threw = e.message; }
  ok(/no IEND/.test(String(threw)) && !/runs past the end/.test(String(threw)),
     '⚑ eight bytes is long enough to check, so it fails for having no IEND — not for running past the end');
  threw = null;
  try { parseChunks(PNG_SIG.subarray(0, 7)); } catch (e) { threw = e.message; }
  ok(/too short/.test(String(threw)), 'seven bytes is too short to even look at');

  // A chunk header that ends exactly at the end of the file, with no room for its body.
  const stub = concat([PNG_SIG, new Uint8Array([0, 0, 0, 5]), bytes('tEXt')]);
  threw = null;
  try { parseChunks(stub); } catch (e) { threw = e.message; }
  // ⚑ BOTH failure messages begin 'PNG is truncated', so matching that word passed either way and
  // the gate showed it. Match the TAIL, which is the part that says which failure it was.
  ok(/runs past the end/.test(String(threw)), '⚑ a header promising bytes that are not there is named as running past the end');

  ok(read(Array.from(plainPng())).isCard === false,
     '⚑ a PNG handed over as a plain array still reads — the bytes are what matter, not the container');

  // IEND as the very first chunk: index 0, which a `less than zero` test treats as "not found".
  const endFirst = serialise([{ type: 'IEND', data: new Uint8Array(0) }]);
  const e0 = embed(endFirst, 'P', manifestFor({ seal: 's' }));
  ok(read(e0).isCard === true, '⚑ a PNG whose IEND is the FIRST chunk still forges — index 0 is a real index');

  // A keyword of zero length: nul at index 0, which the same class of test drops.
  const emptyKw = [{ type: 'tEXt', data: concat([new Uint8Array([0]), bytes('orphan')]) }];
  ok(readText(emptyKw, '') === 'orphan', 'a tEXt chunk with an empty keyword is read, not skipped');

  ok(readText([null, undefined, textChunk('k', 'v')], 'k') === 'v',
     '⚑ a null among the chunks is stepped over rather than thrown on');
}

console.log('\n=== §11 · what must SURVIVE a forge ===');
{
  const before = parseChunks(plainPng());
  const card = embed(plainPng(), 'PAYLOAD', manifestFor({ seal: 's', tags: 'owl:high-left,rose:blue:1' }));
  const after = parseChunks(card);
  ok(after.some(c => c.type === 'IHDR'), '⚑ the IHDR survives — drop it and the file stops being an image');
  ok(after.filter(c => c.type === 'IHDR')[0].data.length === before[0].data.length, 'and it is unchanged');
  ok(after.filter(c => c.type === 'IEND').length === 1, 'there is exactly one IEND');

  const m = read(card).manifest;
  ok(m.tags === 'owl:high-left,rose:blue:1', '⚑ the tags travel — they are what the artwork is drawn from');
  ok(manifestFor({ forged: '2026-08-13' }).forged === '2026-08-13', 'and so does the date it was forged');
  ok(manifestFor({}).tags === '' && manifestFor({}).forged === '', 'absent ones are empty strings, never "undefined"');

  // A card whose payload chunk sits FIRST, which is where a naive "find the end" goes wrong.
  const odd = serialise((() => {
    const cs = parseChunks(plainPng());
    return [textChunk(PAYLOAD_KEYWORD, 'STALE'), ...cs];
  })());
  const refreshed = embed(odd, 'FRESH', manifestFor({ seal: 'new' }));
  const payloads = parseChunks(refreshed).filter(c => latin1(c.data).startsWith(PAYLOAD_KEYWORD));
  ok(payloads.length === 1 && read(refreshed).payloadB64 === 'FRESH',
     '⚑ a stale payload is dropped wherever it sits, not just when it is conveniently placed');

  // ⚑ ONLY tEXt AND zTXt ARE CARD CHUNKS. Some other chunk type whose bytes happen to begin with a
  // card keyword is somebody else's data, and dropping it would quietly corrupt their file.
  const impostor = serialise((() => {
    const cs = parseChunks(plainPng());
    const fake = { type: 'iTXt', data: concat([bytes(PAYLOAD_KEYWORD), new Uint8Array([0]), bytes('not ours')]) };
    return [...cs.slice(0, -1), fake, cs.at(-1)];
  })());
  const kept = parseChunks(embed(impostor, 'MINE', manifestFor({ seal: 's' })));
  ok(kept.some(c => c.type === 'iTXt'),
     '⚑ a NON-text chunk that merely starts with a card keyword is left alone — it is not ours to drop');
}

console.log('\n=== §12 · a payload with nothing describing it ===');
{
  const cs = parseChunks(plainPng());
  const orphan = serialise([...cs.slice(0, -1), textChunk(PAYLOAD_KEYWORD, 'x'), cs.at(-1)]);
  const r = read(orphan);
  ok(r.isCard === false, 'a payload with no manifest is not a card');
  ok(/no manifest/.test(r.reason), '⚑ and the reason says which half is missing — "not a card" alone is no help');
}

console.log('\n=== §9 · pure under garbage ===');
{
  const junk = [null, undefined, '', 0, [], {}, NaN, 'x', new Uint8Array(0)];
  let threw = null;
  for (const j of junk) {
    try { rarity(j); manifestFor(j); readText(j, j); crc32(j); concat([]); } catch (e) { threw = `${JSON.stringify(j)} → ${e.message}`; }
  }
  ok(threw === null, 'the pure helpers never throw' + (threw ? ' — ' + threw : ''));
  // parseChunks/embed/read are ALLOWED to throw — a bad card must be refused loudly, not shrugged at.
  let refused = 0;
  for (const j of junk) { try { read(j); } catch { refused++; } }
  ok(refused === junk.length, '⚑ read() REFUSES every kind of non-PNG rather than returning something hopeful');
}

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
