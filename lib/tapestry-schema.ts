import { z } from 'zod';

export const auditStatusSchema = z.enum(['draft', 'source-checked', 'audited']);

export const citationDetailSchema = z.object({
  sourceId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  locator: z.string().min(1).nullable(),
  verificationStatus: z.enum(['pending', 'verified']),
});

export const auditRecordSchema = z.object({
  reviewer: z.string().min(2),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  evidence: z.string().min(10),
});

export const rightsPublicationRecordSchema = z.object({
  reviewer: z.string().min(2),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  basis: z.string().min(20),
  evidence: z.string().min(10),
  publicNotice: z.string().min(20),
});

const normalizedNumber = z.number().min(0).max(1);

export const rectSelectorSchema = z.object({
  type: z.literal('rect'),
  x: normalizedNumber,
  y: normalizedNumber,
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});

export const polygonSelectorSchema = z.object({
  type: z.literal('polygon'),
  points: z.array(z.tuple([normalizedNumber, normalizedNumber])).min(3),
});

export const annotationSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sceneId: z.string().regex(/^\d{2}$/),
  selector: z.union([rectSelectorSchema, polygonSelectorSchema]),
  category: z.enum(['observation', 'context', 'interpretation', 'conservation']),
  title: z.string().min(2),
  preview: z.string().min(8),
  commentary: z.string().min(20),
  sourceIds: z.array(z.string()).min(1),
  citationDetails: z.array(citationDetailSchema).min(1),
  disputed: z.boolean(),
  auditStatus: auditStatusSchema,
  auditRecord: auditRecordSchema.optional(),
  calibrationStatus: z.enum(['approximate-requires-image-calibration', 'calibrated']),
});

export const sceneSchema = z.object({
  id: z.string().regex(/^\d{2}$/),
  number: z.number().int().min(1).max(58),
  title: z.string().min(2),
  pixelBounds: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  imageFilename: z.string().min(1),
  imageUrl: z.url(),
  latinInscription: z.string().min(1),
  englishTranslation: z.string().min(1),
  summary: z.string().min(20),
  annotations: z.array(annotationSchema).min(2).max(5),
  citations: z.array(z.string()).min(1),
  citationDetails: z.array(citationDetailSchema).min(1),
  auditStatus: auditStatusSchema,
  auditRecord: auditRecordSchema.optional(),
  transcriptionStatus: z.enum(['draft-requires-palaeographic-audit', 'audited']),
  calibrationStatus: z.enum(['proportional-estimate-requires-calibration', 'calibrated']),
});

export const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  author: z.string().min(2),
  title: z.string().min(2),
  publisher: z.string().min(2),
  year: z.string().min(1),
  stableUrl: z.url(),
  locator: z.string().min(1),
  rights: z.string().min(1),
  accessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const tapestryManifestSchema = z.object({
  version: z.literal('v1'),
  editorial: z.object({
    status: z.enum(['draft', 'publication-ready']),
    notice: z.string().min(20),
    transcriptionPolicy: z.string().min(20),
    coordinatePolicy: z.string().min(20),
    auditRecord: auditRecordSchema.optional(),
  }),
  image: z.object({
    width: z.literal(482096),
    height: z.literal(5550),
    dziPath: z.string().startsWith('/'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.string().min(1),
    sourceUrl: z.url(),
    credit: z.string().min(1),
    rightsNotice: z.string().min(1),
    rightsStatus: z.enum(['unresolved', 'documented-for-publication']),
    rightsPublicationRecord: rightsPublicationRecordSchema.optional(),
    dziVerificationStatus: z.enum(['unverified', 'verified']),
  }),
  scenes: z.array(sceneSchema).length(58),
  sources: z.array(sourceSchema).min(1),
}).superRefine((manifest, context) => {
  if (manifest.editorial.status === 'publication-ready' && !manifest.editorial.auditRecord) {
    context.addIssue({
      code: 'custom',
      message: 'Publication-ready editorial content requires a final audit record.',
      path: ['editorial', 'auditRecord'],
    });
  }
  if (
    manifest.image.rightsStatus === 'documented-for-publication' &&
    !manifest.image.rightsPublicationRecord
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Documented image rights require a publication record.',
      path: ['image', 'rightsPublicationRecord'],
    });
  }
});

export type AuditStatus = z.infer<typeof auditStatusSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type TapestryManifest = z.infer<typeof tapestryManifestSchema>;

export function selectorCenter(annotation: Annotation) {
  if (annotation.selector.type === 'rect') {
    return {
      x: annotation.selector.x + annotation.selector.width / 2,
      y: annotation.selector.y + annotation.selector.height / 2,
    };
  }

  const totals = annotation.selector.points.reduce(
    (sum, [x, y]) => ({ x: sum.x + x, y: sum.y + y }),
    { x: 0, y: 0 },
  );

  return {
    x: totals.x / annotation.selector.points.length,
    y: totals.y / annotation.selector.points.length,
  };
}
