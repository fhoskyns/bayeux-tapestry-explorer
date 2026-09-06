import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createSatelliteFlight, flightAltitude, SATELLITE_LAYERS, satelliteLayerOpacity, satelliteUvMapping } from '@/lib/satellite-flight';
import imagery from '@/data/arrival-imagery.json';

describe('satellite opening', () => {
  it('fades detail in as its geographic footprint fills the viewport, without distant rectangular patches', () => {
    for (const aspect of [320 / 740, 1, 1440 / 900]) {
      for (const layer of SATELLITE_LAYERS.slice(1)) {
        expect(satelliteLayerOpacity(layer.bounds, 18_000_000, aspect)).toBe(0);
        expect(satelliteLayerOpacity(layer.bounds, 1, aspect)).toBe(1);
        let previous = 0;
        for (let step = 0; step <= 100; step += 1) {
          const opacity = satelliteLayerOpacity(layer.bounds, flightAltitude(step / 100, aspect), aspect);
          expect(opacity).toBeGreaterThanOrEqual(previous);
          expect(opacity).toBeLessThanOrEqual(1);
          previous = opacity;
        }
      }
    }
  });

  it('descends continuously from the globe to roof scale, clamping invalid progress', () => {
    expect(flightAltitude(-1)).toBeCloseTo(18_000_000);
    expect(flightAltitude(2)).toBeCloseTo(360);
    expect(flightAltitude(0, 390 / 844)).toBeGreaterThan(flightAltitude(0));
    expect(flightAltitude(1, 390 / 844)).toBeCloseTo(360);
    let previous = Infinity;
    for (let step = 0; step <= 100; step += 1) {
      const height = flightAltitude(step / 100);
      expect(height).toBeLessThanOrEqual(previous);
      previous = height;
    }
  });

  it('uses complete, checksummed local imagery with the exact recorded geographic bounds', () => {
    expect(SATELLITE_LAYERS).toHaveLength(6);
    for (const [index, layer] of SATELLITE_LAYERS.entries()) {
      const record = imagery.layers[index];
      expect(layer).toEqual({ url: record.url, bounds: record.bounds });
      expect(record.credit).toBeTruthy();
      expect(record.rights).toBeTruthy();
      const contents = readFileSync(resolve('public', layer.url.slice(1)));
      expect(createHash('sha256').update(contents).digest('hex')).toBe(record.sha256);
      const [u, v] = satelliteUvMapping(layer.bounds);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    const [u, v] = satelliteUvMapping(SATELLITE_LAYERS[5].bounds);
    expect(u).toBeCloseTo(0.5, 8);
    expect(v).toBeCloseTo(0.5, 8);
  });

  it('gracefully bypasses the animation when WebGL is unavailable', async () => {
    const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      expect(await createSatelliteFlight(document.createElement('canvas'), new AbortController().signal)).toBeNull();
    } finally { context.mockRestore(); }
  });
});
