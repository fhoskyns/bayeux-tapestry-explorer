"""Compress the documented geographic sources, never tapestry imagery.

Usage: python prepare-arrival-assets.py NASA_DOWNLOAD_DIR EA_DERIVATIVE_DIR
See docs/intro-assets.md for source URLs, projection and licences.
"""
from pathlib import Path
import sys
from PIL import Image

nasa, aerial = map(Path, sys.argv[1:3])
output = Path(__file__).resolve().parent.parent / "public" / "arrival"
output.mkdir(parents=True, exist_ok=True)
sources = [
    (nasa / "world.200408.3x5400x2700.jpg", "earth", (4096, 2048)),
    (nasa / "uk-gibs-2004-08-bounds-15W-10E-45N-65N.jpg", "britain", (2000, 1600)),
    (nasa / "se-england-gibs-2004-08-bounds-3.2W-2.8E-49.5N-53.5N.jpg", "england", (1440, 960)),
    (nasa / "london-eox-sentinel2-2016-bounds-0.3769W-0.1231E-51.2695N-51.7695N.jpg", "london", (2048, 2048)),
    (aerial / "london-overhead.jpg", "bloomsbury", (2400, 1500)),
    (aerial / "british-museum-overhead.jpg", "museum", (1200, 1200)),
]
for source, name, size in sources:
    with Image.open(source) as original:
        image = original.convert("RGB")
        if image.size != size:
            image = image.resize(size, Image.Resampling.LANCZOS)
        image.save(output / f"{name}.jpg", quality=78, subsampling=2,
                   optimize=True, progressive=True,
                   icc_profile=original.info.get("icc_profile", b""))
