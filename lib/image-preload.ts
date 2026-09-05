// A bounded, device-local image cache. Never fetch the archival master here.
const nearbyImages = new Map<string, HTMLImageElement>();

export function preloadSceneImages(urls: string[]) {
  if (typeof window === 'undefined') return;
  for (const url of urls) {
    if (nearbyImages.has(url)) continue;
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.src = url;
    nearbyImages.set(url, image);
    void image.decode?.().catch(() => { nearbyImages.delete(url); });
  }
  while (nearbyImages.size > 6) nearbyImages.delete(nearbyImages.keys().next().value!);
}
