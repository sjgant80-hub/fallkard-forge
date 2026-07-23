# examples

| File | What it is |
|---|---|
| `hello.html` | the demo build — the payload |
| `card-blank.png` | the source card image, **placeholder art** (generated) |
| `seal-000.png` | the genesis card: `card-blank.png` carrying `hello.html` · depth 0 |
| `seal-001-quine.png` | **the quine** — a card carrying `reader.html`, the tool that reads cards · parent = genesis · depth 1 |

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

## Try it

```bash
node ../forge.mjs read seal-000.png            # verify the seal
node ../forge.mjs read seal-000.png --hatch /tmp/out.html
```

Or open `../reader.html` in a browser and drop `seal-000.png` onto it — that gives you the full
reveal, including the fluency check: read the picture, predict the tags, then reveal.

This card's declared tags are:

```
owl:high-left,rose:purple+red+blue:5,geo:depth1,wings:galaxy
```

## Prove nothing is hidden

The payload is announced, not concealed — you can see it with ordinary tooling:

```bash
# the chunk keywords are plain text in the file
strings seal-000.png | grep konomi
```

The image data is untouched: `seal-000.png` renders pixel-for-pixel identically to
`card-blank.png`. Only two named text chunks were added before `IEND`.

## A note on the art

`card-blank.png` is a **generated placeholder**, not the real card art. Layer 1 (THE EYE) and a
composition that honestly encodes the reading key are still to come — and per `CARD-SPEC.md` §4,
a card's tags must honestly describe both its picture and its payload. This example's tags
describe the *format demo*, so treat them as illustrative of the mechanism rather than as a
fluency exercise against real art.
