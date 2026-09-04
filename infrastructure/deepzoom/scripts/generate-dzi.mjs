#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { generateDzi, loadLock } from "./lib/dzi.mjs";

function usage() {
  return "Usage: node scripts/generate-dzi.mjs --source /secure/path/master.tif --lock ./source-lock.json --output ./generated";
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (!["--source", "--lock", "--output"].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}.`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  for (const required of ["source", "lock", "output"]) {
    if (!values[required]) throw new Error(`--${required} is required.`);
  }
  return values;
}

export async function main(argv = process.argv.slice(2)) {
  const arguments_ = parseArguments(argv);
  if (arguments_.help) {
    console.log(usage());
    return;
  }
  const lock = await loadLock(path.resolve(arguments_.lock));
  const report = await generateDzi({
    sourcePath: path.resolve(arguments_.source),
    lock,
    outputRoot: path.resolve(arguments_.output),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exitCode = 1;
  });
}
