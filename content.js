/* Content script: auto-scans the page for M3U links and highlights results.
   Respects the enable/disable toggle stored in chrome.storage.
   Status flow: identified (yellow) -> validating -> valid (green) / invalid (red).
   Hovering over a checked link re-validates that specific URL. */

const STATUS_ATTR = 'data-m3u-status';
const M3U_EXTS = ['.m3u', '.m3u8'];

const checkedUrls = new Set();
let observer = null;
let scanTimeout = null;
let enabled = true;
let hoverEnabled = true;

const hoverCheckTime = new Map();
const HOVER_DEBOUNCE_MS = 3000;
const HOVER_RECHECK_DELAY_MS = 5000; // wait 5s before re-checking on hover
const hoverTimeouts = new Map(); // url -> setTimeout id

console.log('[M3U Stream] content script loaded');

function isM3uUrl(url) {
  try {
    const u = new URL(url);
    const lower = u.href.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    return M3U_EXTS.some(ext => pathname.endsWith(ext)) || /m3u8?/.test(lower);
  } catch {
    return false;
  }
}

function applyInlineStyles(el, status) {
  el.style.transition = 'outline 0.1s, background 0.1s';
  if (status === 'pending') {
    el.style.outline = '3px solid #ca8a04';
    el.style.outlineOffset = '2px';
    el.style.backgroundColor = 'rgba(202, 138, 4, 0.15)';
    el.style.borderRadius = '4px';
  } else if (status === 'valid') {
    el.style.outline = '3px solid #15803d';
    el.style.outlineOffset = '2px';
    el.style.backgroundColor = 'rgba(21, 128, 61, 0.15)';
    el.style.borderRadius = '4px';
  } else if (status === 'invalid') {
    el.style.outline = '3px solid #b91c1c';
    el.style.outlineOffset = '2px';
    el.style.backgroundColor = 'rgba(185, 28, 28, 0.15)';
    el.style.borderRadius = '4px';
  }
}

function clearHighlights() {
  document.querySelectorAll(`[${STATUS_ATTR}]`).forEach((el) => {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.backgroundColor = '';
    el.style.borderRadius = '';
    el.style.transition = '';
    el.removeAttribute(STATUS_ATTR);
  });
}

function highlight(el, status, message) {
  el.removeAttribute(STATUS_ATTR);
  el.setAttribute(STATUS_ATTR, status);
  applyInlineStyles(el, status);
  el.title = message || `M3U: ${status}`;
  console.log(`[M3U Stream] highlighted ${el.href || el.textContent} as ${status}`);
}

function countHighlights() {
  let valid = 0;
  let invalid = 0;
  let pending = 0;
  document.querySelectorAll(`[${STATUS_ATTR}]`).forEach((el) => {
    const s = el.getAttribute(STATUS_ATTR);
    if (s === 'valid') valid++;
    else if (s === 'invalid') invalid++;
    else if (s === 'pending') pending++;
  });
  return { valid, invalid, pending };
}

// Wrap a plain text URL node in a <span> so we can highlight it
function wrapTextUrl(textNode, url) {
  const span = document.createElement('span');
  span.style.textDecoration = 'underline';
  span.style.cursor = 'pointer';
  span.title = url;
  span.href = url; // for consistency with anchor elements
  span.textContent = url;
  textNode.parentNode.replaceChild(span, textNode);
  return span;
}

function collectLinks() {
  const links = [];
  const seen = new Set();

  // 1. Scan <a href> tags
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href;
    if (!href || seen.has(href)) return;
    seen.add(href);
    if (isM3uUrl(href)) {
      links.push({ element: a, url: href });
    }
  });

  // 2. Scan plain text URLs in text nodes (Telegram, etc.)
  const urlRegex = /https?:\/\/[^\s<>"'()]+/gi;
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  textNodes.forEach((textNode) => {
    let match;
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(textNode.textContent)) !== null) {
      const url = match[0];
      if (seen.has(url)) continue;
      seen.add(url);
      if (isM3uUrl(url)) {
        // Wrap the matched text in a span so we can style it
        const span = wrapTextUrl(textNode, url);
        links.push({ element: span, url });
      }
    }
  });

  return links;
}

async function validateAndHighlight(el, url) {
  highlight(el, 'pending', 'Re-checking on hover…');

  try {
    const results = await chrome.runtime.sendMessage({
      action: 'validateLinks',
      links: [url],
    });

    const r = results && results[0];
    if (r) {
      highlight(el, r.status, r.message || '');
    } else {
      highlight(el, 'invalid', 'No response from background');
    }
  } catch (err) {
    console.error('[M3U Stream] sendMessage failed:', err);
    highlight(el, 'invalid', 'Extension error');
  }
}

async function scanLinks(links) {
  if (links.length === 0) return countHighlights();

  const newLinks = links.filter((l) => !checkedUrls.has(l.url));
  if (newLinks.length === 0) return countHighlights();

  console.log(`[M3U Stream] found ${newLinks.length} new M3U link(s) to check`);

  newLinks.forEach((l) => {
    checkedUrls.add(l.url);
    highlight(l.element, 'pending', 'Identified — checking in background…');
  });

  try {
    const results = await chrome.runtime.sendMessage({
      action: 'validateLinks',
      links: newLinks.map((l) => l.url),
    });

    const byUrl = new Map(results.map((r) => [r.url, r]));

    newLinks.forEach((l) => {
      const r = byUrl.get(l.url);
      if (!r) {
        highlight(l.element, 'invalid', 'No response');
        return;
      }
      highlight(l.element, r.status, r.message || '');
    });
  } catch (err) {
    console.error('[M3U Stream] sendMessage failed:', err);
  }

  return countHighlights();
}

function collectLinksFromElement(el) {
  const links = [];
  const seen = new Set();

  el.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href;
    if (!href || seen.has(href)) return;
    seen.add(href);
    if (isM3uUrl(href)) {
      links.push({ element: a, url: href });
    }
  });

  return links;
}

async function runScan() {
  if (!enabled) return countHighlights();
  console.log('[M3U Stream] running scan');
  const links = collectLinks();
  console.log(`[M3U Stream] total M3U links on page: ${links.length}`);
  return await scanLinks(links);
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (!enabled) return;
    let hasNewLinks = false;
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('a[href]')) hasNewLinks = true;
        if (node.querySelectorAll && node.querySelectorAll('a[href]').length > 0) hasNewLinks = true;
      });
    });
    if (!hasNewLinks) return;

    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(async () => {
      await runScan();
    }, 800);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  console.log('[M3U Stream] observer started');
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  clearTimeout(scanTimeout);
}

// Hover re-check: only the link under your mouse (5s delay before re-check)
document.addEventListener('mouseenter', (e) => {
  try {
    if (!enabled || !hoverEnabled) return;
    if (!(e.target instanceof Element)) return;

    const link = e.target.closest('a[href], span[href]');
    if (!link) return;

    const href = link.href;
    if (!href || !isM3uUrl(href)) return;

    // Only re-check links that already have an M3U status attribute (already scanned)
    if (!link.hasAttribute(STATUS_ATTR)) return;

    const now = Date.now();
    const last = hoverCheckTime.get(href) || 0;
    if (now - last < HOVER_DEBOUNCE_MS) return;

    // Cancel any existing pending re-check for this URL
    const existing = hoverTimeouts.get(href);
    if (existing) clearTimeout(existing);

    // Highlight yellow immediately on hover
    highlight(link, 'pending', 'Hovering — will re-check in 5s…');

    // Set 5s delay before actual re-check
    const timer = setTimeout(() => {
      hoverTimeouts.delete(href);
      validateAndHighlight(link, href);
    }, HOVER_RECHECK_DELAY_MS);

    hoverTimeouts.set(href, timer);
  } catch (err) {
    console.error('[M3U Stream] hover error:', err);
  }
}, true);

// Cancel pending hover re-check if mouse leaves before the 5s delay
document.addEventListener('mouseleave', (e) => {
  try {
    if (!(e.target instanceof Element)) return;
    const link = e.target.closest('a[href], span[href]');
    if (!link) return;
    const href = link.href;
    if (!href) return;

    const timer = hoverTimeouts.get(href);
    if (timer) {
      clearTimeout(timer);
      hoverTimeouts.delete(href);
      // If still pending, reset to its previous status or just leave as-is
      if (link.getAttribute(STATUS_ATTR) === 'pending') {
        highlight(link, 'invalid', 'Hover cancelled');
      }
    }
  } catch (err) {
    console.error('[M3U Stream] mouseleave error:', err);
  }
}, true);

chrome.storage.local.get(['m3uValidatorEnabled', 'm3uValidatorHover'], (result) => {
  enabled = result.m3uValidatorEnabled !== false;
  hoverEnabled = result.m3uValidatorHover !== false;
  console.log('[M3U Stream] storage loaded: enabled=', enabled, 'hover=', hoverEnabled);

  if (enabled) {
    runScan().catch(console.error);
    startObserver();
  } else {
    stopObserver();
    clearHighlights();
    checkedUrls.clear();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.m3uValidatorEnabled) {
    enabled = changes.m3uValidatorEnabled.newValue !== false;
    if (enabled) {
      runScan().catch(console.error);
      startObserver();
    } else {
      stopObserver();
      clearHighlights();
      checkedUrls.clear();
    }
  }
  if (changes.m3uValidatorHover) {
    hoverEnabled = changes.m3uValidatorHover.newValue !== false;
  }
});

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.action === 'scanPage') {
    if (!enabled) {
      sendResponse({ valid: 0, invalid: 0, pending: 0 });
      return true;
    }
    checkedUrls.clear();
    clearHighlights();
    const counts = await runScan();
    sendResponse(counts);
    return true;
  }

  if (msg.action === 'clearHighlights') {
    checkedUrls.clear();
    stopObserver();
    clearHighlights();
    if (enabled) startObserver();
    sendResponse({ ok: true });
    return true;
  }
});
