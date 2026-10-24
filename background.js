/* Background service worker: fetches M3U candidates and validates the playlist format.
   Runs multiple URLs in parallel with a concurrency cap, each with a 5s timeout. */

const TIMEOUT_MS = 5000;
const CONCURRENCY = 8;

function isValidM3u(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Standard Extended M3U marker
  if (trimmed.startsWith('#EXTM3U')) return true;
  if (trimmed.includes('#EXTINF')) return true;

  // Plain M3U: a list of URLs (one or more http/https lines)
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

async function validateAll(urls) {
  const results = new Array(urls.length);
  let idx = 0;

  const worker = async () => {
    while (idx < urls.length) {
      const i = idx++;
      results[i] = await validateOne(urls[i]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'validateLinks') {
    validateAll(msg.links).then((results) => {
      sendResponse(results);
    });
    return true; // keep the message channel open for the async response
  }
});
