import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sharp } from "./sharp.mjs";

const DZI_NAMESPACE = "http://schemas.microsoft.com/deepzoom/2008";
const ASSET_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SHA256 = /^[a-f0-9]{64}$/;

export class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationError";
  }
}

function assert(condition, message) {
  if (!condition) throw new VerificationError(message);
}

export async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function inspectSource(sourcePath) {
  const sourceStat = await stat(sourcePath);
  assert(sourceStat.isFile(), "Source must be a regular file.");

  const metadata = await sharp(sourcePath, {
    failOn: "error",
    limitInputPixels: false,
    sequentialRead: true,
  }).metadata();

  assert(Number.isSafeInteger(metadata.width), "Sharp did not report a valid source width.");
  assert(Number.isSafeInteger(metadata.height), "Sharp did not report a valid source height.");

  return {
    sha256: await sha256File(sourcePath),
    bytes: sourceStat.size,
    width: metadata.width,
    height: metadata.height,
    channels: metadata.channels,
    depth: metadata.depth,
    space: metadata.space,
    orientation: metadata.orientation ?? 1,
    pages: metadata.pages ?? 1,
    hasIccProfile: Boolean(metadata.icc),
    format: metadata.format,
  };
}

export function validateLock(lock) {
  assert(lock && typeof lock === "object", "Source lock must contain a JSON object.");
  assert(lock.schemaVersion === 1, "Source lock schemaVersion must be 1.");
  assert(ASSET_ID.test(lock.assetId ?? ""), "assetId must be a lowercase URL-safe slug of at most 64 characters.");

  const source = lock.source ?? {};
  assert(SHA256.test(source.sha256 ?? ""), "source.sha256 must be 64 lowercase hexadecimal characters.");
  for (const field of ["bytes", "width", "height"]) {
    assert(Number.isSafeInteger(source[field]) && source[field] > 0, `source.${field} must be a positive safe integer.`);
  }
  assert(source.channels === 3 || source.channels === 4, "source.channels must be 3 (RGB) or 4 (RGBA).");
  assert(source.depth === "uchar", "source.depth must be uchar (8-bit); WebP cannot preserve a higher-bit-depth source exactly.");
  assert(source.space === "srgb", "source.space must be srgb.");
  assert(source.orientation === 1, "source.orientation must be 1; rotate an approved publication source before locking it.");

  const pyramid = lock.pyramid ?? {};
  assert(pyramid.version === "v1", "pyramid.version must be v1 for this publication bundle.");
  assert(pyramid.tileSize === 1024, "pyramid.tileSize must be 1024.");
  assert(pyramid.overlap === 1, "pyramid.overlap must be 1.");
  assert(pyramid.format === "webp", "pyramid.format must be webp.");
  assert(pyramid.lossless === true, "pyramid.lossless must be true.");

  const toolchain = lock.toolchain ?? {};
  assert(typeof toolchain.sharp === "string" && toolchain.sharp.length > 0, "toolchain.sharp is required.");
  assert(typeof toolchain.libvips === "string" && toolchain.libvips.length > 0, "toolchain.libvips is required.");
  assert(toolchain.sharp === sharp.versions.sharp, `Locked Sharp ${toolchain.sharp} does not match installed Sharp ${sharp.versions.sharp}.`);
  assert(toolchain.libvips === sharp.versions.vips, `Locked libvips ${toolchain.libvips} does not match installed libvips ${sharp.versions.vips}.`);

  return lock;
}

export async function loadLock(lockPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    throw new VerificationError(`Could not read source lock JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateLock(parsed);
}

export async function verifyLockedSource(sourcePath, lock) {
  const observed = await inspectSource(sourcePath);
  const expected = lock.source;

  for (const field of ["sha256", "bytes", "width", "height", "channels", "depth", "space", "orientation"]) {
    assert(
      observed[field] === expected[field],
      `Source ${field} mismatch: expected ${JSON.stringify(expected[field])}, observed ${JSON.stringify(observed[field])}.`,
    );
  }
  assert(observed.pages === 1, `Source must contain exactly one image/page; observed ${observed.pages}.`);
  return observed;
}

export function maxDziLevel(width, height) {
  assert(Number.isSafeInteger(width) && width > 0, "Width must be a positive safe integer.");
  assert(Number.isSafeInteger(height) && height > 0, "Height must be a positive safe integer.");
  let level = 0;
  let covered = 1;
  const largest = Math.max(width, height);
  while (covered < largest) {
    covered *= 2;
    level += 1;
  }
  return level;
}

export function levelDimensions(fullWidth, fullHeight, level) {
  const maxLevel = maxDziLevel(fullWidth, fullHeight);
  assert(Number.isInteger(level) && level >= 0 && level <= maxLevel, `DZI level must be between 0 and ${maxLevel}.`);
  const divisor = 2 ** (maxLevel - level);
  return {
    width: Math.ceil(fullWidth / divisor),
    height: Math.ceil(fullHeight / divisor),
  };
}

export function tileBounds(levelWidth, levelHeight, column, row, tileSize, overlap) {
  const columns = Math.ceil(levelWidth / tileSize);
  const rows = Math.ceil(levelHeight / tileSize);
  assert(Number.isInteger(column) && column >= 0 && column < columns, "Tile column is out of range.");
  assert(Number.isInteger(row) && row >= 0 && row < rows, "Tile row is out of range.");

  const left = Math.max(0, column * tileSize - overlap);
  const top = Math.max(0, row * tileSize - overlap);
  const right = Math.min(levelWidth, (column + 1) * tileSize + overlap);
  const bottom = Math.min(levelHeight, (row + 1) * tileSize + overlap);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function parseXmlAttributes(text) {
  const attributes = {};
  const expression = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of text.matchAll(expression)) {
    attributes[match[1]] = match[2] ?? match[3];
  }
  return attributes;
}

export function parseDziDescriptor(xml) {
  assert(Buffer.byteLength(xml, "utf8") <= 65_536, "DZI descriptor exceeds 64 KiB.");
  assert(!/<!DOCTYPE|<!ENTITY/i.test(xml), "DZI descriptor must not contain a DTD or entity declaration.");
  const imageMatches = [...xml.matchAll(/<Image\b([^>]*)>/g)];
  const sizeMatches = [...xml.matchAll(/<Size\b([^>]*)\/?\s*>/g)];
  assert(imageMatches.length === 1, "DZI descriptor must contain exactly one Image element.");
  assert(sizeMatches.length === 1, "DZI descriptor must contain exactly one Size element.");

  const image = parseXmlAttributes(imageMatches[0][1]);
  const size = parseXmlAttributes(sizeMatches[0][1]);
  assert(
    !Object.hasOwn(image, "Url"),
    "DZI Image Url is not allowed; tiles must resolve beneath the verified descriptor path.",
  );
  const parsed = {
    namespace: image.xmlns,
    format: image.Format,
    overlap: Number(image.Overlap),
    tileSize: Number(image.TileSize),
    width: Number(size.Width),
    height: Number(size.Height),
  };
  for (const field of ["overlap", "tileSize", "width", "height"]) {
    assert(Number.isSafeInteger(parsed[field]), `DZI ${field} must be a safe integer.`);
  }
  return parsed;
}

function readUint24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

export function inspectLosslessWebp(buffer) {
  assert(Buffer.isBuffer(buffer), "WebP input must be a Buffer.");
  assert(buffer.length >= 20, "WebP tile is truncated.");
  assert(buffer.toString("ascii", 0, 4) === "RIFF", "WebP tile is missing the RIFF signature.");
  assert(buffer.toString("ascii", 8, 12) === "WEBP", "WebP tile is missing the WEBP signature.");
  assert(buffer.readUInt32LE(4) + 8 === buffer.length, "WebP RIFF length does not match the file length.");

  let offset = 12;
  let lossless = null;
  let canvas = null;
  const chunks = [];
  while (offset < buffer.length) {
    assert(offset + 8 <= buffer.length, "WebP chunk header is truncated.");
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    assert(end <= buffer.length, `WebP ${type} chunk is truncated.`);
    chunks.push(type);

    if (type === "VP8 ") throw new VerificationError("Tile contains a lossy VP8 bitstream.");
    if (type === "ANIM" || type === "ANMF") throw new VerificationError("Animated WebP tiles are not allowed.");
    if (type === "VP8L") {
      assert(lossless === null, "Tile contains more than one VP8L bitstream.");
      assert(length >= 5 && buffer[start] === 0x2f, "VP8L signature is invalid.");
      const bits = buffer.readUInt32LE(start + 1);
      lossless = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
    }
    if (type === "VP8X") {
      assert(length >= 10, "VP8X chunk is truncated.");
      canvas = {
        width: readUint24LE(buffer, start + 4) + 1,
        height: readUint24LE(buffer, start + 7) + 1,
      };
    }
    offset = end + (length % 2);
  }

  assert(offset === buffer.length, "WebP tile has malformed trailing bytes.");
  assert(lossless !== null, "Tile does not contain a VP8L lossless bitstream.");
  if (canvas) {
    assert(canvas.width === lossless.width && canvas.height === lossless.height, "VP8X canvas and VP8L dimensions disagree.");
  }
  return { ...lossless, chunks };
}

function expectedPyramid(lock) {
  const expectedFiles = new Set([`${lock.assetId}.dzi`]);
  const expectedDirectories = new Set([`${lock.assetId}_files`]);
  const tiles = [];
  const maxLevel = maxDziLevel(lock.source.width, lock.source.height);

  for (let level = 0; level <= maxLevel; level += 1) {
    const dimensions = levelDimensions(lock.source.width, lock.source.height, level);
    const columns = Math.ceil(dimensions.width / lock.pyramid.tileSize);
    const rows = Math.ceil(dimensions.height / lock.pyramid.tileSize);
    expectedDirectories.add(`${lock.assetId}_files/${level}`);

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const relativePath = `${lock.assetId}_files/${level}/${column}_${row}.webp`;
        const bounds = tileBounds(
          dimensions.width,
          dimensions.height,
          column,
          row,
          lock.pyramid.tileSize,
          lock.pyramid.overlap,
        );
        expectedFiles.add(relativePath);
        tiles.push({ level, row, column, relativePath, bounds, dimensions, columns, rows });
      }
    }
  }
  return { expectedFiles, expectedDirectories, tiles, maxLevel };
}

async function walkTree(root) {
  const files = new Set();
  const directories = new Set();

  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new VerificationError(`Symbolic links are not allowed: ${relativePath}`);
      if (entry.isDirectory()) {
        directories.add(relativePath);
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.add(relativePath);
      } else {
        throw new VerificationError(`Unsupported filesystem entry: ${relativePath}`);
      }
    }
  }

  await visit(root, "");
  return { files, directories };
}

function compareSets(expected, observed, label) {
  const missing = [...expected].filter((item) => !observed.has(item)).sort();
  const extra = [...observed].filter((item) => !expected.has(item)).sort();
  assert(
    missing.length === 0 && extra.length === 0,
    `${label} completeness failure. Missing: ${missing.slice(0, 20).join(", ") || "none"}; extra: ${extra.slice(0, 20).join(", ") || "none"}.`,
  );
}

function intersection(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  assert(right > left && bottom > top, "Adjacent DZI tiles do not overlap.");
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

async function decodedRegion(filePath, localBounds) {
  const { data, info } = await sharp(filePath, { failOn: "error" })
    .extract({
      left: localBounds.left,
      top: localBounds.top,
      width: localBounds.width,
      height: localBounds.height,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, info };
}

function localise(globalBounds, tile) {
  return {
    left: globalBounds.left - tile.bounds.left,
    top: globalBounds.top - tile.bounds.top,
    width: globalBounds.width,
    height: globalBounds.height,
  };
}

function assertRawEqual(first, second, label) {
  for (const field of ["width", "height", "channels", "depth"]) {
    assert(first.info[field] === second.info[field], `${label}: decoded ${field} differs.`);
  }
  assert(first.data.equals(second.data), `${label}: decoded pixels differ.`);
}

async function compareTileIntersection(assetDirectory, first, second) {
  const shared = intersection(first.bounds, second.bounds);
  const firstPath = path.join(assetDirectory, first.relativePath);
  const secondPath = path.join(assetDirectory, second.relativePath);
  const [firstRaw, secondRaw] = await Promise.all([
    decodedRegion(firstPath, localise(shared, first)),
    decodedRegion(secondPath, localise(shared, second)),
  ]);
  assertRawEqual(firstRaw, secondRaw, `Seam ${first.relativePath} <> ${second.relativePath}`);
}

async function materialiseSourceCache(sourcePath, expectedSource, tileSize) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "bayeux-dzi-source-"));
  const cachePath = path.join(temporaryDirectory, "source-cache.tif");
  try {
    const info = await sharp(sourcePath, {
      failOn: "error",
      limitInputPixels: false,
      sequentialRead: true,
    })
      .keepIccProfile()
      .tiff({
        compression: "lzw",
        bigtiff: true,
        predictor: "horizontal",
        tile: true,
        tileWidth: tileSize,
        tileHeight: tileSize,
      })
      .toFile(cachePath);
    for (const field of ["width", "height", "channels"]) {
      assert(
        info[field] === expectedSource[field],
        `Materialised source cache ${field} mismatch: expected ${expectedSource[field]}, observed ${info[field]}.`,
      );
    }
    return {
      cachePath,
      temporaryDirectory,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function compareTopTileWithSource(sourceCachePath, assetDirectory, tile, expectedChannels) {
  const tilePath = path.join(assetDirectory, tile.relativePath);
  const [tileRaw, sourceRaw] = await Promise.all([
    sharp(tilePath, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true }),
    sharp(sourceCachePath, { failOn: "error", limitInputPixels: false })
      .extract({
        left: tile.bounds.left,
        top: tile.bounds.top,
        width: tile.bounds.width,
        height: tile.bounds.height,
      })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);
  assert(tileRaw.info.channels === expectedChannels, `${tile.relativePath}: decoded channel count changed.`);
  assertRawEqual(tileRaw, sourceRaw, `Source comparison ${tile.relativePath}`);
}

export async function verifyPyramid({ sourcePath, lock, assetDirectory, verifySourcePixels = true }) {
  validateLock(lock);
  const source = await verifyLockedSource(sourcePath, lock);
  const assetStat = await lstat(assetDirectory);
  assert(assetStat.isDirectory(), "Pyramid path must be a directory.");
  assert(path.basename(assetDirectory) === lock.assetId, `Pyramid directory must be named ${lock.assetId}.`);

  const descriptorPath = path.join(assetDirectory, `${lock.assetId}.dzi`);
  const descriptor = parseDziDescriptor(await readFile(descriptorPath, "utf8"));
  assert(descriptor.namespace === DZI_NAMESPACE, `DZI namespace must be ${DZI_NAMESPACE}.`);
  assert(descriptor.format === lock.pyramid.format, "DZI format does not match the source lock.");
  assert(descriptor.overlap === lock.pyramid.overlap, "DZI overlap does not match the source lock.");
  assert(descriptor.tileSize === lock.pyramid.tileSize, "DZI tile size does not match the source lock.");
  assert(descriptor.width === lock.source.width, "DZI width does not match the locked source.");
  assert(descriptor.height === lock.source.height, "DZI height does not match the locked source.");

  const expected = expectedPyramid(lock);
  const observed = await walkTree(assetDirectory);
  compareSets(expected.expectedFiles, observed.files, "File");
  compareSets(expected.expectedDirectories, observed.directories, "Directory");

  let tileBytes = 0;
  for (const tile of expected.tiles) {
    const tilePath = path.join(assetDirectory, tile.relativePath);
    const fileStat = await stat(tilePath);
    assert(fileStat.isFile() && fileStat.size > 0, `${tile.relativePath} is empty or not a regular file.`);
    tileBytes += fileStat.size;
    const webp = inspectLosslessWebp(await readFile(tilePath));
    assert(webp.width === tile.bounds.width, `${tile.relativePath}: expected width ${tile.bounds.width}, observed ${webp.width}.`);
    assert(webp.height === tile.bounds.height, `${tile.relativePath}: expected height ${tile.bounds.height}, observed ${webp.height}.`);
  }

  const tileMap = new Map(expected.tiles.map((tile) => [`${tile.level}:${tile.column}:${tile.row}`, tile]));
  let seamsChecked = 0;
  for (const tile of expected.tiles) {
    if (tile.column + 1 < tile.columns) {
      await compareTileIntersection(
        assetDirectory,
        tile,
        tileMap.get(`${tile.level}:${tile.column + 1}:${tile.row}`),
      );
      seamsChecked += 1;
    }
    if (tile.row + 1 < tile.rows) {
      await compareTileIntersection(
        assetDirectory,
        tile,
        tileMap.get(`${tile.level}:${tile.column}:${tile.row + 1}`),
      );
      seamsChecked += 1;
    }
  }

  let sourceTilesChecked = 0;
  if (verifySourcePixels) {
    const sourceCache = await materialiseSourceCache(sourcePath, lock.source, lock.pyramid.tileSize);
    try {
      for (const tile of expected.tiles) {
        if (tile.level === expected.maxLevel) {
          await compareTopTileWithSource(
            sourceCache.cachePath,
            assetDirectory,
            tile,
            lock.source.channels,
          );
          sourceTilesChecked += 1;
        }
      }
    } finally {
      await rm(sourceCache.temporaryDirectory, { recursive: true, force: true });
    }
  }

  return {
    schemaVersion: 1,
    result: "pass",
    verifiedAt: new Date().toISOString(),
    assetId: lock.assetId,
    publicationVersion: lock.pyramid.version,
    source: {
      sha256: source.sha256,
      bytes: source.bytes,
      width: source.width,
      height: source.height,
      channels: source.channels,
      depth: source.depth,
      space: source.space,
      orientation: source.orientation,
    },
    pyramid: {
      format: lock.pyramid.format,
      lossless: true,
      tileSize: lock.pyramid.tileSize,
      overlap: lock.pyramid.overlap,
      maxLevel: expected.maxLevel,
      tileCount: expected.tiles.length,
      tileBytes,
      seamsChecked,
      sourcePixelsChecked: verifySourcePixels,
      sourceTilesChecked,
    },
    toolchain: {
      node: process.version,
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
      webp: sharp.versions.webp,
    },
  };
}

export async function writeJsonAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(path.dirname(destination), ".json-write-"));
  const temporaryFile = path.join(temporaryDirectory, path.basename(destination));
  try {
    const handle = await open(temporaryFile, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryFile, destination);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function generateDzi({ sourcePath, lock, outputRoot }) {
  validateLock(lock);
  await verifyLockedSource(sourcePath, lock);

  const resolvedOutput = path.resolve(outputRoot);
  const versionDirectory = path.join(resolvedOutput, lock.pyramid.version);
  const finalAssetDirectory = path.join(versionDirectory, lock.assetId);
  await mkdir(versionDirectory, { recursive: true });
  try {
    await lstat(finalAssetDirectory);
    throw new VerificationError(`Refusing to overwrite existing immutable output: ${finalAssetDirectory}`);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
  }

  const stagingRoot = await mkdtemp(path.join(resolvedOutput, ".dzi-build-"));
  const stagingAssetDirectory = path.join(stagingRoot, lock.pyramid.version, lock.assetId);
  await mkdir(stagingAssetDirectory, { recursive: true });
  // libvips appends the DZI extension and `_files` suffix itself. Passing a
  // `.dzi` suffix here would produce `<asset>.dzi.dzi`.
  const descriptorStem = path.join(stagingAssetDirectory, lock.assetId);

  try {
    await sharp(sourcePath, {
      failOn: "error",
      limitInputPixels: false,
      sequentialRead: true,
    })
      .keepIccProfile()
      .webp({
        lossless: true,
        nearLossless: false,
        quality: 100,
        alphaQuality: 100,
        effort: 6,
        exact: true,
        smartSubsample: false,
      })
      .tile({
        size: lock.pyramid.tileSize,
        overlap: lock.pyramid.overlap,
        layout: "dz",
        container: "fs",
        depth: "onepixel",
        skipBlanks: -1,
        angle: 0,
      })
      .toFile(descriptorStem);

    // libvips emits an implementation-metadata sidecar for filesystem DZI
    // output. It is not required by OpenSeadragon and must not enter the
    // tightly allow-listed public derivative inventory.
    try {
      await unlink(
        path.join(stagingAssetDirectory, `${lock.assetId}_files`, "vips-properties.xml"),
      );
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }

    const report = await verifyPyramid({
      sourcePath,
      lock,
      assetDirectory: stagingAssetDirectory,
      verifySourcePixels: true,
    });
    await rename(stagingAssetDirectory, finalAssetDirectory);
    await writeJsonAtomic(
      path.join(resolvedOutput, "reports", `${lock.assetId}-${lock.pyramid.version}-verification.json`),
      report,
    );
    return report;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}
