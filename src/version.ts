import { createRequire } from "node:module";

/** The package version, read once from package.json (compiled dist/ -> ../package.json). */
export const VERSION = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
