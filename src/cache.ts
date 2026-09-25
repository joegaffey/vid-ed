import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export function cacheKey(parts: Array<string | number | boolean | undefined>): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(String(p) + "\u0000");
  return h.digest("hex");
}

export class Cache {
  constructor(private readonly dir: string) {}

  path(key: string): string {
    return join(this.dir, key.slice(0, 2), key);
  }

  has(key: string): boolean {
    return existsSync(this.path(key));
  }

  async getJSON<T>(key: string): Promise<T | undefined> {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    return JSON.parse(await readFile(p, "utf8")) as T;
  }

  async putJSON(key: string, value: unknown): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, p);
  }

  async getText(key: string): Promise<string | undefined> {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    return readFile(p, "utf8");
  }

  async putText(key: string, value: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    await writeFile(tmp, value, "utf8");
    await rename(tmp, p);
  }
}
