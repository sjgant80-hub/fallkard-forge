# examples

| File | What it is |
|---|---|
| `hello.html` | the demo build — the payload |
| `seal-000.png` | the genesis card: `hello.html`, art generated from its own tags · depth 0 |
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

## The art is generated from the key

Both cards use : THE EYE is rendered from the same tag string written into the
manifest, so the picture cannot contradict its declared reading key. Read the quine card —
owl high-left (witness-heavy), one blue rose (VERIFY firing), a shallow depth-1 lattice, galaxy
wings (zero-dep sovereign) — and that is an honest description of .

Whether the tags honestly describe the *payload* is still a human judgement; only the
picture-matches-tags half is mechanical. That is why no tool awards .
