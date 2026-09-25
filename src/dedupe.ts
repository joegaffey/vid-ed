import { hammingDistance } from "./hash.js";

export interface HashableFrame {
  t: number;
  phash?: string;
  dhash?: string;
  sharpness?: number;
}

function similar(a: HashableFrame, b: HashableFrame, maxDist: number): boolean {
  if (a.phash && b.phash) return hammingDistance(a.phash, b.phash) <= maxDist;
  if (a.dhash && b.dhash) return hammingDistance(a.dhash, b.dhash) <= maxDist;
  return false;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/** Cluster frame indices by perceptual-hash similarity. */
export function clusterFrames(frames: HashableFrame[], maxDist: number): number[][] {
  const uf = new UnionFind(frames.length);
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      if (similar(frames[i]!, frames[j]!, maxDist)) uf.union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < frames.length; i++) {
    const root = uf.find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }
  return [...groups.values()];
}

function pickRepresentative<T extends HashableFrame>(group: T[], members: T[]): T {
  return [...group].sort((a, b) => {
    const sa = a.sharpness ?? 0;
    const sb = b.sharpness ?? 0;
    if (sa !== sb) return sb - sa;
    return a.t - b.t;
  })[0]!;
}

export interface DedupeResult {
  groups: number[][];
  representatives: number[];
}

export function dedupeFrames(frames: HashableFrame[], maxDist: number): DedupeResult {
  const groups = clusterFrames(frames, maxDist);
  const representatives = groups.map((g) => {
    const members = g.map((i) => frames[i]!);
    const rep = pickRepresentative(members, members);
    return frames.indexOf(rep);
  });
  return { groups, representatives: [...new Set(representatives)].sort((a, b) => a - b) };
}

/** Keep at most `budget` representatives, spread evenly across the timeline. */
export function applyBudget(representatives: number[], budget: number): number[] {
  const sorted = [...representatives].sort((a, b) => a - b);
  if (budget <= 0) return [];
  if (sorted.length <= budget) return sorted;
  if (budget === 1) return [sorted[0]!];
  const out: number[] = [];
  for (let i = 0; i < budget; i++) {
    const idx = Math.round((i * (sorted.length - 1)) / (budget - 1));
    out.push(sorted[idx]!);
  }
  return [...new Set(out)];
}

export interface DensityConfig {
  target_frames_per_minute: number;
  min_frames_per_asset: number;
  max_frames_per_asset: number;
}

/** Target frames to keep for an asset, proportional to duration, clamped. */
export function densityBudget(durationS: number, cfg: DensityConfig): number {
  const byDensity = Math.round((Math.max(0, durationS) / 60) * cfg.target_frames_per_minute);
  return Math.min(cfg.max_frames_per_asset, Math.max(cfg.min_frames_per_asset, byDensity));
}
