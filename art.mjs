#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// art.mjs · THE EYE — card art generated FROM the reading key
//
// CARD-SPEC §4 requires a card's composition to honestly describe its payload. Stated as a rule,
// that is a promise someone can break. Generated this way it is STRUCTURAL: the picture is
// derived from the same tag string that goes into the manifest, so a card whose art disagrees
// with its declared reading key cannot be produced by this tool at all.
//
// Deterministic: (tags, seal) → the same pixels, always. The seal seeds the jitter, so every card
// is visually unique without ever being random.
//
// This does not make the tags TRUE of the payload — a forger can still declare tags that misread
// their own build. It removes the other failure: art that contradicts its own declared key.
//
// Zero dependencies. Raw RGB raster → deflate → PNG.
// ════════════════════════════════════════════════════════════════

import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { serialise } from './png.mjs';

// the five solids → their colours (CARD-SPEC §4: rose colour set = which solids fire)
export const SOLID_COLOURS = {
  purple: [167, 139, 250],   // INIT
  red:    [248, 113, 113],   // BUILD
  blue:   [96, 165, 250],    // VERIFY
  gold:   [251, 191, 36],    // REMEMBER
  green:  [74, 222, 128],    // EXPLORE
};

const PHI = (1 + Math.sqrt(5)) / 2;
const GOLDEN_ANGLE = 360 / (PHI * PHI);        // ≈137.508°

// ── deterministic PRNG seeded from the card seal (never Math.random) ──────
function seededRng(seed) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}

// ── parse the reading key into a render plan ─────────────────────────────
export function planFromTags(tags) {
  const parts = Object.create(null);
  for (const t of String(tags || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [k, a, b] = t.split(':');
    parts[k] = { a: a || '', b: b || '' };
  }
  const owl = parts.owl;
  return {
    // owl present ⇒ assessor-gated. position ⇒ witness weight.
    owl: owl ? { present: true, high: /high/.test(owl.a), left: /left/.test(owl.a) } : { present: false },
    // rose colour set ⇒ which solids fire; count ⇒ lifecycle stages held
    solids: parts.rose ? parts.rose.a.split('+').filter(c => SOLID_COLOURS[c]) : [],
    roseCount: parts.rose && parts.rose.b ? Math.max(0, Math.min(5, parseInt(parts.rose.b, 10) || 0)) : 0,
    // background lattice depth ⇒ provenance depth
    depth: parts.geo ? Math.max(0, Math.min(7, parseInt(String(parts.geo.a).replace(/\D/g, ''), 10) || 0)) : 0,
    // filament count ⇒ payload size band
    filaments: parts.plasma ? Math.max(0, Math.min(24, parseInt(parts.plasma.a, 10) || 0)) : 0,
    // wings ⇒ sovereign (galaxy) or dependent (bare)
    galaxy: parts.wings ? /galaxy/.test(parts.wings.a) : false,
  };
}

// ── raster helpers ───────────────────────────────────────────────────────
const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v | 0;

function makeCanvas(w, h) {
  return { w, h, px: new Uint8Array(w * h * 3) };
}
function blend(c, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= c.w || y >= c.h || alpha <= 0) return;
  const i = (y * c.w + x) * 3, a = alpha > 1 ? 1 : alpha;
  c.px[i]     = clamp255(c.px[i]     * (1 - a) + rgb[0] * a);
  c.px[i + 1] = clamp255(c.px[i + 1] * (1 - a) + rgb[1] * a);
  c.px[i + 2] = clamp255(c.px[i + 2] * (1 - a) + rgb[2] * a);
}
function ring(c, cx, cy, r, rgb, alpha, thickness = 1.2) {
  const steps = Math.max(24, Math.ceil(2 * Math.PI * r));
  for (let s = 0; s < steps; s++) {
    const t = (s / steps) * 2 * Math.PI;
    for (let d = -thickness; d <= thickness; d += 0.5) {
      blend(c, Math.round(cx + Math.cos(t) * (r + d)), Math.round(cy + Math.sin(t) * (r + d)), rgb, alpha);
    }
  }
}
function disc(c, cx, cy, r, rgb, alpha) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const d = Math.sqrt(x * x + y * y);
    if (d <= r) blend(c, Math.round(cx + x), Math.round(cy + y), rgb, alpha * (1 - d / r) ** 0.6);
  }
}
function line(c, x0, y0, x1, y1, rgb, alpha) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = steps ? s / steps : 0;
    blend(c, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), rgb, alpha * (1 - Math.abs(t - 0.5)));
  }
}

// ── PNG encode (truecolour, filter 0) ────────────────────────────────────
export function encodePng(c) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                       // 8-bit truecolour RGB
  const raw = Buffer.alloc(c.h * (1 + c.w * 3));
  for (let y = 0; y < c.h; y++) {
    raw[y * (1 + c.w * 3)] = 0;                   // filter: none
    Buffer.from(c.px.buffer, y * c.w * 3, c.w * 3).copy(raw, y * (1 + c.w * 3) + 1);
  }
  return serialise([
    { type: 'IHDR', data: ihdr },
    { type: 'IDAT', data: deflateSync(raw, { level: 9 }) },
    { type: 'IEND', data: Buffer.alloc(0) },
  ]);
}

// ── the render · every mark below is driven by a tag ─────────────────────
export function renderCard({ tags, seal = '', width = 440, height = 616 }) {
  const plan = planFromTags(tags);
  const rng = seededRng(seal || tags || 'genesis');
  const c = makeCanvas(width, height);
  const cx = width / 2, cy = height / 2;

  // ground: a quiet vertical field, darker at the edges
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const edge = Math.min(x, y, width - x, height - y) / 60;
    const v = 8 + 14 * Math.min(1, edge) + 10 * (1 - y / height);
    blend(c, x, y, [v * 0.7, v * 0.75, v * 1.25], 1);
  }

  // LATTICE · provenance depth. deeper fork ⇒ more rings, denser weave.
  const rings = plan.depth + 2;
  for (let i = 1; i <= rings; i++) {
    const r = (Math.min(width, height) * 0.09) * i * (1 + plan.depth * 0.06);
    ring(c, cx, cy, r, [90, 105, 170], 0.16 + 0.05 * (rings - i) / rings, 0.8);
  }
  for (let i = 0; i < 6 * Math.max(1, plan.depth); i++) {           // the weave
    const t = (i / (6 * Math.max(1, plan.depth))) * 2 * Math.PI;
    const R = Math.min(width, height) * 0.09 * rings * (1 + plan.depth * 0.06);
    line(c, cx + Math.cos(t) * R, cy + Math.sin(t) * R, cx - Math.cos(t) * R, cy - Math.sin(t) * R, [80, 95, 160], 0.10);
  }

  // WINGS · galaxy = sovereign (zero-dep), bare = dependent
  if (plan.galaxy) {
    // two swept arcs, one per side — a tag that does not visibly change the art is a reading
    // key lying by omission, so the wings must actually read as wings.
    for (const side of [-1, 1]) {
      for (let s = 0; s < 420; s++) {
        const t = s / 420;                                   // 0..1 along the wing
        const spread = Math.sin(t * Math.PI) ** 0.8;         // fat in the middle, tapered at tips
        const a = -0.55 * Math.PI + t * 1.10 * Math.PI;      // sweep from high to low
        const rad = width * (0.24 + 0.26 * spread) + (rng() - 0.5) * 34 * spread;
        const x = cx + side * Math.abs(Math.cos(a)) * rad;
        const y = cy + Math.sin(a) * height * 0.30 + (rng() - 0.5) * 26 * spread;
        const bright = 0.30 + 0.55 * spread * rng();
        blend(c, Math.round(x), Math.round(y), [226, 232, 255], bright);
        if (rng() > 0.86) {                                  // a few brighter stars with flare
          blend(c, Math.round(x) + 1, Math.round(y), [200, 210, 255], bright * 0.6);
          blend(c, Math.round(x), Math.round(y) + 1, [200, 210, 255], bright * 0.6);
        }
      }
    }
  }

  // FILAMENTS · payload size band
  for (let f = 0; f < plan.filaments; f++) {
    const a = f * (GOLDEN_ANGLE * Math.PI / 180);
    const r0 = Math.min(width, height) * 0.12, r1 = Math.min(width, height) * (0.34 + rng() * 0.12);
    line(c, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, [140, 120, 220], 0.45);
  }

  // ROSES · one per lifecycle stage held, on the golden-angle spiral, coloured by solids fired
  const palette = plan.solids.length ? plan.solids.map(s => SOLID_COLOURS[s]) : [[120, 130, 160]];
  for (let i = 0; i < plan.roseCount; i++) {
    const a = i * (GOLDEN_ANGLE * Math.PI / 180);
    const rad = Math.min(width, height) * 0.085 * Math.sqrt(i + 1) * 1.5;
    const rx = cx + Math.cos(a) * rad, ry = cy + Math.sin(a) * rad;
    const col = palette[i % palette.length];
    disc(c, rx, ry, 15, col, 0.55);
    ring(c, rx, ry, 15, col, 0.75, 1.0);
    ring(c, rx, ry, 9, col, 0.5, 0.8);
  }

  // OWL · present ⇒ has a verify pass. position ⇒ witness weight.
  if (plan.owl.present) {
    const ox = plan.owl.left ? width * 0.27 : width * 0.73;
    const oy = plan.owl.high ? height * 0.22 : height * 0.72;
    const eye = [232, 236, 250];
    for (const dx of [-13, 13]) {
      disc(c, ox + dx, oy, 11, eye, 0.85);
      ring(c, ox + dx, oy, 11, [255, 255, 255], 0.9, 1.2);
      disc(c, ox + dx, oy, 4, [16, 18, 26], 0.95);
    }
    for (let i = 0; i < 9; i++) line(c, ox, oy + 6 + i, ox - 5 + i * 0.6, oy + 15 + i, [232, 236, 250], 0.5);
  }

  return encodePng(c);
}

// ── CLI ──────────────────────────────────────────────────────────────────
function cli(argv) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv[2] !== 'render') { console.error('usage: node art.mjs render --tags "..." [--seal <hex>] --out card.png'); process.exit(2); }
  const out = arg('--out', 'card.png');
  writeFileSync(out, renderCard({ tags: arg('--tags', ''), seal: arg('--seal', '') }));
  console.log(`rendered ${out} from the reading key: ${arg('--tags', '(none)')}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) cli(process.argv);
