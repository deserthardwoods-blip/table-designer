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
