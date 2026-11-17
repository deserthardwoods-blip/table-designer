# Desert Hardwoods — Resin Table Designer

Code for the "Design your table" page on deserthardwoods.com.

- `rtd.js` – the designer (vanilla JS, no dependencies)
- `rtd.css` – its styles

The Shopify theme loads these through jsDelivr at a tagged version, e.g.
`https://cdn.jsdelivr.net/gh/deserthardwoods-blip/table-designer@v1/rtd.js`.
Which version customers see is set in the store's `rtd.version` shop metafield;
the private test page uses `rtd.preview_version`. To release: tag a new version,
try it on the test page, then point `rtd.version` at it. To roll back, point it
at the previous tag.

## Cutouts

`tools/make_cutouts.py` makes a background-free photo of every in-stock piece
(rembg `isnet-general-use`), keeps only the wood (rulers, grass and labels
beside it are dropped), lays the long side horizontal, and saves
`cutouts/<variant id>.webp` plus `cutouts/index.json` (file, outline, source
photo). The designer reads these from `@main`, so new cutouts show up without a
code release (jsDelivr refreshes `@main` within about 12 hours).

    pip install "rembg[cpu]" onnxruntime pillow numpy scipy
    python3 tools/make_cutouts.py            # new + changed pieces, prunes sold ones
    python3 tools/make_cutouts.py --only ID  # redo one variant

To use your own cutout for a piece, add a product photo with `cutout` in its
file name (a PNG with a transparent background); the script uses it as-is.
