/* Popup UI: toggles, manual scan, clear highlights, summary. */

const enabledToggle = document.getElementById('enabledToggle');
const hoverToggle = document.getElementById('hoverToggle');
const scanBtn = document.getElementById('scan');
const clearBtn = document.getElementById('clear');
const list = document.getElementById('list');
const extIcon = document.getElementById('extIcon');

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// Load toggle states from storage (default: both enabled)
chrome.storage.local.get(['m3uValidatorEnabled', 'm3uValidatorHover'], (result) => {
  const enabled = result.m3uValidatorEnabled !== false; // default true
  const hover = result.m3uValidatorHover !== false; // default true
  enabledToggle.checked = enabled;
  hoverToggle.checked = hover;
  scanBtn.disabled = !enabled;
  if (!enabled) {
    console.log('Auto-scan disabled');
  }
});

// Save toggle state when changed
enabledToggle.addEventListener('change', () => {
  chrome.storage.local.set({ m3uValidatorEnabled: enabledToggle.checked });
  scanBtn.disabled = !enabledToggle.checked;
});

hoverToggle.addEventListener('change', () => {
  chrome.storage.local.set({ m3uValidatorHover: hoverToggle.checked });
});

scanBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;

  scanBtn.disabled = true;
  list.innerHTML = '';

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'scanPage' });
    if (!resp) {
      console.log('No M3U links found');
      return;
    }
    const total = (resp.valid || 0) + (resp.invalid || 0) + (resp.pending || 0);
    console.log(`Found ${total} M3U link(s): ${resp.valid} valid, ${resp.invalid} invalid, ${resp.pending || 0} checking…`);
  } catch (err) {
    console.error('Could not scan this page:', err);
  } finally {
    scanBtn.disabled = false;
  }
});

clearBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'clearHighlights' });
    list.innerHTML = '';
  } catch (err) {
    console.error('Could not clear highlights:', err);
  }
});
