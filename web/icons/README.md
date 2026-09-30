# App icon

`emblem.js` draws the Ghana Prisons Service crest as SVG: the black star, the
red, gold and green band, the black ring lettered GHANA PRISONS, and the
quartered shield with the lion and the motto scroll. It is a redrawing for
icon sizes, not a trace of the official artwork, so the four quarter charges
are simplified.

`render.js` writes `public/icon.svg` and the PNG sizes. The manifest uses the
PNGs (Android needs 192 and 512, both "any" and "maskable"), iOS reads
`apple-touch-icon.png` from `index.html`, and browsers take the SVG favicon.
