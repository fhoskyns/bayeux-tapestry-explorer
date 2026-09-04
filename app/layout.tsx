import type { Metadata } from 'next';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/600.css';
import './globals.css';

const title = 'The Bayeux Tapestry, Thread by Thread';
const description =
  'An interactive, source-led exploration of the complete surviving Bayeux Tapestry.';

export const metadata: Metadata = {
  metadataBase: new URL('https://bayeux-tapestry-explorer.vercel.app'),
  title,
  description,
  openGraph: { title, description, type: 'website', images: ['/og.png'] },
  twitter: { card: 'summary_large_image', title, description, images: ['/og.png'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
