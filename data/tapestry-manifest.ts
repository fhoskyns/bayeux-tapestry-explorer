import rawManifest from './tapestry-manifest.json';

import { tapestryManifestSchema } from '@/lib/tapestry-schema';

export const tapestryManifest = tapestryManifestSchema.parse(rawManifest);
