#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLock, verifyPyramid, writeJsonAtomic } from "./lib/dzi.mjs";

function usage() {
  return "Usage: node scripts/verify-dzi.mjs --source /secure/path/master.tif --lock ./source-lock.json --pyramid ./generated/v1/bayeux-tapestry [--report ./verification.json] [--quick]";
}

function parseArguments(argv) {
  const values = { quick: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--quick") {
      values.quick = true;
      continue;
    }
    if (!["--source", "--lock", "--pyramid", "--report"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  for (const required of ["source", "lock", "pyramid"]) {
    if (!values[required]) throw new Error(`--${required} is required.`);
  }
  return values;
}

function pathIsInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function main(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  if (arguments_.help) {
    console.log(usage());
    return;
  }
  const assetDirectory = path.resolve(arguments_.pyramid);
  const lock = await loadLock(path.resolve(arguments_.lock));
  const report = await verifyPyramid({
    sourcePath: path.resolve(arguments_.source),
    lock,
    assetDirectory,
    verifySourcePixels: !arguments_.quick,
  });

  if (arguments_.report) {
    const reportPath = path.resolve(arguments_.report);
    if (pathIsInside(reportPath, assetDirectory)) {
      throw new Error("--report must be outside the immutable pyramid directory.");
    }
    await writeJsonAtomic(reportPath, report);
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  });
}
