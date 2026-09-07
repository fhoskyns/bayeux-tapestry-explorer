import type { ViewerViewport } from '@/components/tapestry-viewer';

export const TEXTILE = { width: 70, depth: 70 * 5550 / 482096, y: 0.981, pixels: 482096, height: 5550 } as const;
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export type GalleryPose = { center: number; v: number; width: number; tilt: number; yaw: number };

export function poseFromCamera(rect: ViewerViewport): GalleryPose {
  return { center: clamp(rect.x + rect.width / 2, 0, 1), v: rect.y + rect.height / 2,
    width: Math.max(0.15, rect.width * TEXTILE.width), tilt: 0, yaw: 0 };
}

export function cameraFromPose(pose: GalleryPose, aspect: number): ViewerViewport {
  const width = pose.width / TEXTILE.width;
  const height = pose.width / Math.max(0.1, aspect) / TEXTILE.depth;
  return { x: pose.center - width / 2, y: pose.v - height / 2, width, height };
}

/** Crop only DZI overlap pixels, never scale the native source non-uniformly. */
export function tileLayout(level: number, col: number, row: number) {
  const scale = 2 ** (19 - level);
  const width = Math.ceil(TEXTILE.pixels / scale);
  const height = Math.ceil(TEXTILE.height / scale);
  const x = col * 1024, y = row * 1024;
  const w = Math.min(1024, width - x), h = Math.min(1024, height - y);
  const left = col > 0 ? 1 : 0, top = row > 0 ? 1 : 0;
  const right = x + w < width ? 1 : 0, bottom = y + h < height ? 1 : 0;
  return { x: x / width, y: y / height, width: w / width, height: h / height,
    u0: left / (w + left + right), u1: (left + w) / (w + left + right),
    v0: bottom / (h + top + bottom), v1: (bottom + h) / (h + top + bottom) };
}

export function visibleTiles(center: number, worldWidth: number, screenWidth: number) {
  let level = clamp(Math.ceil(19 + Math.log2(screenWidth / (worldWidth / 70 * TEXTILE.pixels))), 13, 18);
  const tilesAt = (lod: number) => {
    const w = Math.ceil(TEXTILE.pixels / 2 ** (19 - lod));
    const h = Math.ceil(TEXTILE.height / 2 ** (19 - lod));
    const radius = worldWidth / 70;
    const first = Math.floor(clamp(center - radius, 0, 1) * w / 1024);
    const last = Math.min(Math.ceil(w / 1024) - 1, Math.floor(clamp(center + radius, 0, 1) * w / 1024));
    return { first, last, rows: Math.ceil(h / 1024) };
  };
  let range = tilesAt(level);
  while ((range.last - range.first + 1) * range.rows > 28 && level > 13) range = tilesAt(--level);
  const keys: string[] = [];
  for (let col = range.first; col <= range.last; col++) for (let row = 0; row < range.rows; row++) keys.push(`${level}/${col}_${row}`);
  return keys;
}
