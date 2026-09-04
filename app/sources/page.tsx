import type { Metadata } from 'next';
import { ArrowLeft, ExternalLink, FileCheck2, GitBranch, Scale } from 'lucide-react';
import Link from 'next/link';

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
        <Link className="exhibition-label" href="/">The Bayeux Tapestry, Thread by Thread</Link>
        <nav aria-label="Project navigation" className="site-nav">
          <Link className="nav-link sources-back" href="/"><ArrowLeft aria-hidden="true" /> Back to the tapestry</Link>
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
