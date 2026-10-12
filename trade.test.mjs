// trade.test.mjs — the trade kernel pinned: parts, reassembly bounds, key/invite ids, the proof-of-key text, and the
// receiver's verdict order. The mutation gate runs trade.mjs against this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { LIMITS, MAX_CARD_B64, TRADE_STAGES, HELLO_TAG, cardParts, makeAssembler, inviteIdOf, keyOfInviteId, fingerprintOf, helloText, admit } from './trade.mjs';

const SHA = createHash('sha256').update('a card').digest('hex');
const SHA2 = createHash('sha256').update('another card').digest('hex');
const rawKey = () => generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const KEY = Buffer.from(rawKey()).toString('base64');
const KEY2 = Buffer.from(rawKey()).toString('base64');
const NONCE = '0123456789abcdef0123456789abcdef';
const msg = (over = {}) => ({ t: 'card', id: 'c1', i: 0, n: 1, sha: SHA, label: 'x', part: 'AAAA', ...over });

test('constants', () => {
  assert.deepEqual({ ...LIMITS }, { chunk: 12000, parts: 64, inFlight: 4, label: 40, id: 32 });
  assert.equal(MAX_CARD_B64, 768000);
  assert.deepEqual([...TRADE_STAGES], ['transit', 'parse', 'seal', 'signature', 'accepted']);
  assert.equal(HELLO_TAG, 'fallkard-forge trade hello v1');
  assert.ok(Object.isFrozen(LIMITS) && Object.isFrozen(TRADE_STAGES));
});

test('cardParts cuts a card into bounded parts that put back together exactly', () => {
  const b64 = 'Q'.repeat(LIMITS.chunk * 2 + 5);
  const parts = cardParts(b64, 'card-1', SHA, 'my card');
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.part.length), [12000, 12000, 5]);
  assert.deepEqual(parts.map((p) => [p.t, p.id, p.i, p.n, p.sha, p.label]), [0, 1, 2].map((i) => ['card', 'card-1', i, 3, SHA, 'my card']));
  assert.equal(parts.map((p) => p.part).join(''), b64);
  assert.equal(cardParts('QQQQ', 'a', SHA, 'L'.repeat(99))[0].label.length, LIMITS.label, 'a long label is cut');
  assert.equal(cardParts('QQQQ', 'a', SHA, 7)[0].label, 'card', 'a non-string label is "card"');
  assert.equal(cardParts('Q'.repeat(LIMITS.chunk), 'a', SHA, 'x').length, 1, 'exactly one chunk is one part');
});

test('cardParts refuses anything out of bounds — an empty list, never a throw', () => {
  assert.equal(cardParts('Q'.repeat(MAX_CARD_B64), 'a', SHA, 'x').length, LIMITS.parts, 'the largest card that fits');
  for (const [b64, id, sha] of [
    ['Q'.repeat(MAX_CARD_B64 + 1), 'a', SHA], ['', 'a', SHA], [null, 'a', SHA], [5, 'a', SHA],
    ['QQQQ', '', SHA], ['QQQQ', 'x'.repeat(LIMITS.id + 1), SHA], ['QQQQ', 7, SHA],
    ['QQQQ', 'a', SHA.toUpperCase()], ['QQQQ', 'a', SHA.slice(1)], ['QQQQ', 'a', null],
  ]) assert.deepEqual(cardParts(b64, id, sha, 'x'), [], JSON.stringify([typeof b64, id, sha]));
  assert.equal(cardParts('QQQQ', 'x'.repeat(LIMITS.id), SHA, 'x').length, 1, 'an id of exactly the limit is fine');
});

test('the assembler returns nothing until the card is whole, then exactly the card', () => {
  const feed = makeAssembler();
  const b64 = 'Q'.repeat(LIMITS.chunk) + 'RRRR';
  const parts = cardParts(b64, 'c', SHA, 'name');
  assert.equal(feed(parts[1]), null, 'out of order is fine');
  assert.deepEqual(feed(parts[0]), { id: 'c', sentSha: SHA, label: 'name', b64 });
  assert.equal(feed(parts[0]), null, 'a finished card is forgotten — a late repeat starts nothing whole');
  assert.deepEqual(makeAssembler()(msg()), { id: 'c1', sentSha: SHA, label: 'x', b64: 'AAAA' }, 'a one-part card');
  assert.equal(makeAssembler()(msg({ label: 5 })).label, 'card');
});

test('the assembler takes a full 64-part card and a part of exactly one chunk', () => {
  const feed = makeAssembler();
  let out = null;
  for (let i = 0; i < LIMITS.parts; i++) out = feed(msg({ id: 'big', i, n: LIMITS.parts, part: i === 0 ? 'Z'.repeat(LIMITS.chunk) : 'Y' }));
  assert.ok(out, 'n at the limit is accepted');
  assert.equal(out.b64.length, LIMITS.chunk + LIMITS.parts - 1);
  assert.ok(makeAssembler()(msg({ id: 'x'.repeat(LIMITS.id) })), 'an id of exactly the limit is accepted');
});

test('the assembler ignores every malformed part', () => {
  const bad = [
    null, 5, 'x', [], {}, msg({ t: 'job' }), msg({ id: '' }), msg({ id: 'x'.repeat(LIMITS.id + 1) }), msg({ id: 3 }),
    msg({ sha: 'nope' }), msg({ sha: SHA.toUpperCase() }), msg({ n: 0 }), msg({ n: LIMITS.parts + 1 }), msg({ n: 1.5 }), msg({ n: '1' }),
    msg({ i: -1 }), msg({ i: 1 }), msg({ i: 0.5 }), msg({ part: '' }), msg({ part: 'Q'.repeat(LIMITS.chunk + 1) }), msg({ part: 9 }),
  ];
  for (const m of bad) assert.equal(makeAssembler()(m), null, JSON.stringify(m));
});

test('a part with an index past its own count never completes a card', () => {
  const feed = makeAssembler();
  assert.equal(feed(msg({ id: 'p', i: 0, n: 2 })), null);
  assert.equal(feed(msg({ id: 'p', i: 2, n: 2 })), null, 'i == n is refused');
  assert.deepEqual(feed(msg({ id: 'p', i: 1, n: 2, part: 'BBBB' })).b64, 'AAAABBBB');
});

test('a part that contradicts its card, or repeats an index, is ignored — the first part wins', () => {
  const feed = makeAssembler();
  assert.equal(feed(msg({ id: 'q', i: 0, n: 2, part: 'FIRST' })), null);
  assert.equal(feed(msg({ id: 'q', i: 0, n: 2, part: 'SECOND' })), null, 'a repeat');
  assert.equal(feed(msg({ id: 'q', i: 1, n: 3, part: 'XXXX' })), null, 'a different count');
  assert.equal(feed(msg({ id: 'q', i: 1, n: 2, sha: SHA2, part: 'XXXX' })), null, 'a different sha');
  const done = feed(msg({ id: 'q', i: 1, n: 2, part: 'LAST' }));
  assert.equal(done.b64, 'FIRSTLAST');
  assert.equal(done.sentSha, SHA);
});

test('a card of more than 64 parts never completes, however many parts arrive', () => {
  const feed = makeAssembler();
  let out = null;
  for (let i = 0; i <= LIMITS.parts; i++) out = feed(msg({ id: 'huge', i, n: LIMITS.parts + 1 })) || out;
  assert.equal(out, null);
});

test('a part with a junk count takes no in-flight slot — it cannot push a real card out', () => {
  for (const n of [1.5, NaN, '2', Infinity, null]) {
    const feed = makeAssembler();
    for (const id of ['a', 'b', 'c', 'd']) feed(msg({ id, i: 0, n: 2 }));
    assert.equal(feed(msg({ id: 'junk', i: 0, n })), null);
    assert.ok(feed(msg({ id: 'a', i: 1, n: 2 })), 'the oldest real card is still there after junk n=' + String(n));
  }
});

test('at most four cards half-arrived at once — the oldest is dropped first', () => {
  const feed = makeAssembler();
  for (const id of ['a', 'b', 'c', 'd', 'e']) assert.equal(feed(msg({ id, i: 0, n: 2 })), null);
  assert.equal(feed(msg({ id: 'a', i: 1, n: 2 })), null, 'the oldest (a) was dropped when e arrived — its second half finds nothing');
  assert.equal(feed(msg({ id: 'e', i: 1, n: 2 })).b64, 'AAAAAAAA', 'the newest is still whole-able');
  const four = makeAssembler();
  for (const id of ['a', 'b', 'c', 'd']) four(msg({ id, i: 0, n: 2 }));
  assert.ok(four(msg({ id: 'a', i: 1, n: 2 })), 'with exactly four in flight, none was dropped');
});

test('invite ids and keys convert both ways, canonically, and refuse anything else', () => {
  const id = inviteIdOf(KEY);
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(keyOfInviteId(id), KEY);
  assert.equal(inviteIdOf('+/' + 'A'.repeat(40) + 'A='), '-_' + 'A'.repeat(40) + 'A');
  assert.equal(keyOfInviteId('-_' + 'A'.repeat(41)), '+/' + 'A'.repeat(41) + '=');
  for (const bad of [null, 5, '', KEY.slice(0, -1), KEY + 'A', 'A'.repeat(42) + 'B=', '-'.repeat(43) + '=', KEY.replace('=', '')]) {
    assert.equal(inviteIdOf(bad), null, String(bad));
  }
  for (const bad of [null, 5, '', id.slice(1), id + 'A', 'A'.repeat(42) + 'B', '+'.repeat(43), KEY]) assert.equal(keyOfInviteId(bad), null, String(bad));
});

const hexFp = (b) => 'sha-256 ' + Array.from({ length: 32 }, (_, i) => ((b + i * 7) & 255).toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP1 = hexFp(1), FP2 = hexFp(2);
const sdpWith = (...fps) => ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', ...fps.map((f) => 'a=fingerprint:' + f), 'a=setup:actpass', ''].join('\r\n');

test('fingerprintOf reads the one DTLS fingerprint an SDP commits to', () => {
  assert.equal(fingerprintOf(sdpWith(FP1)), FP1);
  assert.equal(fingerprintOf(sdpWith(FP1.toLowerCase().replace('SHA-256', 'sha-256'))), FP1, 'hex case is normalised');
  assert.equal(fingerprintOf(sdpWith(FP1, FP1)), FP1, 'the same fingerprint at session and media level is one');
  assert.equal(fingerprintOf(sdpWith(FP1).replace(/\r\n/g, '\n')), FP1, 'bare newlines too');
  assert.equal(fingerprintOf(sdpWith(FP1 + ' ')), FP1, 'trailing space');
  const padded = sdpWith(FP1); assert.equal(fingerprintOf(padded + 'x'.repeat(100000 - padded.length)), FP1, 'exactly the size cap');
  for (const bad of [null, 7, '', 'v=0', sdpWith(FP1, FP2), sdpWith(FP1) + 'x'.repeat(100000), sdpWith(FP1.slice(0, -3)),
    sdpWith(FP1.replace('sha-256', 'sha-1')), sdpWith(FP1 + ':AB'), sdpWith(FP1 + 'x'), 'xa=fingerprint:' + FP1]) {
    assert.equal(fingerprintOf(bad), null, String(bad).slice(0, 40));
  }
});

test('helloText binds the challenge to both keys and both ends of this link, and refuses anything malformed', () => {
  assert.equal(helloText(NONCE, KEY, KEY2, FP1, FP2), ['fallkard-forge trade hello v1', NONCE, KEY, KEY2, FP1, FP2].join('|'));
  assert.notEqual(helloText(NONCE, KEY, KEY2, FP1, FP2), helloText(NONCE, KEY2, KEY, FP1, FP2), 'who proves to whom is part of it');
  assert.notEqual(helloText(NONCE, KEY, KEY2, FP1, FP2), helloText(NONCE, KEY, KEY2, FP2, FP1), 'which end is which is part of it');
  assert.equal(helloText(NONCE, KEY, KEY2, FP1, FP1), null, 'two ends of one link never share a certificate');
  const asString = { toString: () => FP1 };
  for (const [n, a, b, p, v] of [[NONCE.slice(1), KEY, KEY2, FP1, FP2], [NONCE.toUpperCase(), KEY, KEY2, FP1, FP2], [null, KEY, KEY2, FP1, FP2],
    [NONCE, 'x', KEY2, FP1, FP2], [NONCE, KEY, 'x', FP1, FP2], [NONCE, null, KEY2, FP1, FP2], [NONCE, KEY, 5, FP1, FP2],
    [NONCE, KEY, KEY2, null, FP2], [NONCE, KEY, KEY2, FP1, undefined], [NONCE, KEY, KEY2, FP1.toLowerCase(), FP2],
    [NONCE, KEY, KEY2, FP1, FP2.slice(1)], [NONCE, KEY, KEY2, asString, FP2], [NONCE, KEY, KEY2, FP1, asString]]) {
    assert.equal(helloText(n, a, b, p, v), null, JSON.stringify([n, p, v]));
  }
});

test('a relayed proof does not verify: the relaying device cannot put the prover\'s certificate on its own link', () => {
  // Alice (KEY) proves on HER link to Mallory: her end FP1, Mallory's end FP2. Bob checks on HIS link to Mallory:
  // Mallory's end (as the prover) is some FP3, Bob's end FP4. The texts differ, so Alice's signature cannot serve.
  const FP3 = hexFp(3), FP4 = hexFp(4);
  const aliceSigned = helloText(NONCE, KEY, KEY2, FP1, FP2);
  const bobChecks = helloText(NONCE, KEY, KEY2, FP3, FP4);
  assert.ok(aliceSigned && bobChecks);
  assert.notEqual(aliceSigned, bobChecks);
});

test('admit refuses in order: transit → parse → seal → signature, and shows nothing that fails', () => {
  const good = { intact: true, isCard: true, sealOk: true, signed: true, sigOk: true, signer: KEY, sender: KEY, senderProven: true };
  const r = admit(good);
  assert.deepEqual([r.show, r.stage, r.from], [true, 'accepted', 'sender']);
  assert.equal(r.reason, 'the seal re-computed here matches, and it is signed by the device that sent it (that device proved its key on this link)');
  const at = (over) => { const v = admit({ ...good, ...over }); return [v.show, v.stage]; };
  assert.deepEqual(at({ intact: false, isCard: false, sealOk: false }), [false, 'transit']);
  assert.deepEqual(at({ isCard: false, sealOk: false }), [false, 'parse']);
  assert.deepEqual(at({ sealOk: false, sigOk: false }), [false, 'seal']);
  assert.deepEqual(at({ sigOk: false }), [false, 'signature']);
  for (const v of ['yes', 1, null, undefined]) {
    assert.deepEqual(at({ intact: v }), [false, 'transit'], 'intact ' + v);
    assert.deepEqual(at({ isCard: v }), [false, 'parse']);
    assert.deepEqual(at({ sealOk: v }), [false, 'seal']);
    assert.deepEqual(at({ sigOk: v }), [false, 'signature'], 'a signed card must verify literally');
  }
});

test('admit reasons are exact', () => {
  assert.equal(admit({}).reason, 'the picture changed on the way — its bytes are not the bytes that were sent');
  assert.equal(admit({ intact: true }).reason, 'not a card');
  assert.equal(admit({ intact: true, notCardWhy: 'bad signature' }).reason, 'not a card — bad signature');
  assert.equal(admit({ intact: true, isCard: true }).reason, 'the build inside is not the build that was sealed — refused, nothing shown');
  assert.equal(admit({ intact: true, isCard: true, sealOk: true, signed: true }).reason, 'these bytes are not what the named key signed — refused, nothing shown');
});

test('who a card is from is never taken on a claim, and each reason says only what was checked', () => {
  const base = { intact: true, isCard: true, sealOk: true };
  const unsigned = admit(base);
  assert.deepEqual([unsigned.show, unsigned.from], [true, 'unsigned']);
  assert.equal(unsigned.reason, 'the seal re-computed here matches; the card is unsigned — no key vouches for who forged it');
  assert.equal(admit({ ...base, signed: 'yes', sigOk: false }).from, 'unsigned', 'only a literal true means signed');
  const signed = { ...base, signed: true, sigOk: true, signer: KEY };
  const claimed = admit({ ...signed, sender: KEY, senderProven: false });
  assert.deepEqual([claimed.show, claimed.from], [true, 'claimed'], 'the right key, not yet proven: shown, not credited');
  assert.equal(claimed.reason, 'the seal re-computed here matches, and the signature verifies — signed by the key the sender named, but the sender has not proven it holds that key, so it is not credited');
  assert.equal(admit({ ...signed, sender: KEY, senderProven: 'true' }).from, 'claimed', 'only a literal true is proof');
  for (const proven of [true, false]) {
    const other = admit({ ...signed, sender: KEY2, senderProven: proven });
    assert.equal(other.from, 'other');
    assert.equal(other.reason, 'the seal re-computed here matches, and the signature verifies — signed by a key other than the one the sender named: a card it holds, passed on');
  }
});

test('nothing here throws', () => {
  const feed = makeAssembler();
  for (const h of [null, undefined, 0, NaN, 'x', [], {}, Symbol('s'), 10n, () => 1, new Proxy({}, {})]) {
    assert.doesNotThrow(() => { cardParts(h, h, h, h); feed(h); inviteIdOf(h); keyOfInviteId(h); fingerprintOf(h); helloText(h, h, h, h, h); admit(h); }, String(typeof h));
  }
  assert.equal(admit(null).stage, 'transit');
  assert.equal(admit('intact').stage, 'transit');
});
