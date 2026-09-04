#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { inspectSource } from "./lib/dzi.mjs";
import { sharp } from "./lib/sharp.mjs";

function usage() {
  return "Usage: node scripts/inspect-source.mjs --source /secure/path/master.tif --asset-id bayeux-tapestry";
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument !== "--source" && argument !== "--asset-id") throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  if (!values.source || !values["asset-id"]) throw new Error("--source and --asset-id are required.");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(values["asset-id"])) {
    throw new Error("--asset-id must be a lowercase URL-safe slug of at most 64 characters.");
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  if (arguments_.help) {
    console.log(usage());
    return;
  }
  const source = await inspectSource(arguments_.source);
  const suggestedLock = {
    schemaVersion: 1,
    assetId: arguments_["asset-id"],
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
      version: "v1",
      tileSize: 1024,
      overlap: 1,
      format: "webp",
      lossless: true,
    },
    toolchain: {
      sharp: sharp.versions.sharp,
      libvips: sharp.versions.vips,
    },
    inspection: {
      format: source.format,
      pages: source.pages,
      hasIccProfile: source.hasIccProfile,
    },
  };
  console.log(JSON.stringify(suggestedLock, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  });
}
