import { describe, expect, it } from 'vitest';
import { cameraFromPose, poseFromCamera, TEXTILE, tileLayout, visibleTiles } from '@/lib/gallery-math';
import { nearestPreview } from '@/lib/auto-preview';

describe('gallery and facsimile registration', () => {
  it('preserves the complete scan aspect ratio in metre coordinates', () => {
    expect(TEXTILE.width / TEXTILE.depth).toBeCloseTo(482096 / 5550, 12);
  });
  it('round-trips an unclipped camera including white margins', () => {
    const rect = { x: 0.25, y: -0.3, width: 0.022, height: 1.6 };
    const aspect = rect.width * TEXTILE.width / (rect.height * TEXTILE.depth);
    const result = cameraFromPose(poseFromCamera(rect), aspect);
    expect(result.x).toBeCloseTo(rect.x, 12);
    expect(result.y).toBeCloseTo(rect.y, 12);
    expect(result.width).toBeCloseTo(rect.width, 12);
    expect(result.height).toBeCloseTo(rect.height, 12);
  });
  it('keeps all selected tiles valid and caps the working set at 28', () => {
    for (const center of [0, .01, .5, .99, 1]) for (const width of [.4, 3.5, 70, 100]) {
      const keys = visibleTiles(center, width, 2400);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.length).toBeLessThanOrEqual(28);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) {
        const [level, coordinates] = key.split('/');
        const [col, row] = coordinates.split('_').map(Number);
        const layout = tileLayout(Number(level), col, row);
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
        expect(layout.x + layout.width).toBeLessThanOrEqual(1.0000001);
        expect(layout.y + layout.height).toBeLessThanOrEqual(1.0000001);
      }
    }
  });
  it('removes overlap from internal tile UVs and places neighbours without gaps', () => {
    const a = tileLayout(18, 9, 0), b = tileLayout(18, 10, 0);
    expect(a.x + a.width).toBeCloseTo(b.x, 12);
    expect(a.u0).toBeCloseTo(1 / 1026);
    expect(a.u1).toBeCloseTo(1025 / 1026);
    const below = tileLayout(18, 9, 1);
    expect(a.y + a.height).toBeCloseTo(below.y, 12);
  });
});

describe('one-at-a-time automatic notes', () => {
  it('chooses exactly one closest visible note with stable ties', () => {
    expect(nearestPreview([{ id:'7b', x:510, y:300 }, { id:'7a', x:490, y:300 }], 1000, 800)).toBe('7a');
    expect(nearestPreview([{ id:'7a', x:350, y:300 }, { id:'7b', x:600, y:300 }], 1000, 800)).toBe('7b');
  });
  it('closes notes outside the reading lane or vertical viewport', () => {
    expect(nearestPreview([{ id:'7a', x:650, y:300 }, { id:'7b', x:500, y:-4 }], 1000, 800)).toBeNull();
  });
});
