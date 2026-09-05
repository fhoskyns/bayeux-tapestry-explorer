# Opening sequence provenance

The 2.6-second opening is a stylised geographic journey, not a literal museum interior. It refers to the British Museum loan exhibition announced for September 2026–July 2027, not permanent ownership. Source: https://www.britishmuseum.org/exhibitions/bayeux-tapestry (accessed 2026-09-05).

## Map

- Natural Earth 1:110 million land GeoJSON: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson
- Dataset and terms: https://www.naturalearthdata.com/downloads/110m-physical-vectors/110m-land/ and https://www.naturalearthdata.com/about/terms-of-use/
- Public domain. Downloaded 2026-09-05; source SHA-256 `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`.
- `public/intro-world.svg`: equirectangular conversion, x = longitude + 180, y = 90 − latitude, rounded to 3 decimal places; no invented coastlines. SVG SHA-256 `edd8602af600a94530be424ccc2a20618862a4adedb58d09e33c213fafae54f5`.
- Approximate map destination: 51.5195, −0.1269. Historic England primary location record gives grid reference TQ 30054 81721: https://historicengland.org.uk/listing/the-list/list-entry/1130404 . This low-resolution locator is not a street map.

## Photograph

- British Museum Facade.JPG, Ludi Ling, 2008-07-03.
- Source: https://commons.wikimedia.org/wiki/File:British_Museum_Facade.JPG
- Thumbnail: https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/British_Museum_Facade.JPG/1280px-British_Museum_Facade.JPG
- CC BY-SA 3.0: https://creativecommons.org/licenses/by-sa/3.0/
- `public/british-museum-facade.jpg`, 1280 × 851, SHA-256 `cbd0caf7aff4a59969e3aa4b03a3eacfaa5ed26e3106864c86bde7cf49190e1e`.
- Resized by Wikimedia Commons; cropped by CSS for the viewport. No retouching. The photograph and display adaptation retain CC BY-SA 3.0, excluded from the MIT code and CC BY-NC-SA editorial licences.

Both assets are self-hosted. The introduction has no live map API or metered map dependency. Its optional `bayeux:arrival-seen:v1` localStorage preference stays on the device. Reduced-motion visits bypass animation, direct scene links bypass it, and Home never replays it.
