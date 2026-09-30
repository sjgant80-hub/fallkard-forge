// art-band.test.mjs — the Node forge prints the visible seal (CARD-SPEC §7.1) exactly where the spec says, and a
// reader gets the code back from the PNG's own pixels. Pinned to the pixel, so the band cannot drift a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { renderCard } from './art.mjs';
import { parseChunks } from './png.mjs';
import { sealCode, readBand, BAND_PAPER, BAND_INK } from './sealmark.mjs';

const SEAL = '3f9a0c21d4e87b65a10f2c3d4e5f60718293a4b5c6d7e8f90112233445566778';
const TAGS = 'owl:high-left,rose:blue+red:3,wings:galaxy';

// the art encoder writes truecolour RGB with filter 0 on every row, so pixels can be read straight off
const pixels = (png) => {
  const cs = parseChunks(png), ihdr = cs.find((c) => c.type === 'IHDR').data;
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4);
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const at = (x, y) => { const i = y * (1 + w * 3) + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
  return { w, h, at, luma: (x, y) => { const xx = Math.floor(x), yy = Math.floor(y); if (xx < 0 || yy < 0 || xx >= w || yy >= h) return undefined; const p = at(xx, yy); return 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]; } };
};

test('the band sits exactly at x 20..419, y 556..591 in paper', () => {
  const p = pixels(renderCard({ tags: TAGS, seal: SEAL }));
  for (const [x, y] of [[20, 556], [419, 556], [20, 591], [419, 591], [30, 570]]) assert.deepEqual(p.at(x, y), BAND_PAPER, x + ',' + y);
  for (const [x, y] of [[19, 556], [420, 556], [20, 555], [20, 592], [419, 592], [420, 591]]) assert.notDeepEqual(p.at(x, y), BAND_PAPER, x + ',' + y);
});

test('each ink dot is exactly 3×3', () => {
  assert.equal(sealCode(SEAL).slice(0, 1), '7');
  const p = pixels(renderCard({ tags: TAGS, seal: SEAL }));
  // '7', row 1 is '....#': the dot at column 4 fills x 62..64, and column 5 is the gap
  for (const x of [62, 63, 64]) assert.deepEqual(p.at(x, 566), BAND_INK, 'x ' + x);
  assert.deepEqual(p.at(65, 566), BAND_PAPER);
  assert.deepEqual(p.at(61, 566), BAND_PAPER);
  // '7', row 6 is '.#...': the dot at column 1 fills y 581..583, and nothing is below it
  for (const y of [581, 582, 583]) assert.deepEqual(p.at(53, y), BAND_INK, 'y ' + y);
  assert.deepEqual(p.at(53, 584), BAND_PAPER);
});

test('the code reads back off the rendered PNG, and a non-seal prints no band', () => {
  const p = pixels(renderCard({ tags: TAGS, seal: SEAL }));
  assert.equal(readBand(p.luma, p.w, p.h).read, sealCode(SEAL));
  const q = pixels(renderCard({ tags: TAGS, seal: 'not-a-seal' }));
  assert.notDeepEqual(q.at(20, 556), BAND_PAPER);
  assert.equal(readBand(q.luma, q.w, q.h).unknown, 16);
});
