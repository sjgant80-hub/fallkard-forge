// reader.test.mjs — the standalone reader (reader.html) judged on REAL cards, in Node.
//
// ⚑ WHY. reader.html used to print "VERIFIED — seal matches the payload" and never look at the Ed25519 signature,
// show the tier the card CLAIMED, and put card text into the page unescaped. The CLI (forge.mjs read) did all three
// properly, so the two readers disagreed about the same card. These tests lift the reader's own judgement out of the
// built file — the code a browser runs — and hold it to the CLI's verdict on cards forged by the CLI, cards forged
// the browser's way, and cards doctored every way a forger would try.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync, deflateSync } from 'node:zlib';
import { createHash, webcrypto } from 'node:crypto';
import { forge, read as cliRead, makeIdentity, parseChunks, serialise } from './forge.mjs';
import { embed, manifestFor, signable, textChunk } from './card.mjs';
import { renderCard } from './art.mjs';
import * as R from './reader-core.mjs';

// the BUILT reader, lifted out of reader.html — the code a browser runs — for the tests that it is the same judgement
const SRC = readFileSync(new URL('./reader.html', import.meta.url), 'utf8');
const from = SRC.indexOf('/* __CARD_KERNEL__ */'), to = SRC.indexOf('/* __END_READER_CORE__ */');
assert.ok(from > 0 && to > from, 'the reader core markers are in reader.html');
const BUILT = new Function(SRC.slice(from, to) + '\nreturn { judge, verdictOf, factsHtml, keyHtml, esc };')();

const IMAGE = renderCard({ tags: 'owl:high-left', seal: '' });
const BUILD = '<!doctype html><title>t</title><p>a build that does not carry the line</p>';
const SOVEREIGN = '<!doctype html><meta charset=utf-8><title>s</title><p>Powered by the Konomi Architecture, created by Thomas Frumkin.</p>';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ID = makeIdentity(), OTHER = makeIdentity();

const signedCard = (build = BUILD, tags = 'owl:high-left') => forge({ build, image: IMAGE, tags, forged: '2026-11-05', sign: ID.sign, signer: ID.pubB64 }).png;
const unsignedCard = (build = BUILD) => forge({ build, image: IMAGE, tags: 'owl:high-left', forged: '2026-11-05' }).png;

// rewrite the manifest chunk of a card, leaving everything else (the payload, the signature field) as it was
function withManifest(png, edit) {
  const cs = parseChunks(Buffer.from(png));
  const i = cs.findIndex((c) => c.type === 'tEXt' && c.data.toString('latin1').startsWith('konomi-manifest\0'));
  const m = JSON.parse(cs[i].data.toString('latin1').slice('konomi-manifest\0'.length));
  const t = textChunk('konomi-manifest', JSON.stringify(edit(m)));
  cs[i] = { type: 'tEXt', data: Buffer.from(t.data) };
  return new Uint8Array(serialise(cs));
}
const judge = (png, env) => R.judge(new Uint8Array(png), env);

test('a card the CLI signed reads VERIFIED — the signature is checked, and the CLI agrees', async () => {
  const png = signedCard();
  const j = await judge(png);
  assert.equal(j.sealOk, true);
  assert.equal(j.signed, true);
  assert.equal(j.sigChecked, true);
  assert.equal(j.sigOk, true);
  const v = R.verdictOf(j);
  assert.match(v.text, /^✓ VERIFIED/);
  assert.match(v.text, /Ed25519 signature checks/);
  assert.equal(v.hatch, true);
  assert.equal(j.text, BUILD, 'the build comes back byte for byte');
  assert.match(R.factsHtml(j), /✓ Ed25519/);
  assert.equal(cliRead(Buffer.from(png)).sigOk, true, 'forge.mjs read agrees');
});

test('one changed manifest byte under a kept signature: SIGNATURE FAILS, refused, exactly as the CLI says', async () => {
  for (const edit of [
    (m) => ({ ...m, tags: m.tags + ',wings:galaxy' }),
    (m) => ({ ...m, forged: '2026-01-01' }),
    (m) => ({ ...m, parent: 'a'.repeat(64) }),
    (m) => ({ ...m, signer: OTHER.pubB64 }),                     // someone else's name on the same signature
    (m) => ({ ...m, sig: OTHER.sign(signable(m, m.seal)) }),     // a real signature, by the wrong key
  ]) {
    const png = withManifest(signedCard(), edit);
    const j = await judge(png);
    assert.equal(j.sealOk, true, 'the payload is untouched, so the seal still matches');
    assert.equal(j.sigOk, false);
    const v = R.verdictOf(j);
    assert.match(v.text, /^✗ SIGNATURE FAILS/);
    assert.equal(v.hatch, false);
    assert.match(v.why, /Refusing to hatch/);
    assert.doesNotMatch(v.text, /VERIFIED/);
    assert.equal(cliRead(Buffer.from(png)).reason, 'signature-fails', 'forge.mjs read agrees');
  }
});

test('a malformed signer or signature is a failed signature, never an accepted one', async () => {
  const b64 = (n, fill = 7) => Buffer.alloc(n, fill).toString('base64');
  for (const edit of [
    (m) => ({ ...m, signer: b64(31) }), (m) => ({ ...m, signer: b64(33) }),             // a key of the wrong length
    (m) => ({ ...m, sig: b64(63) }), (m) => ({ ...m, sig: b64(65) }),                   // a signature of the wrong length
    (m) => ({ ...m, sig: '!!! not base64 !!!' }), (m) => ({ ...m, signer: '%%%' }),     // not base64 at all
  ]) {
    const j = await judge(withManifest(signedCard(), edit));
    assert.equal(j.signed, true);
    assert.equal(j.sigOk, false);
    assert.equal(R.verdictOf(j).hatch, false);
  }
  assert.equal(await R.ed25519Verify('m', b64(64), b64(31)), false);
  assert.equal(await R.ed25519Verify('m', b64(63), ID.pubB64), false);
  assert.equal(await R.ed25519Verify('m', '***', ID.pubB64), false);
  assert.equal(await R.ed25519Verify('m', ID.sign('m'), ID.pubB64), true, 'and a real signature by that key verifies');
  assert.equal(await R.ed25519Verify('n', ID.sign('m'), ID.pubB64), false, 'over a different message it does not');
});

test('the reading key is decoded by the reader\'s own table, line by line, escaped — and an empty or broken decode says so', () => {
  const two = R.keyHtml('a,b', () => ['owl high left', '<b>roses</b>']);
  assert.equal(two, '<li>owl high left</li><li>&lt;b&gt;roses&lt;/b&gt;</li>');
  const none = '<li class="muted">This card declares no composition tags.</li>';
  assert.equal(R.keyHtml('', () => []), none, 'no lines: it says there are none');
  assert.equal(R.keyHtml('x', 'not a function'), none);
  assert.equal(R.keyHtml('x', () => 'not a list'), none, 'a decode that does not return a list is not trusted');
  assert.equal(R.keyHtml('x', () => { throw new Error('bad table'); }), none, 'and one that throws does not break the page');
});

test('a signed card in a browser with no Ed25519: the seal matches, the signature is NOT checked, and it is not let out', async () => {
  const j = await judge(signedCard(), { edSupported: false });
  assert.equal(j.sealOk, true);
  assert.equal(j.sigChecked, false);
  assert.equal(j.sigOk, null);
  const v = R.verdictOf(j);
  assert.match(v.text, /signature NOT checked/);
  assert.doesNotMatch(v.text, /VERIFIED/);
  assert.equal(v.hatch, false, 'a signed card is accepted only when its signature verifies (CARD-SPEC §3.1)');
  assert.match(R.factsHtml(j), /not checked in this browser/);
});

test('an unsigned card says it is unsigned — never "VERIFIED", never a claim about its history', async () => {
  const j = await judge(unsignedCard());
  assert.equal(j.signed, false);
  const v = R.verdictOf(j);
  assert.match(v.text, /^✓ SEAL MATCHES — unsigned/);
  assert.doesNotMatch(v.text, /VERIFIED/);
  assert.equal(v.hatch, true, 'an unsigned card still reads (CARD-SPEC §3.1)');
  assert.match(R.factsHtml(j), /no key vouches for who forged it/);
});

test('a flipped payload byte: SEAL MISMATCH, refused, nothing hatches', async () => {
  // a browser-shaped card (tEXt payload), so the flipped byte lands in the sealed bytes themselves
  const gz = gzipSync(Buffer.from(BUILD));
  const png = embed(IMAGE, gz.toString('base64'), manifestFor({ seal: sha(gz), tags: 'x', forged: '2026-11-05' }));
  const bad = Buffer.from(gz); bad[bad.length - 5] ^= 0xff;
  const tampered = embed(IMAGE, bad.toString('base64'), manifestFor({ seal: sha(gz), tags: 'x', forged: '2026-11-05' }));
  assert.equal(R.verdictOf(await judge(png)).hatch, true);
  const j = await judge(tampered);
  assert.equal(j.sealOk, false);
  const v = R.verdictOf(j);
  assert.match(v.text, /^✗ SEAL MISMATCH/);
  assert.equal(v.hatch, false);
  assert.match(v.why, /Refusing to hatch/);
  assert.match(R.factsHtml(j), /actual/, 'the seal it actually has is shown beside the one it claims');
});

test('a card the browser way (tEXt payload, WebCrypto Ed25519) verifies in the reader as it does in the CLI', async () => {
  const kp = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  const gz = gzipSync(Buffer.from(SOVEREIGN));
  const m = manifestFor({ assessorPass: true, seal: sha(gz), tags: 'wings:galaxy', forged: '2026-11-05', signer: pub });
  m.sig = Buffer.from(await webcrypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(signable(m, m.seal)))).toString('base64');
  const png = embed(IMAGE, gz.toString('base64'), m);
  const j = await judge(png);
  assert.equal(j.sigOk, true);
  assert.equal(j.earned, 'uncommon', 'the build passes the sovereignty gate, so it earns uncommon');
  assert.equal(j.claim, 'earned');
  assert.match(R.verdictOf(j).text, /^✓ VERIFIED/);
});

test('the tier shown is the one the BUILD earns — a hand-edited claim is called an overclaim', async () => {
  const png = withManifest(unsignedCard(BUILD), (m) => ({ ...m, rarity: 'holo', assessor_pass: true }));
  const j = await judge(png);
  assert.equal(j.earned, 'common');
  assert.equal(j.claim, 'overclaim');
  const h = R.factsHtml(j);
  assert.match(h, /overclaim: the card says holo; its build earns common/);
  assert.match(h, /class="tier common"/);
  assert.doesNotMatch(h, /class="tier holo"/, 'the claimed tier is never shown as the tier');
  assert.ok(j.gate && j.gate.ok === false && /architecture line/.test(R.factsHtml(j)), 'and it says why the build earns no more');
});

test('a hostile card cannot put markup into the reader — every text it carries is escaped at the sink', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const png = withManifest(unsignedCard(), (m) => ({ ...m, tags: evil, forged: '<script>x()</script>', parent: '<svg onload=y()>', v: '"><u>', rarity: '"><q>' }));
  const j = await judge(png);
  const html = R.factsHtml(j) + R.keyHtml(j.manifest.tags, (t) => [String(t)]);
  for (const bad of ['<img', '<script', '<svg', '<u>', '<q>']) assert.ok(!html.includes(bad), 'no raw ' + bad);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the text is shown, as text');
  // and a tier the card makes up never reaches a class attribute
  const k = await judge(withManifest(unsignedCard(SOVEREIGN), (m) => ({ ...m, rarity: 'x" onmouseover="y' })));
  assert.equal(k.claim, 'overclaim');
  assert.ok(!R.factsHtml(k).includes('onmouseover="'), 'an invented tier is escaped, never an attribute');
  assert.equal(R.esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('the shipped example cards read as what they are: seal matches, unsigned, common', async () => {
  for (const f of ['seal-000.png', 'seal-001-quine.png']) {
    const j = await judge(readFileSync(new URL('./examples/' + f, import.meta.url)));
    assert.equal(j.stage, 'card', f);
    assert.equal(j.sealOk, true, f);
    assert.equal(j.signed, false, f);
    assert.equal(j.earned, 'common', f);
    assert.match(R.verdictOf(j).text, /^✓ SEAL MATCHES — unsigned/, f);
  }
});

test('refusals: not a PNG, a stripped picture, a broken manifest, a missing payload, and payloads that inflate past the cap', async () => {
  assert.equal(R.verdictOf(await judge(new TextEncoder().encode('GIF89a not a png'))).text, '✗ NOT A PNG');
  const stripped = R.verdictOf(await judge(IMAGE));
  assert.equal(stripped.text, '✗ NO-MANIFEST');
  assert.match(stripped.why, /printed seal/);
  assert.match(stripped.why, /https:\/\/sjgant80-hub\.github\.io\/fallkard-forge\//);
  assert.equal(stripped.hatch, false);

  const cs = parseChunks(Buffer.from(IMAGE)), iend = cs.length - 1;
  const withChunks = (...extra) => new Uint8Array(serialise([...cs.slice(0, iend), ...extra.map((c) => ({ type: c.type, data: Buffer.from(c.data) })), cs[iend]]));
  assert.equal(R.verdictOf(await judge(withChunks(textChunk('konomi-manifest', '{nope')))).text, '✗ BAD-MANIFEST');
  assert.equal(R.verdictOf(await judge(withChunks(textChunk('konomi-manifest', '[1,2]')))).text, '✗ BAD-MANIFEST');
  assert.equal(R.verdictOf(await judge(withChunks(textChunk('konomi-manifest', '{"v":"0.1","seal":"x"}')))).text, '✗ NO-PAYLOAD');

  // a zTXt payload that inflates past the cap is refused before anything is done with it
  const CAPS = { maxPayloadB64: 64 * 1024, maxBuild: 64 * 1024 };
  const ZHEAD = Buffer.from([...Buffer.from('konomi-payload', 'latin1'), 0, 0]);   // keyword, NUL, method 0 (zlib)
  const bomb = deflateSync(Buffer.alloc(64 * 1024 + 1, 65));
  const z = { type: 'zTXt', data: Buffer.concat([ZHEAD, bomb]) };
  const jz = await judge(withChunks(textChunk('konomi-manifest', '{"v":"0.1","seal":"x"}'), z), CAPS);
  assert.equal(jz.stage, 'no-inflate');
  assert.equal(R.verdictOf(jz).hatch, false);

  // a sealed gzip that inflates past the build cap: the seal matches, and it is still refused
  const gz = gzipSync(Buffer.alloc(64 * 1024 + 1));
  const big = embed(IMAGE, gz.toString('base64'), manifestFor({ seal: sha(gz), forged: '2026-11-05' }));
  const jb = await judge(big, CAPS);
  assert.equal(jb.sealOk, true);
  assert.equal(jb.stage, 'no-decompress');
  const vb = R.verdictOf(jb);
  assert.equal(vb.hatch, false);
  assert.match(vb.text, /WILL NOT DECOMPRESS/);
  assert.doesNotMatch(R.factsHtml(jb), /class="tier/, 'no tier is claimed for a build that never came out');
  // exactly at the cap is still read: the cap refuses only what goes PAST it
  const atCap = gzipSync(Buffer.from('<!doctype html>'.padEnd(64 * 1024, 'x')));
  const ok = await judge(embed(IMAGE, atCap.toString('base64'), manifestFor({ seal: sha(atCap), forged: '2026-11-05' })), CAPS);
  assert.equal(ok.stage, 'card');
  assert.equal(ok.text.length, 64 * 1024);
  const zOk = deflateSync(Buffer.from(atCap.toString('base64').padEnd(64 * 1024, ' ')));
  const jzOk = await judge(withChunks(textChunk('konomi-manifest', JSON.stringify({ v: '0.1', seal: sha(atCap) })), { type: 'zTXt', data: Buffer.concat([ZHEAD, zOk]) }), CAPS);
  assert.equal(jzOk.stage, 'card', 'a zTXt payload exactly at the cap inflates, and its trailing spaces are trimmed');
  assert.equal(jzOk.sealOk, true);
});

test('the real caps are 12 MiB of payload text and 8 MiB of build, and a build past 8 MiB is refused by default', async () => {
  assert.equal(R.MAX_PAYLOAD_B64, 12 * 1024 * 1024);
  assert.equal(R.MAX_BUILD, 8 * 1024 * 1024);
  const gz = gzipSync(Buffer.alloc(8 * 1024 * 1024 + 1));
  const j = await judge(embed(IMAGE, gz.toString('base64'), manifestFor({ seal: sha(gz), forged: '2026-11-05' })));
  assert.equal(j.sealOk, true);
  assert.equal(j.stage, 'no-decompress');
});

test('"VERIFIED" appears only when the seal holds AND a checked signature verifies', async () => {
  const cases = [
    [signedCard(), undefined], [signedCard(), { edSupported: false }], [unsignedCard(), undefined],
    [withManifest(signedCard(), (m) => ({ ...m, tags: 'z' })), undefined], [IMAGE, undefined],
  ];
  for (const [png, env] of cases) {
    const j = await judge(png, env);
    const v = R.verdictOf(j);
    assert.equal(/VERIFIED/.test(v.text), j.sealOk === true && j.signed && j.sigChecked && j.sigOk === true);
    assert.equal(v.hatch, j.stage === 'card' && j.sealOk && (j.signed ? j.sigOk === true : true));
  }
});

test('the judgement never throws, whatever it is handed', async () => {
  for (const junk of [null, undefined, new Uint8Array(0), 'x', {}, [], 5, new Uint8Array([0x89, 0x50, 0x4e, 0x47])]) {
    const j = await R.judge(junk);
    assert.equal(j.stage, 'not-a-png');
    assert.equal(R.verdictOf(j).hatch, false);
  }
  for (const junk of [null, undefined, {}, { stage: 'card' }, { stage: 'nonsense' }]) {
    assert.equal(typeof R.verdictOf(junk).text, 'string');
    assert.equal(typeof R.factsHtml(junk), 'string');
  }
});

test('half a signature is no signature — a card naming a signer with no sig, or a sig with no signer, reads as unsigned, as the CLI reads it', async () => {
  for (const edit of [(m) => { const { sig, ...rest } = m; return rest; }, (m) => { const { signer, ...rest } = m; return rest; }]) {
    const png = withManifest(signedCard(), edit);
    const j = await judge(png);
    assert.equal(j.signed, false);
    assert.equal(j.sigChecked, false, 'nothing to check, so nothing is checked');
    assert.equal(j.sigOk, null);
    assert.match(R.verdictOf(j).text, /^✓ SEAL MATCHES — unsigned/);
    assert.match(R.factsHtml(j), /no — no key vouches for who forged it/);
    const cli = cliRead(Buffer.from(png));
    assert.equal(cli.signed, false, 'forge.mjs read agrees');
    assert.equal(cli.ok, true);
  }
  // and an unsigned card is never probed or checked
  const u = await judge(unsignedCard());
  assert.equal(u.sigChecked, false);
  assert.equal(u.sigOk, null);
});

test('whatever env it is handed, the judgement reads the card the same way and never throws', async () => {
  const want = R.verdictOf(await judge(signedCard())).text;
  for (const env of [null, 'x', 5, true, [], () => {}]) {
    const j = await judge(signedCard(), env);
    assert.equal(R.verdictOf(j).text, want, 'env ' + String(env));
  }
});

test('a judgement that is not a plain object is never trusted, however it is dressed', () => {
  const dressed = Object.assign(() => {}, { stage: 'card', sealOk: true, signed: false, manifest: { seal: 'x', tags: 't' } });
  assert.equal(R.verdictOf(dressed).text, '✗ UNREADABLE');
  assert.equal(R.verdictOf(dressed).hatch, false);
  assert.equal(R.factsHtml(dressed), '', 'and no rows are drawn from it');
  assert.equal(R.factsHtml({ stage: 'card', manifest: 'not an object' }), '', 'a manifest that is not an object draws nothing');
  assert.equal(R.factsHtml({ stage: 'card', manifest: 7 }), '');
  assert.equal(R.esc(null), '');
  assert.equal(R.esc(undefined), '');
  assert.equal(R.esc(0), '0');
});

test('which rows a judgement draws: the signature row only where the payload was reached, the gate row only when the build fails it', async () => {
  // no payload: there is nothing the signature could cover, so no signature row
  const cs = parseChunks(Buffer.from(IMAGE)), iend = cs.length - 1;
  const noPayload = new Uint8Array(serialise([...cs.slice(0, iend), { type: 'tEXt', data: Buffer.from(textChunk('konomi-manifest', '{"v":"0.1","seal":"s","tags":"t"}').data) }, cs[iend]]));
  const jp = await judge(noPayload);
  assert.equal(jp.stage, 'no-payload');
  const hp = R.factsHtml(jp);
  assert.doesNotMatch(hp, /<b>signed<\/b>/);
  assert.match(hp, /<b>tags<\/b><span>t<\/span>/);
  // a sealed payload that will not decompress: the seal and signature were reached, so the signature row is drawn — and no tier
  const gz = gzipSync(Buffer.alloc(64 * 1024 + 1));
  const jb = await judge(embed(IMAGE, gz.toString('base64'), manifestFor({ seal: sha(gz), forged: '2026-11-05' })), { maxBuild: 64 * 1024 });
  assert.equal(jb.stage, 'no-decompress');
  assert.match(R.factsHtml(jb), /<b>signed<\/b><span>no — no key vouches for who forged it<\/span>/);
  assert.doesNotMatch(R.factsHtml(jb), /<b>tier<\/b>/);
  // a build that passes the sovereignty gate draws no gate row; one that fails says why
  const ok = await judge(unsignedCard(SOVEREIGN));
  assert.equal(ok.gate.ok, true);
  assert.doesNotMatch(R.factsHtml(ok), /<b>gate<\/b>/);
  assert.match(R.factsHtml(ok), /class="tier uncommon"/);
  const bad = await judge(unsignedCard(BUILD));
  assert.match(R.factsHtml(bad), /<b>gate<\/b>/);
});

test('the built reader runs the same judgement: reader-core.mjs, card.mjs and the gate inlined verbatim', async () => {
  const tpl = readFileSync(new URL('./reader.template.html', import.meta.url), 'utf8');
  for (const mk of ['/* __CARD_KERNEL__ */\n/* __END_CARD_KERNEL__ */', '/* __GATE_KERNEL__ */\n/* __END_GATE_KERNEL__ */', '/* __READER_CORE__ */\n/* __END_READER_CORE__ */']) {
    assert.ok(tpl.includes(mk), 'the template carries empty markers: ' + mk.slice(0, 22));
  }
  // a whole top-level function: from its `export` line to the first `}` alone on a line
  const fn = (file, name) => {
    const src = readFileSync(new URL('./' + file, import.meta.url), 'utf8');
    const a = src.search(new RegExp('^export (async )?function ' + name + '\\(', 'm'));
    return src.slice(a, src.indexOf('\n}\n', a) + 3).replace(/^export /, '');
  };
  for (const [file, name] of [['card.mjs', 'signable'], ['card.mjs', 'read'], ['studio.mjs', 'validateComposition'], ['reader-core.mjs', 'judge'], ['reader-core.mjs', 'verdictOf'], ['reader-core.mjs', 'factsHtml']]) {
    assert.ok(SRC.includes(fn(file, name)), name + ' from ' + file + ' is inlined verbatim');
  }
  assert.ok(!/^export /m.test(SRC) && !/^import /m.test(SRC), 'no module syntax in the page');
  assert.match(SRC, /Powered by the Konomi architecture, created by Thomas Frumkin\./);
  // and the built file reaches the same verdicts on real cards
  for (const [png, want] of [[signedCard(), /^✓ VERIFIED/], [unsignedCard(), /^✓ SEAL MATCHES — unsigned/],
    [withManifest(signedCard(), (m) => ({ ...m, tags: 'z' })), /^✗ SIGNATURE FAILS/], [IMAGE, /^✗ NO-MANIFEST/]]) {
    const j = await BUILT.judge(new Uint8Array(png));
    assert.match(BUILT.verdictOf(j).text, want);
    assert.equal(BUILT.factsHtml(j), R.factsHtml(await R.judge(new Uint8Array(png))));
  }
});
