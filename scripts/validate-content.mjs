import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'data/tapestry-manifest.json'), 'utf8'));
const release = process.argv.includes('--release') || manifest.editorial?.status === 'publication-ready';
const publicBeta = process.argv.includes('--public-beta');
const failures = [];

function fail(message) {
  failures.push(message);
}

if (publicBeta) {
  try {
    const policy = JSON.parse(await readFile(path.join(root, 'data/publication-policy.json'), 'utf8'));
    if (policy.schemaVersion !== 1 || policy.channel !== 'public-beta' || policy.approvedBy !== 'project-owner' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(policy.approvedAt) || typeof policy.scope !== 'string' || policy.scope.length < 40 ||
        policy.imageSha256 !== manifest.image.sha256 || typeof policy.notice !== 'string' || policy.notice.length < 100) {
      fail('Public beta requires explicit owner authorization, the locked image and an unfinished-review/rights notice.');
    }
  } catch (error) {
    fail(`Public-beta authorization could not be validated: ${error.message}`);
  }
}

function isAuditRecord(record) {
  return Boolean(
    record &&
      typeof record.reviewer === 'string' &&
      record.reviewer.trim().length >= 2 &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt) &&
      typeof record.evidence === 'string' &&
      record.evidence.trim().length >= 10,
  );
}

function isRightsPublicationRecord(record) {
  return Boolean(
    record &&
      typeof record.reviewer === 'string' &&
      record.reviewer.trim().length >= 2 &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt) &&
      typeof record.basis === 'string' &&
      record.basis.trim().length >= 20 &&
      typeof record.evidence === 'string' &&
      record.evidence.trim().length >= 10 &&
      typeof record.publicNotice === 'string' &&
      record.publicNotice.trim().length >= 20,
  );
}

const sourceIds = new Set();
for (const source of manifest.sources) {
  if (sourceIds.has(source.id)) fail(`Duplicate source ID ${source.id}.`);
  sourceIds.add(source.id);
}

const annotationIds = new Set();
if (manifest.scenes.length !== 58) fail(`Expected 58 scenes, found ${manifest.scenes.length}.`);
let expectedX = 0;

for (const [index, scene] of manifest.scenes.entries()) {
  const number = index + 1;
  if (scene.number !== number || scene.id !== String(number).padStart(2, '0')) {
    fail(`Scene order fails at ${scene.id}.`);
  }
  if (scene.pixelBounds.x !== expectedX) fail(`Scene ${scene.id} does not start at ${expectedX}.`);
  if (scene.pixelBounds.y !== 0 || scene.pixelBounds.height !== manifest.image.height) {
    fail(`Scene ${scene.id} does not cover the full image height.`);
  }
  expectedX += scene.pixelBounds.width;
  if (!scene.latinInscription?.trim() || !scene.englishTranslation?.trim()) {
    fail(`Scene ${scene.id} is missing Latin or English text.`);
  }
  if (scene.annotations.length < 2 || scene.annotations.length > 5) {
    fail(`Scene ${scene.id} has ${scene.annotations.length} annotations.`);
  }
  if (release && scene.auditStatus !== 'audited') fail(`Scene ${scene.id} is not audited for release.`);
  if (release && !isAuditRecord(scene.auditRecord)) fail(`Scene ${scene.id} lacks an evidence-bearing audit record.`);
  if (release && scene.transcriptionStatus !== 'audited') fail(`Scene ${scene.id} transcription is not audited.`);
  if (release && scene.calibrationStatus !== 'calibrated') fail(`Scene ${scene.id} bounds are not calibrated.`);

  const sceneCitationIds = new Set(scene.citations);
  if (sceneCitationIds.size !== scene.citations.length) fail(`Scene ${scene.id} repeats a citation.`);
  for (const sourceId of scene.citations) {
    if (!sourceIds.has(sourceId)) fail(`Scene ${scene.id} cites unknown source ${sourceId}.`);
  }
  const detailIds = new Set(scene.citationDetails.map((citation) => citation.sourceId));
  if (detailIds.size !== scene.citationDetails.length || detailIds.size !== sceneCitationIds.size) {
    fail(`Scene ${scene.id} citation details do not correspond one-to-one with citations.`);
  }
  for (const sourceId of sceneCitationIds) {
    if (!detailIds.has(sourceId)) fail(`Scene ${scene.id} lacks citation detail for ${sourceId}.`);
  }
  if (release && scene.citationDetails.some((citation) => citation.verificationStatus !== 'verified' || !citation.locator)) {
    fail(`Scene ${scene.id} has an unverified or unlocated citation.`);
  }

  for (const annotation of scene.annotations) {
    if (annotationIds.has(annotation.id)) fail(`Duplicate annotation ID ${annotation.id}.`);
    annotationIds.add(annotation.id);
    if (annotation.sceneId !== scene.id) fail(`Annotation ${annotation.id} has the wrong scene ID.`);
    if (release && annotation.auditStatus !== 'audited') fail(`Annotation ${annotation.id} is not audited for release.`);
    if (release && !isAuditRecord(annotation.auditRecord)) fail(`Annotation ${annotation.id} lacks an evidence-bearing audit record.`);
    if (release && annotation.calibrationStatus !== 'calibrated') fail(`Annotation ${annotation.id} is not calibrated.`);

    const annotationSourceIds = new Set(annotation.sourceIds);
    if (annotationSourceIds.size !== annotation.sourceIds.length) fail(`Annotation ${annotation.id} repeats a source.`);
    for (const sourceId of annotation.sourceIds) {
      if (!sourceIds.has(sourceId)) fail(`Annotation ${annotation.id} cites unknown source ${sourceId}.`);
    }
    const annotationDetailIds = new Set(annotation.citationDetails.map((citation) => citation.sourceId));
    if (annotationDetailIds.size !== annotation.citationDetails.length || annotationDetailIds.size !== annotationSourceIds.size) {
      fail(`Annotation ${annotation.id} citation details do not correspond one-to-one with sources.`);
    }
    for (const sourceId of annotationSourceIds) {
      if (!annotationDetailIds.has(sourceId)) fail(`Annotation ${annotation.id} lacks citation detail for ${sourceId}.`);
    }
    if (release && annotation.citationDetails.some((citation) => citation.verificationStatus !== 'verified' || !citation.locator)) {
      fail(`Annotation ${annotation.id} has an unverified or unlocated citation.`);
    }

    const selector = annotation.selector;
    if (
      selector.type === 'rect' &&
      (selector.x < 0 || selector.y < 0 || selector.x + selector.width > 1 || selector.y + selector.height > 1)
    ) {
      fail(`Annotation ${annotation.id} is out of bounds.`);
    }
    if (
      selector.type === 'polygon' &&
      selector.points.some(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1)
    ) {
      fail(`Annotation ${annotation.id} has an out-of-bounds polygon point.`);
    }
  }
}

if (expectedX !== manifest.image.width) {
  fail(`Scene coverage ends at ${expectedX}, not ${manifest.image.width}.`);
}

if (release) {
  if (manifest.editorial?.status !== 'publication-ready') {
    fail('The global editorial record is not publication-ready.');
  }
  if (!isAuditRecord(manifest.editorial?.auditRecord)) {
    fail('The global editorial record lacks evidence-bearing final review.');
  }
  if (manifest.image?.rightsStatus !== 'documented-for-publication') {
    fail('The image publication basis remains unresolved.');
  }
  if (!isRightsPublicationRecord(manifest.image?.rightsPublicationRecord)) {
    fail('The image publication basis lacks a reviewed evidence record and public notice.');
  }
}

// Public beta relaxes only the editorial/publication-review requirement, not
// source identity, pixel integrity, complete coverage or hosted tile evidence.
if (release || publicBeta) {
  if (manifest.image?.dziVerificationStatus !== 'verified') {
    fail('The public Deep Zoom derivative is not marked as verified.');
  }

  const reportPath = path.join(root, 'release-evidence/deepzoom-v1-verification.json');
  const lockPath = path.join(root, 'infrastructure/deepzoom/source-lock.json');
  try {
    const [report, lock] = await Promise.all([
      readFile(reportPath, 'utf8').then(JSON.parse),
      readFile(lockPath, 'utf8').then(JSON.parse),
    ]);
    const tileSize = 1024;
    const expectedMaxLevel = Math.ceil(Math.log2(Math.max(manifest.image.width, manifest.image.height)));
    let expectedTileCount = 0;
    let expectedSeams = 0;
    let expectedTopTiles = 0;
    for (let level = 0; level <= expectedMaxLevel; level += 1) {
      const divisor = 2 ** (expectedMaxLevel - level);
      const levelWidth = Math.ceil(manifest.image.width / divisor);
      const levelHeight = Math.ceil(manifest.image.height / divisor);
      const columns = Math.ceil(levelWidth / tileSize);
      const rows = Math.ceil(levelHeight / tileSize);
      const levelTiles = columns * rows;
      expectedTileCount += levelTiles;
      expectedSeams += (columns - 1) * rows + (rows - 1) * columns;
      if (level === expectedMaxLevel) expectedTopTiles = levelTiles;
    }
    if (report.schemaVersion !== 1 || report.result !== 'pass') fail('Deep Zoom report is not a passing schema-v1 report.');
    if (report.assetId !== 'bayeux-tapestry' || report.publicationVersion !== manifest.version) {
      fail('Deep Zoom report identifies the wrong asset or publication version.');
    }
    if (
      report.source?.sha256 !== manifest.image.sha256 ||
      report.source?.sha256 !== lock.source?.sha256 ||
      report.source?.width !== manifest.image.width ||
      report.source?.height !== manifest.image.height ||
      report.source?.bytes !== lock.source?.bytes
    ) {
      fail('Deep Zoom report does not correspond to the locked manifest source.');
    }
    if (
      report.pyramid?.format !== 'webp' ||
      report.pyramid?.lossless !== true ||
      report.pyramid?.tileSize !== tileSize ||
      report.pyramid?.overlap !== 1 ||
      report.pyramid?.maxLevel !== expectedMaxLevel ||
      report.pyramid?.sourcePixelsChecked !== true ||
      report.pyramid?.sourceTilesChecked !== expectedTopTiles ||
      report.pyramid?.tileCount !== expectedTileCount ||
      report.pyramid?.seamsChecked !== expectedSeams
    ) {
      fail('Deep Zoom report does not prove the required complete lossless full-pixel verification.');
    }
    if (
      report.toolchain?.sharp !== lock.toolchain?.sharp ||
      report.toolchain?.libvips !== lock.toolchain?.libvips
    ) {
      fail('Deep Zoom report toolchain differs from the source lock.');
    }
    const remote = JSON.parse(await readFile(path.join(root, 'release-evidence/deepzoom-v1-remote-verification.json'), 'utf8'));
    if (remote.schemaVersion !== 1 || remote.result !== 'pass' || remote.sourceSha256 !== manifest.image.sha256 ||
        remote.tileCount !== expectedTileCount || remote.objectCount !== expectedTileCount + 1 || !/^[a-f0-9]{64}$/.test(remote.inventorySha256)) {
      fail('Hosted Deep Zoom evidence does not prove complete verified delivery of the locked image.');
    }
    const tileBase = process.env.VITE_TAPESTRY_TILE_BASE_URL?.trim();
    if (tileBase && tileBase !== `${remote.origin}/v1`) fail('The configured tile origin differs from the verified hosted origin.');
  } catch (error) {
    fail(`The Deep Zoom verification record could not be validated: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${manifest.scenes.length} scenes, ${annotationIds.size} annotations and ${sourceIds.size} sources${release ? ' for audited release' : publicBeta ? ' for an owner-authorized public beta; editorial review remains incomplete' : ' as a structural editorial draft'}.`,
);
