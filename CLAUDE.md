# CLAUDE.md · fallkard-forge

Instructions for any agent working in this repository.

## What this is

A zero-dependency toolchain for **Mode B** cards: a PNG that openly carries a gzipped single-file
HTML build in declared text chunks. `forge.mjs` is the library + CLI, `reader.html` is the
single-file reader, [`CARD-SPEC.md`](CARD-SPEC.md) is the normative wire format, and
[`SPEC.md`](SPEC.md) is the implementation design note. Read both specs before changing anything.

## Hard rules — these are the point of the format, not preferences

1. **Never add pixel steganography.** `IHDR`/`IDAT` must pass through byte-identical. The payload
   lives in named, declared chunks. Any change that hides bytes in image data, or that removes the
   manifest so a payload rides undeclared, is out of scope for this project — do not implement it.
2. **The reader never auto-runs a payload.** Hatching stays explicit and user-initiated, always
   into an iframe sandboxed `allow-scripts` **without** `allow-same-origin`.
3. **Verification gates hatching.** A seal mismatch is refused, never warned-and-continued.
4. **Rarity is computed.** `forge()` stamps what `rarity()` can prove. Never let a caller assert a
   tier it has not earned; depth without `assessor_pass` earns nothing.
5. **Zero dependencies.** `node:zlib`, `node:crypto`, `node:fs` only. No packages.
6. **Reading-key integrity.** Tags must honestly describe both the picture and the payload. A card
   whose picture claims one thing while carrying another defeats the entire premise.

## Invariants to preserve

- round trip: `hatch(forge(build)) === build`, byte for byte
- forging is deterministic given an explicit `--forged` date
- re-forging replaces card chunks rather than appending duplicates
- the seal is `sha256` of the **gzipped** payload bytes (verifiable without decompressing)

## How to run

```bash
npm test              # node --test test.mjs
node forge.mjs read <card.png>
```

CI (`.github/workflows/ci.yml`) runs `npm test` on every push. A change that reddens CI does not
ship. The reader's safety properties are asserted in `test.mjs` — if you change `reader.html`,
those assertions must still pass.

## Versioning

`SPEC_VERSION` in `forge.mjs` is the **wire format** version and is stamped into every manifest as
`v`. Changing the chunk layout, manifest schema, or seal definition is a wire-format bump and must
be mirrored in `CARD-SPEC.md`.
