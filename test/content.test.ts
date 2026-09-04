import { describe, expect, it } from 'vitest';

import { tapestryManifest } from '@/data/tapestry-manifest';
import { tapestryManifestSchema } from '@/lib/tapestry-schema';

describe('tapestry content contract', () => {
  it('keeps global editorial and image-rights publication gates explicit', () => {
    const editorialWithoutRecord = { ...tapestryManifest.editorial };
    const imageWithoutRightsRecord = { ...tapestryManifest.image };
    delete editorialWithoutRecord.auditRecord;
    delete imageWithoutRightsRecord.rightsPublicationRecord;

    expect(() =>
      tapestryManifestSchema.parse({
        ...tapestryManifest,
        editorial: { ...editorialWithoutRecord, status: 'publication-ready' },
      }),
    ).toThrow(/final audit record/);
    expect(() =>
      tapestryManifestSchema.parse({
        ...tapestryManifest,
        image: { ...imageWithoutRightsRecord, rightsStatus: 'documented-for-publication' },
      }),
    ).toThrow(/publication record/);
  });

  it('contains exactly 58 ordered, contiguous scenes', () => {
    expect(() => tapestryManifestSchema.parse(tapestryManifest)).not.toThrow();
    expect(tapestryManifest.scenes).toHaveLength(58);

    let expectedX = 0;
    for (const [index, scene] of tapestryManifest.scenes.entries()) {
      expect(scene.number).toBe(index + 1);
      expect(scene.id).toBe(String(index + 1).padStart(2, '0'));
      expect(scene.pixelBounds.x).toBe(expectedX);
      expect(scene.pixelBounds.y).toBe(0);
      expect(scene.pixelBounds.height).toBe(tapestryManifest.image.height);
      expectedX += scene.pixelBounds.width;
    }

    expect(expectedX).toBe(tapestryManifest.image.width);
  });

  it('has complete cited text and unique, in-bounds annotations', () => {
    const sourceIds = new Set(tapestryManifest.sources.map((source) => source.id));
    const annotationIds = new Set<string>();

    for (const scene of tapestryManifest.scenes) {
      expect(scene.latinInscription.trim().length).toBeGreaterThan(0);
      expect(scene.englishTranslation.trim().length).toBeGreaterThan(0);
      expect(scene.summary.trim().length).toBeGreaterThan(20);
      expect(scene.annotations.length).toBeGreaterThanOrEqual(2);
      expect(scene.annotations.length).toBeLessThanOrEqual(5);

      for (const citation of scene.citations) expect(sourceIds.has(citation)).toBe(true);
      for (const annotation of scene.annotations) {
        expect(annotationIds.has(annotation.id)).toBe(false);
        annotationIds.add(annotation.id);
        expect(annotation.sceneId).toBe(scene.id);
        expect(annotation.sourceIds.length).toBeGreaterThan(0);
        for (const sourceId of annotation.sourceIds) expect(sourceIds.has(sourceId)).toBe(true);
        if (annotation.selector.type === 'rect') {
          expect(annotation.selector.x + annotation.selector.width).toBeLessThanOrEqual(1);
          expect(annotation.selector.y + annotation.selector.height).toBeLessThanOrEqual(1);
        }
      }
    }

    expect(annotationIds.size).toBeGreaterThanOrEqual(116);
  });
});
