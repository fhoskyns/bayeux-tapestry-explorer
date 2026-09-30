/** URL bookkeeping must never interrupt the camera or exceed browser quotas. */
export function createViewerUrlSync() {
  let timer: number | undefined;
  let latest = window.location.pathname + window.location.search;
  let lastWrite = -Infinity;
  let blockedUntil = 0;
  const cancel = () => { window.clearTimeout(timer); timer = undefined; };
  const write = () => {
    timer = undefined;
    if (latest === window.location.pathname + window.location.search) return;
    lastWrite = Date.now();
    try {
      window.history.replaceState(window.history.state, '', latest);
    } catch {
      // Safari/WebKit can throw SecurityError when its History quota is hit.
      // Leave the viewer running, retain the latest share URL, and back off.
      blockedUntil = Date.now() + 30_000;
      console.warn('Viewer URL update deferred by the browser; exploration remains available.');
    }
  };
  return {
    replace(url: string, continuous: boolean) {
      latest = url;
      cancel();
      if (url === window.location.pathname + window.location.search) return;
      const delay = Math.max(0, blockedUntil - Date.now(), continuous ? lastWrite + 400 - Date.now() : 0);
      if (delay) timer = window.setTimeout(write, delay);
      else write();
    },
    shareUrl: () => new URL(latest, window.location.origin).href,
    cancel,
  };
}
