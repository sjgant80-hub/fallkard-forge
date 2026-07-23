# fallkard-forge · implementation design note

> This is the design note for the **implementation**. The wire format itself — chunk layout,
> manifest schema, reading key, rarity, conformance — is published separately in
> [`CARD-SPEC.md`](CARD-SPEC.md), which is the normative document.

## Purpose

Turn a single-file HTML build plus a card image into one PNG that (a) still renders as the same
picture, (b) openly carries the build, and (c) can be verified and hatched by anyone who has the
published format.

## Why Mode B

Two designs were considered.

**Mode A** — encode payload bytes into the pixels (LSB steganography). Rejected: it does not
survive recompression, so the first platform that re-encodes the image destroys the build. It is
also a concealment technique, and concealment is explicitly not what this format is for.

**Mode B** (built) — the payload rides in standard PNG ancillary text chunks and is *declared*.
It survives anything that preserves metadata, is listable by ordinary tooling, and keeps the
image bytes untouched. Where a platform strips chunks, the format degrades to a hash-resolvable
reference (`CARD-SPEC` §7) rather than to a corrupted image.

## Structure

| File | Role |
|---|---|
| `forge.mjs` | library + CLI. Chunk plumbing, forge, read, rarity. Zero dependencies. |
| `reader.html` | single-file reader. Decode, verify, reading-key, fluency check, sandboxed hatch. |
| `CARD-SPEC.md` | the normative wire format — the published "language". |
| `test.mjs` | the round trip and the conformance assertions. |

## Data model

A card is the source PNG with exactly two chunks inserted before `IEND`:

- `konomi-payload` (`zTXt`) — `base64(gzip(build))`, then zlib-compressed by the chunk itself.
- `konomi-manifest` (`tEXt`) — the JSON manifest.

`IHDR` and `IDAT` are copied through unmodified. The seal is `sha256` over the **gzipped payload
bytes**, so verification needs no decompression.

## Invariants

1. **Pixels are never touched.** `IHDR`/`IDAT` in equals `IHDR`/`IDAT` out, asserted by test.
2. **The payload is declared.** Both chunks carry their documented keywords and are listable.
3. **Idempotent re-forge.** Forging a card again replaces its card chunks; duplicates never
   accumulate.
4. **Deterministic.** Same build, image, tags and `forged` date produce a byte-identical card.
   (`forged` defaults to today; pass it explicitly for reproducible output.)
5. **Rarity is computed, not asserted.** `forge()` stamps the tier that `rarity()` can prove
   from `assessor_pass` and lineage depth. Depth without a verify pass earns nothing.
6. **Verification gates hatching.** A seal mismatch refuses the hatch, in both CLI and reader.
7. **Zero dependencies.** `node:zlib`, `node:crypto`, `node:fs` only.

## Safety posture

The reader never auto-runs a payload: hatching requires an explicit click and renders into an
iframe sandboxed with `allow-scripts` **and without** `allow-same-origin`, so a hatched build
cannot reach the reader page. These are conformance requirements in `CARD-SPEC.md` §8 and are
enforced by assertions in `test.mjs`, not left to reviewer discipline.

## Testing

`node --test test.mjs` — 15 assertions covering the round trip, seal semantics, pixel identity,
chunk declaration, tamper detection, idempotence, CRC validity, rarity tiers, determinism, and
reader conformance. CI runs the same on every push.

## Versioning

`SPEC_VERSION` in `forge.mjs` tracks the **wire format** (currently `0.1`) and appears as `v` in
every manifest. A change to the chunk layout, manifest schema, or seal definition is a wire-format
bump and must be reflected in `CARD-SPEC.md`. Package `version` tracks the implementation.
