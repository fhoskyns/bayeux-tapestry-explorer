# Opening sequence provenance

The 2.6-second opening is a continuous overhead globe-to-museum camera descent, not a façade photograph or a museum interior reconstruction. It refers to the British Museum loan exhibition announced for September 2026–July 2027, not permanent ownership. Source: https://www.britishmuseum.org/exhibitions/bayeux-tapestry (accessed 2026-09-05).

## Genuine, georeferenced imagery

- Destination: Great Court, British Museum, longitude −0.1269, latitude 51.5195. Historic England location record: https://historicengland.org.uk/listing/the-list/list-entry/1130404 .
- All textures use north-up equirectangular WGS84 bounds, in `[west, south, east, north]` order. The renderer samples their real coordinates on a sphere; it does not stretch them to viewport proportions.
- Detailed output dimensions, bounds, checksums and source URLs are in `data/arrival-imagery.json`. Access date for every source: 2026-09-05.

### NASA world, Britain and southeast England

Blue Marble Next Generation, August 2004 satellite composite. Credit: NASA Earth Observatory / Reto Stöckli; regional imagery via NASA GIBS.

- Dataset: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Open-use guidance: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance
- Global source: `world.200408.3x5400x2700.jpg`, 5400×2700, SHA-256 `2048023ccc62250c677c0f4b03d4362f997b130eb0154a6cad00aa1b27c390b9`.
- Regional sources use GIBS `BlueMarble_NextGeneration`, EPSG:4326, time `2004-08-01`. Native detail is approximately 500m, not building-scale imagery.

### EOX London satellite mosaic

EOxCloudless by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0. Geographic crop of the **2016** `s2cloudless` mosaic; later-year licences must not be assumed interchangeable.

- Source: https://cloudless.eox.at
- Licence explanation: https://eox.at/2025/03/sentinel-2-cloudless-2024/#license
- Licence: https://creativecommons.org/licenses/by/4.0/
- Source crop SHA-256 `6fea6dcd9efad66e633c75ae5d7ced17aaf073d3a401fc948d80b7b87488edb3`.

### Environment Agency museum and neighbourhood

RGB vertical aerial survey, 2007-08-25 to 2008-10-18, catalogued 2008. Credit: © Environment Agency copyright and/or database right 2022. All rights reserved. Open Government Licence v3.0.

- Dataset: https://environment.data.gov.uk/dataset/dae203a8-ba24-4c54-bab0-866b9faadb58
- Licence: https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/
- Account-free source archives: `https://environment.data.gov.uk/tiles/collections/survey/vertical_aerial_photography_tiles_rgb/2008/0.4/TQ3080?subscription-key=dspui` and the western `https://environment.data.gov.uk/tiles/collections/survey/vertical_aerial_photography_tiles_rgb/2008/0.4/TQ2580?subscription-key=dspui`. `dspui` is the public downloader's identifier, not a client credential.
- Source frames: `Ortho_RGB_P00012452_20070825_20081018_40cm_res.ecw` and `Ortho_RGB_P00012498_20070825_20081018_40cm_res.ecw`.
- Original frame CRS: EPSG:27700, OSGB36 British National Grid, 0.4m pixels. Valid neighbouring crops were mosaicked without retouching, then bilinearly reprojected to EPSG:4326 with pyproj. The independent MIT `ecw2tiff` 0.1.1 decoder was used, not a proprietary SDK.
- An unrelated northwest source block could not be decoded. It was excluded, never reconstructed. The supplied city rectangle and centred museum texture are wholly covered by valid pixels; edges blend into the licensed lower-resolution satellite layer.
- Before delivery compression, city derivative SHA-256 `fc38be8e3dd43a37650bb155358df6100947044e1720fba0ac3308d19186c805`; museum derivative SHA-256 `1d66e29f2cad6aab99dc1cb313e70ae57c8de2d802b72f87a6d61877a10fc12b`.

Decoded source crops, using `ecw2tiff [arguments] source.ecw output.tif`:

| Output | Source frame | Arguments |
|---|---|---|
| southwest.tif | P00012452 | `--region 2500,0,2500,3400 --scale 2 --threads 1` |
| southeast.tif | P00012498 | `--region 0,0,2800,3400 --scale 2 --threads 1` |
| detail-west.tif | P00012452 | `--region 4500,0,500,1300 --threads 1` |
| detail-east.tif | P00012498 | `--region 0,0,800,1300 --threads 1` |

The city mosaic has upper-left BNG origin `(528999.8, 182000.2)` and 0.8m pixels; the detail mosaic origin is `(529799.8, 182000.2)` with 0.4m pixels. Pixel-centre target coordinates are transformed with `Transformer.from_crs(4326,27700,always_xy=True)` and bilinearly sampled. Every sampled coordinate was asserted inside the valid source area. Output bounds and dimensions are in the delivery manifest.

## Delivery and accessibility

`scripts/prepare-arrival-assets.py` performs ordinary image resizing and JPEG compression on these geographic assets only. It never processes the tapestry master or its tiles. There are no generated coastlines, buildings, or exhibition interiors. Geographic imagery is excluded from the MIT code and CC BY-NC-SA editorial licences and retains its source terms.

All six assets are self-hosted. The introduction has no live map API or metered map dependency. The main URL opens directly in Bird’s-eye at Scene 1, regardless of the existing `bayeux:arrival-seen:v2` device-local preference. Direct scene links retain their destination, and Home never replays the introduction. A deliberate “Replay opening” link on Sources & Rights uses `/?intro=replay`; the one-shot parameter is immediately replaced with Scene 1's URL and still respects reduced motion. Skip/Escape are always available. Unsupported WebGL, context loss, failed imagery or an asset-load deadline bypass the introduction without blocking the viewer. GPU resources, animation frames and timers are released on exit.
