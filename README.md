# fallkard-forge

> An image that openly carries a real build. Four legible layers. Rarity by provenance.
> **Nothing is hidden — the only barrier is fluency, and fluency is learnable.**

A card is a normal PNG. It renders as a picture anywhere. It also carries, in **declared** PNG
text chunks, a gzipped single-file HTML build plus a manifest that says exactly what it is. Drop
the card into the reader and it decodes, verifies its `sha256` seal, prints what the picture
claims, and — only if you click — hatches the build into a sandboxed iframe.

There is no pixel steganography here and there never will be. The image bytes are untouched; the
payload is announced by name and listable with ordinary PNG tooling. Hiding payloads from
scanners is a non-goal and a non-feature.

**The format is published in full: [`CARD-SPEC.md`](CARD-SPEC.md).** Learn it and you can read
any card, verify it, and forge your own. That document *is* the initiation.

## The four layers

| Layer | | |
|---|---|---|
| 1 | **THE EYE** | it reads as art to anyone. no barrier. |
| 2 | **THE MANIFEST** | a declared payload — a real single-file build hatches from it. |
| 3 | **THE READING KEY** | the composition encodes what the build *is*; a fluent reader predicts it by eye. |
| 4 | **THE PROVENANCE** | sha256 seal + fork lineage. rarity is earned depth. |

## Use

```bash
# forge a build into a card image
node forge.mjs forge --build tool.html --image card.png \
  --tags "owl:high-left,rose:purple+red+blue:5,geo:depth3,wings:galaxy" \
  --assessor-pass --out seal-000.png

# verify a card, and optionally hatch it
node forge.mjs read seal-000.png
node forge.mjs read seal-000.png --hatch out.html
```

Open `reader.html` in a browser and drop a card on it for the full reveal ritual, including the
**fluency check**: predict the tags from the picture alone, then reveal and see how you scored.

```bash
# walk a deck's fork-lineage and check every claimed tier against what it can prove
node lineage.mjs audit examples
```

The lineage walker computes depth from `parent` links and reports **overclaims** — any card
asserting a tier the deck cannot show. An absent ancestor proves nothing, a cycle proves nothing,
and a card whose payload fails its seal is inadmissible provenance. The tool will never *award*
`holo`: that needs an honest reading-key match, which is a fluency judgement no program can make,
so it reports **holo-eligible** and leaves the award to a human.

## The quine

`examples/seal-001-quine.png` carries `reader.html` — **a card that hatches the reader that reads
cards.** Its parent is the genesis card, so the deck proves it at depth 1. Construction material
and constructed surface are the same object.

```bash
npm test    # 15 assertions: round trip, pixel identity, tamper detection, reader conformance
```

## What is guaranteed

- the hatched build is **byte-identical** to the source build
- the picture is **pixel-identical** to the source image (`IHDR`/`IDAT` untouched)
- a tampered payload **fails its seal** and is refused
- the reader **never auto-runs** anything; hatching is explicit and sandboxed
- rarity is **computed from evidence**, never asserted — depth without a verify pass earns nothing

## Status

`v0.1` — format and implementation. The local forge → read → hatch round trip is proven.
Survival of PNG metadata through any given platform is an empirical, per-platform question; the
spec therefore defines a hash-resolvable fallback (`CARD-SPEC` §7) from the start rather than
bolting one on after the first stripped card.

Zero dependencies · MIT · single-file components.
