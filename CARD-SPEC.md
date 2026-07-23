# CARD-SPEC v0.1 — the fallkard elite card format

> An image that openly carries a real build. Four legible layers. Rarity by provenance.
> **Nothing is hidden. The only barrier is fluency, and fluency is learnable — that is the point.**

Learn this document and you can read any card, verify it, and forge your own. That is the
whole initiation. There is no private key to the format, no obfuscation step, no gate.

---

## 0 · What a card is

A standard PNG. It renders as a picture in any viewer. It additionally carries, in **declared
PNG text chunks**, a gzipped single-file build and a manifest describing it.

The payload is **announced**, never concealed. Any tool that lists PNG chunks (`pngcheck`,
ImageMagick, a hex editor) will show it by name. This format explicitly **does not** use LSB or
pixel steganography: the image data is byte-identical to the source image, and hiding payloads
from scanners is a non-goal and a non-feature.

## 1 · The four layers

| Layer | Name | What it means |
|---|---|---|
| 1 | **THE EYE** | It reads as art to anyone. No barrier, no explanation needed. |
| 2 | **THE MANIFEST** | A declared payload — a real single-file build hatches from it. |
| 3 | **THE READING KEY** | The composition encodes what the build *is*. A fluent reader predicts the payload by eye — and is right. |
| 4 | **THE PROVENANCE** | sha256 seal + fork lineage. Rarity = earned depth. |

Elite = all four present and legible. **Concealment is not a layer.**

## 2 · Chunk layout

```
konomi-payload    zTXt    base64( gzip( build.html ) )
konomi-manifest   tEXt    JSON manifest (below)
```

Both chunks are inserted immediately before `IEND`. `IHDR` and `IDAT` are copied through
untouched, so the rendered picture is pixel-identical to the source image. Re-forging replaces
the card chunks rather than appending, so a card never accumulates duplicates.

`zTXt` is zlib-compressed (`keyword \0 compressionMethod=0 <zlib data>`); `tEXt` is plain
(`keyword \0 text`). Both are standard, documented PNG ancillary chunks.

## 3 · Manifest schema

```json
{
  "v": "0.1",
  "seal": "<sha256 hex of the GZIPPED payload bytes>",
  "parent": "<seal of the parent card | null>",
  "tags": "owl:high-left,rose:purple:5,geo:depth3",
  "rarity": "holo",
  "assessor_pass": true,
  "forged": "2026-07-23"
}
```

`seal` is taken over the **gzipped** payload bytes (what actually rides in the chunk), so a
reader can verify without decompressing anything. Verification is: base64-decode the payload
chunk, sha256 it, compare to `seal`. Mismatch ⇒ the card is tampered and **must not hatch**.

## 4 · The reading key — composition → meaning

**v0.1 draft. These are slots, not law** — tune the rows against the seed; the mechanism is
what's fixed, not the vocabulary.

| Visual element | Encodes | Example → meaning |
|---|---|---|
| owl position | witness weight (κ strength) | `owl:high-left` = witness-heavy build |
| owl present / absent | has a verify pass / doesn't | present = assessor-gated |
| rose colour set | which solids fire | `rose:purple+red+blue` = INIT/BUILD/VERIFY |
| rose count | lifecycle stages held | `rose:*:5` = all five solids |
| background geometry | provenance depth | deeper lattice = deeper fork |
| plasma filament count | payload size band | more filaments = bigger build |
| wings (galaxy vs bare) | sovereign / dependent | galaxy wings = fully local, zero-dep |

**The elite claim:** a fluent reader decodes `tags` from the *picture alone*, and the reader tool
confirms whether they were right.

**Reading-key integrity (the anti-polonium rule):** the forger must set tags that honestly
describe *both* the picture and the payload. A card whose picture claims one thing while its
payload is another is a lie in a format whose entire premise is legibility. Such a card fails the
fluency check and does not qualify for `holo` at any depth.

## 5 · Rarity — earned and verifiable

```
common    valid seal, shallow or no lineage
uncommon  valid seal + assessor_pass
rare      assessor_pass + provenance depth >= 2
holo      assessor_pass + provenance depth >= 3 + honest reading-key match
```

Depth is walked from `parent` links across the card graph. Rarity is **computed, never
asserted** — `forge()` stamps the tier it can prove. Depth without a verify pass buys nothing.
This is a real holo: openly special because it is checkable, not scarce because someone said so.

## 6 · Hatching

The reader **never auto-runs a payload.** Hatching is explicit and user-initiated, and the build
is opened in a sandboxed iframe. A card that fails its seal is refused. These are format
requirements, not implementation preferences — a reader that auto-executes is not conformant.

## 7 · Metadata survival & the registry fallback

Some platforms strip PNG ancillary chunks on upload. When `konomi-manifest` is absent, a
conformant reader falls back to the **visible seal hash**: the card's printed seal resolves the
payload from a local manifest file or from fall-registry. A stripped card therefore still
verifies by hash even when the embedded bytes are gone.

**Round-trip status:** the local forge→read→hatch cycle is proven byte-identical (see
`test.mjs`, 11 assertions). Survival through any specific platform is an empirical question per
platform and must be measured, not assumed — which is exactly why the fallback is specified
from the start rather than bolted on after the first stripped card.

## 8 · Conformance

A conformant implementation must:

1. leave `IHDR`/`IDAT` byte-identical (no pixel steganography, ever);
2. name both chunks exactly `konomi-payload` and `konomi-manifest`;
3. seal over the gzipped payload bytes;
4. refuse to hatch on seal mismatch;
5. never hatch without an explicit user action, and always sandbox;
6. compute rarity rather than accept an asserted tier.
