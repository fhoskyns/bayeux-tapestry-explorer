import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generateDzi,
  inspectLosslessWebp,
  levelDimensions,
  maxDziLevel,
  parseDziDescriptor,
  tileBounds,
  verifyPyramid,
} from "../scripts/lib/dzi.mjs";
import { sharp } from "../scripts/lib/sharp.mjs";

test("DZI geometry handles a very wide panorama and overlap edges", () => {
  assert.equal(maxDziLevel(2050, 3), 12);
  assert.deepEqual(levelDimensions(2050, 3, 12), { width: 2050, height: 3 });
  assert.deepEqual(levelDimensions(2050, 3, 11), { width: 1025, height: 2 });
  assert.deepEqual(tileBounds(2050, 3, 0, 0, 1024, 1), {
    left: 0,
    top: 0,
    right: 1025,
    bottom: 3,
    width: 1025,
    height: 3,
  });
  assert.deepEqual(tileBounds(2050, 3, 1, 0, 1024, 1), {
    left: 1023,
    top: 0,
    right: 2049,
    bottom: 3,
    width: 1026,
    height: 3,
  });
  assert.deepEqual(tileBounds(2050, 3, 2, 0, 1024, 1), {
    left: 2047,
    top: 0,
    right: 2050,
    bottom: 3,
    width: 3,
    height: 3,
  });
});

test("DZI parser accepts the standard descriptor and rejects entity declarations", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Image xmlns="http://schemas.microsoft.com/deepzoom/2008" Format="webp" Overlap="1" TileSize="1024">
  <Size Height="1030" Width="2050" />
</Image>`;
  assert.deepEqual(parseDziDescriptor(xml), {
    namespace: "http://schemas.microsoft.com/deepzoom/2008",
    format: "webp",
    overlap: 1,
    tileSize: 1024,
    width: 2050,
    height: 1030,
  });
  assert.throws(() => parseDziDescriptor(`<!DOCTYPE x [<!ENTITY y "z">]>${xml}`), /entity/i);
  assert.throws(
    () => parseDziDescriptor(xml.replace("<Image ", '<Image Url="https://untrusted.example/tiles/" ')),
    /Image Url is not allowed/i,
  );
});

test("generator and verifier prove lossless, complete, seam-consistent output", { timeout: 120_000 }, async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "bayeux-dzi-test-"));
  try {
    const width = 2050;
    const height = 1030;
    const channels = 3;
    const pixels = Buffer.allocUnsafe(width * height * channels);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * channels;
        pixels[offset] = x % 251;
        pixels[offset + 1] = y % 241;
        pixels[offset + 2] = (x * 3 + y * 5) % 239;
      }
    }

    const sourcePath = path.join(temporaryRoot, "approved-source.png");
    await sharp(pixels, { raw: { width, height, channels } }).png().toFile(sourcePath);
    const sourceBytes = await readFile(sourcePath);
    const lock = {
      schemaVersion: 1,
      assetId: "bayeux-test",
      source: {
        sha256: createHash("sha256").update(sourceBytes).digest("hex"),
        bytes: sourceBytes.length,
        width,
        height,
        channels,
        depth: "uchar",
        space: "srgb",
        orientation: 1,
      },
      pyramid: {
        version: "v1",
        tileSize: 1024,
        overlap: 1,
        format: "webp",
        lossless: true,
      },
      toolchain: { sharp: sharp.versions.sharp, libvips: sharp.versions.vips },
    };
    await writeFile(path.join(temporaryRoot, "source-lock.json"), JSON.stringify(lock));

    const outputRoot = path.join(temporaryRoot, "generated");
    const generated = await generateDzi({ sourcePath, lock, outputRoot });
    assert.equal(generated.result, "pass");
    assert.equal(generated.pyramid.sourcePixelsChecked, true);
    assert.equal(generated.pyramid.sourceTilesChecked, 6);
    assert.ok(generated.pyramid.seamsChecked > 0);

    const assetDirectory = path.join(outputRoot, "v1", lock.assetId);
    const descriptorPath = path.join(assetDirectory, `${lock.assetId}.dzi`);
    const descriptorXml = await readFile(descriptorPath, "utf8");
    const descriptor = parseDziDescriptor(descriptorXml);
    assert.equal(descriptor.width, width);
    assert.equal(descriptor.height, height);

    const topTile = await readFile(path.join(assetDirectory, `${lock.assetId}_files`, "12", "1_0.webp"));
    assert.deepEqual(
      { width: inspectLosslessWebp(topTile).width, height: inspectLosslessWebp(topTile).height },
      { width: 1026, height: 1025 },
    );

    const reverified = await verifyPyramid({
      sourcePath,
      lock,
      assetDirectory,
      verifySourcePixels: true,
    });
    assert.equal(reverified.result, "pass");

    await writeFile(
      descriptorPath,
      descriptorXml.replace("<Image ", '<Image Url="https://untrusted.example/tiles/" '),
    );
    await assert.rejects(
      verifyPyramid({ sourcePath, lock, assetDirectory, verifySourcePixels: false }),
      /Image Url is not allowed/i,
    );
    await writeFile(descriptorPath, descriptorXml);

    const heldTile = path.join(assetDirectory, `${lock.assetId}_files`, "12", "2_1.webp");
    await rename(heldTile, `${heldTile}.held`);
    await assert.rejects(
      verifyPyramid({ sourcePath, lock, assetDirectory, verifySourcePixels: false }),
      /completeness failure/i,
    );
    await rename(`${heldTile}.held`, heldTile);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
