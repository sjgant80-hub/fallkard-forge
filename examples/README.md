# examples

| File | What it is |
|---|---|
| `hello.html` | the demo build — the payload |
| `seal-000.png` | the genesis card: `hello.html`, art generated from its own tags · depth 0 |
| `seal-001-quine.png` | **the quine** — a card carrying `reader.html`, the tool that reads cards · parent = genesis · depth 1 |

## Try it

```bash
node ../forge.mjs read seal-001-quine.png              # verify the seal
node ../forge.mjs read seal-001-quine.png --hatch out.html
```

Or open `../reader.html` in a browser and drop a card onto it for the full reveal, including the
fluency check: read the picture, predict the tags, then reveal.

## The lineage

```bash
node ../lineage.mjs audit .
```

```
depth  status   claimed   provable   card
1      linked   uncommon  uncommon   seal-001-quine.png
0      root     uncommon  uncommon   seal-000.png
✓ every claimed tier is backed by the deck
```

Depth 1 is what this deck can honestly prove, so depth 1 is what it claims. Reaching `rare`
(depth ≥ 2) means actually forking a card and building on it — not minting filler to inflate a
number. Manufacturing depth is the one thing the format is built to make visible.

## Prove nothing is hidden

The payload is announced, not concealed — ordinary tooling shows it:

```bash
strings seal-000.png | grep konomi
```

Only two named text chunks are added, immediately before `IEND`. The image data (`IHDR`/`IDAT`)
is copied through byte-identical, which the test suite asserts.

## The art is generated from the key

Both cards were forged with `--art`: THE EYE is rendered from the same tag string that is written
into the manifest, so a card whose picture contradicts its declared reading key cannot be
produced at all.

Read the quine card and check it yourself — owl high-left (witness-heavy), one blue rose (VERIFY
firing), a shallow depth-1 lattice, galaxy wings (zero-dep sovereign). That is an honest
description of `reader.html`: a verifier, zero dependencies, one fork deep.

Whether the tags honestly describe the *payload* remains a human judgement; only the
picture-matches-tags half is mechanical. That is why no tool ever awards `holo`.
