import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// createRequire also permits these scripts to use a centrally supplied Sharp
// installation via NODE_PATH in controlled build environments.
export const sharp = require("sharp");
