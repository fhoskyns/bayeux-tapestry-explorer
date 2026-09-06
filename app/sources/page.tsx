/* eslint-disable nextjs/no-html-link-for-pages -- Static export has no RSC navigation endpoint. */
import type { Metadata } from 'next';
import { ArrowLeft, ExternalLink, FileCheck2, GitBranch, Scale } from 'lucide-react';

import { tapestryManifest } from '@/data/tapestry-manifest';

export const metadata: Metadata = {
  title: 'Sources & rights · The Bayeux Tapestry, Thread by Thread',
  description: 'Image provenance, rights information, editorial policy and bibliography.',
};

export default function SourcesPage() {
  const { editorial, image, sources } = tapestryManifest;
  const isEditorialPreview = editorial.status !== 'publication-ready';
  const isRightsUnresolved = image.rightsStatus !== 'documented-for-publication';
  const isDziUnverified = image.dziVerificationStatus !== 'verified';
  const publicRightsNotice = isRightsUnresolved
    ? image.rightsNotice
    : image.rightsPublicationRecord?.publicNotice ?? image.rightsNotice;

  return (
    <main className="sources-page">
      <header className="site-header">
        <a className="exhibition-label" href="/">The Bayeux Tapestry, Thread by Thread</a>
        <nav aria-label="Project navigation" className="site-nav">
          <a className="nav-link sources-back" href="/"><ArrowLeft aria-hidden="true" /> Back to the tapestry</a>
        </nav>
      </header>

      <section className="sources-hero">
        <p className="eyebrow">Provenance · scholarship · reuse</p>
        <h1>Sources &amp; rights</h1>
        <p>
          This independent {isEditorialPreview ? 'editorial preview' : 'interactive edition'} presents the surviving narrative through Wikimedia Commons images. It is not affiliated with, endorsed by, or certified by the City of Bayeux, the Bayeux Museum, Wikimedia Commons, UNESCO, or any cited author or institution.
        </p>
      </section>

      <section className="rights-grid" aria-label="Rights and provenance summary">
        <article>
          <Scale aria-hidden="true" />
          <h2>Image reuse status</h2>
          <p>
            {publicRightsNotice}
          </p>
          <div className="rights-links">
            <a href={image.sourceUrl} rel="noreferrer" target="_blank">Pinned Commons revision <ExternalLink aria-hidden="true" /></a>
            <a href="https://www.bayeuxmuseum.com/wp-content/uploads/2021/03/BAYEUXTAPESTRY_GCU_Panorama.pdf" rel="noreferrer" target="_blank">Museum reuse terms <ExternalLink aria-hidden="true" /></a>
          </div>
        </article>
        <article>
          <FileCheck2 aria-hidden="true" />
          <h2>Image provenance</h2>
          <dl className="provenance-list">
            <div><dt>Source</dt><dd>{image.sourceRevision}</dd></div>
            <div><dt>Dimensions</dt><dd>{image.width.toLocaleString('en-GB')} × {image.height.toLocaleString('en-GB')} pixels</dd></div>
            <div><dt>SHA-256</dt><dd><code>{image.sha256}</code></dd></div>
            <div>
              <dt>Current display</dt>
              <dd>
                {isDziUnverified
                  ? 'The listed dimensions and SHA-256 identify the intended master image. This preview may display resized Commons images. The complete Deep Zoom derivative and its processing report have not yet been verified.'
                  : 'The listed dimensions and SHA-256 identify the verified master input. The public derivative passed the project’s matching full-pixel Deep Zoom verification gate.'}
              </dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="credit-block">
        <h2>Required image credit</h2>
        <p>{image.credit}</p>
        <p>{publicRightsNotice}</p>
      </section>

      <section className="credit-block" id="intro-credits">
        <h2>Opening sequence</h2>
        <p><a href="/?intro=replay">Replay opening</a></p>
        <p>
          The overhead opening refers to the <a href="https://www.britishmuseum.org/exhibitions/bayeux-tapestry">British Museum’s September 2026–July 2027 loan exhibition</a>, not the tapestry’s permanent home in Bayeux. It uses historical satellite and vertical aerial imagery, not a live view or a reconstruction of the exhibition interior. This project is not affiliated with either museum, Google or the imagery providers.
        </p>
        <p>
          Global and regional satellite imagery: <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/">NASA Earth Observatory / Reto Stöckli, Blue Marble Next Generation (August 2004)</a>, with regional crops via NASA GIBS. NASA imagery is used under its <a href="https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance">open data-use guidance</a>.
        </p>
        <p>London satellite imagery: <a href="https://cloudless.eox.at">EOxCloudless</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Geographic crop of the 2016 mosaic.</p>
        <p>Museum and neighbourhood overhead photography: <a href="https://environment.data.gov.uk/dataset/dae203a8-ba24-4c54-bab0-866b9faadb58">Environment Agency RGB vertical aerial photography</a>, survey catalogued 2008. © Environment Agency copyright and/or database right 2022. All rights reserved. Licensed under the <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/">Open Government Licence v3.0</a>.</p>
        <p>Intro assets are cropped, normally resampled to geographic coordinates where necessary, and compressed for display. They contain no generated or reconstructed buildings and remain under their source terms, outside the code and editorial licences. The animation uses self-hosted files with no live or metered map service.</p>
        <p>The introduction uses one local device preference to remember that it has been seen. No cookies, tracking or visitor data are sent.</p>
      </section>

      <section className="editorial-policy">
        <div>
          <p className="eyebrow">Editorial method</p>
          <h2>How the notes are made</h2>
        </div>
        <div>
          <p>
            Scene titles, summaries, English translations and annotation prose are newly written {isEditorialPreview ? 'drafts ' : ''}for this project. Commentary is paraphrased rather than copied. Notes distinguish observation, context, interpretation or conservation, name their current references, and identify contested readings.
          </p>
          <p>
            The visible ending is treated as the end of the surviving embroidery—not proof of the work&apos;s original ending. Nothing missing is reconstructed. {isEditorialPreview ? 'Production publication is pending scholarly review and verification of the final image coordinates.' : 'The published editorial record and image coordinates have completed the project’s documented review gate.'}
          </p>
          <p>
            Transcription is diplomatic in intent: stitched case, unusual letter forms and separate labels are retained where the research images permit. {isEditorialPreview ? 'Conventions vary between the two draft source sets and remain subject to palaeographic review.' : 'The published transcription conventions are recorded in the final editorial audit.'} For Harold, the project renders Latin <i>dux</i> contextually as “earl.”
          </p>
        </div>
      </section>

      <section className="bibliography">
        <div className="bibliography-heading">
          <div>
            <p className="eyebrow">Bibliography</p>
            <h2>{sources.length} cited sources</h2>
          </div>
          <p>{isEditorialPreview ? 'Bibliographic references and available locators are listed below. Some claim-specific locators remain to be verified.' : 'Bibliographic references and verified claim-specific locators are listed below.'}</p>
        </div>
        <ol>
          {sources.map((source) => (
            <li key={source.id}>
              <span>{source.author}</span>
              <a href={source.stableUrl} rel="noreferrer" target="_blank">
                <cite>{source.title}</cite> <ExternalLink aria-hidden="true" />
              </a>
              <small>{source.locator}</small>
            </li>
          ))}
        </ol>
      </section>

      <section className="licence-grid">
        <article>
          <h2>Project licences</h2>
          <p>Application code is released under the MIT License. Original editorial content is released under CC BY-NC-SA 4.0.</p>
          <p><strong>The tapestry imagery is explicitly excluded from both licences.</strong> Its reuse is governed by the source notices above and applicable law.</p>
        </article>
        <article>
          <GitBranch aria-hidden="true" />
          <h2>Corrections and takedown requests</h2>
          <p>Accuracy is an ongoing responsibility. Please open a public issue with a scene number, the relevant source, and the requested correction, or use the same route for a rights concern.</p>
          <a className="issue-link" href="https://github.com/fhoskyns/bayeux-tapestry-explorer/issues/new/choose" rel="noreferrer" target="_blank">Open a GitHub issue <ExternalLink aria-hidden="true" /></a>
        </article>
      </section>
    </main>
  );
}
