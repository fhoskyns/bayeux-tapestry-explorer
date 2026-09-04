import { TapestryExplorer } from '@/components/tapestry-explorer';
import { tapestryManifest } from '@/data/tapestry-manifest';

export const dynamic = 'force-static';

export default function Home() {
  return <TapestryExplorer manifest={tapestryManifest} />;
}
