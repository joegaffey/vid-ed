import sharp from "sharp";

const DCT_N = 32;
const DCT_SIZE = 8;

const cosTable: number[][] = (() => {
  const t: number[][] = [];
  for (let k = 0; k < DCT_N; k++) {
    t[k] = [];
    for (let n = 0; n < DCT_N; n++) {
      t[k]![n] = Math.cos((Math.PI / DCT_N) * (n + 0.5) * k);
    }
  }
  return t;
})();

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble =
      ((bits[i] ?? 0) << 3) |
      ((bits[i + 1] ?? 0) << 2) |
      ((bits[i + 2] ?? 0) << 1) |
      (bits[i + 3] ?? 0);
    hex += nibble.toString(16);
  }
  return hex;
}

function hexToBigInt(hex: string): bigint {
  return BigInt("0x" + (hex || "0"));
}

export function hammingDistance(a: string, b: string): number {
  let x = hexToBigInt(a) ^ hexToBigInt(b);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

async function grayscale(path: string, width: number, height: number): Promise<Buffer> {
  return sharp(path)
    .resize(width, height, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();
}

/** Difference hash: gradient sign across each row of a 9x8 image. */
export async function dhash(path: string): Promise<string> {
  const w = 9;
  const h = 8;
  const px = await grayscale(path, w, h);
  const bits: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      bits.push((px[y * w + x] ?? 0) > (px[y * w + x + 1] ?? 0) ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

function dct2d(matrix: number[][]): number[][] {
  const n = DCT_N;
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = matrix[i]!;
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const cos = cosTable[k]!;
      let sum = 0;
      for (let j = 0; j < n; j++) sum += (row[j] ?? 0) * (cos[j] ?? 0);
      out.push(sum);
    }
    rows.push(out);
  }
  const result: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    for (let k = 0; k < n; k++) {
      const cos = cosTable[k]!;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += (rows[i]![j] ?? 0) * (cos[i] ?? 0);
      result[k]![j] = sum;
    }
  }
  return result;
}

/** Perceptual hash: low-frequency DCT coefficients of a 32x32 image. */
export async function phash(path: string): Promise<string> {
  const px = await grayscale(path, DCT_N, DCT_N);
  const matrix: number[][] = [];
  for (let y = 0; y < DCT_N; y++) {
    const row: number[] = [];
    for (let x = 0; x < DCT_N; x++) row.push(px[y * DCT_N + x] ?? 0);
    matrix.push(row);
  }
  const dct = dct2d(matrix);
  const coeffs: number[] = [];
  for (let u = 0; u < DCT_SIZE; u++) {
    for (let v = 0; v < DCT_SIZE; v++) {
      if (u === 0 && v === 0) continue;
      coeffs.push(dct[u]![v]!);
    }
  }
  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const bits = coeffs.map((c) => (c > median ? 1 : 0));
  return bitsToHex(bits);
}

export async function hashImage(path: string): Promise<{ phash: string; dhash: string }> {
  const [p, d] = await Promise.all([phash(path), dhash(path)]);
  return { phash: p, dhash: d };
}
