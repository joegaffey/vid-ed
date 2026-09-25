import assert from "node:assert/strict";
import { test } from "node:test";
import { piperAsset } from "../models.js";

test("piperAsset maps known platforms", () => {
  assert.equal(piperAsset("linux", "x64").file, "piper_linux_x86_64.tar.gz");
  assert.equal(piperAsset("linux", "arm64").file, "piper_linux_aarch64.tar.gz");
  assert.equal(piperAsset("darwin", "arm64").ext, "tar.gz");
  assert.equal(piperAsset("win32", "x64").ext, "zip");
});

test("piperAsset rejects unsupported platforms", () => {
  assert.throws(() => piperAsset("plan9", "mips"));
});
