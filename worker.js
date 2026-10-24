/* Dedicated web worker: validates a single M3U URL on its own thread. */

const TIMEOUT_MS = 5000;

function isValidM3u(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Extended M3U marker
  if (trimmed.startsWith('#EXTM3U')) return true;
  if (trimmed.includes('#EXTINF')) return true;

  // Plain M3U: one or more http/https lines
  const lines = trimmed.split(/[\r\n]+/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const urlLines = lines.filter((l) => /^https?:\/\//i.test(l));
  return urlLines.length >= 1;
}

async function validateOne(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });

    if (!res.ok) {
      return { url, status: 'invalid', message: `HTTP ${res.status}` };
    }

    const text = await res.text();
    const ok = isValidM3u(text);
    return {
      url,
      status: ok ? 'valid' : 'invalid',
      message: ok ? 'Valid M3U playlist' : 'Not a valid M3U playlist',
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { url, status: 'invalid', message: 'Timeout (5s)' };
    }
    return { url, status: 'invalid', message: err.message || 'Request failed' };
  } finally {
    clearTimeout(timer);
  }
}

self.onmessage = async (e) => {
  const { url } = e.data || {};
  if (!url) {
    self.postMessage({ url, status: 'invalid', message: 'No URL provided' });
    return;
  }
  const result = await validateOne(url);
  self.postMessage(result);
};
