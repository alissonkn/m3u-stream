# M3U Stream (Chrome Extension)

Scans every link on the active page, detects M3U playlist URLs, fetches each one (5 second timeout), validates the M3U format, and highlights the links:

- **Yellow** = identified, background is checking it
- **Green** = valid, working M3U playlist
- **Red** = invalid format, HTTP error, or timeout

## Features

- **Auto-scan** — automatically finds and highlights M3U links on page load (toggle in popup)
- **SPA support** — watches for new links added dynamically (Telegram, etc.)
- **Plain-text URLs** — also detects M3U URLs in plain text, not just `<a>` tags
- **Hover re-check** — hover over any checked link to re-validate it after a 5 second delay (toggle in popup)
- **5 second timeout** per link, validation runs in the background service worker
- **Persisted settings** — toggles are saved in Chrome storage

## Install (developer mode)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked** and select this folder
4. For `file://` pages: go to the extension **Details** and enable **Allow access to file URLs**
5. The extension icon appears in the toolbar as **M3U Stream**

## How highlighting works

| Color | Meaning |
|-------|---------|
| Yellow | identified, background is checking |
| Green  | valid, working M3U playlist |
| Red    | invalid / timeout / error |

Hover over any highlighted link to re-check it after a 5 second delay.

## Files

- `manifest.json` — extension manifest (Manifest V3)
- `content.js` — page scanning + highlighting + hover re-check
- `background.js` — fetch + M3U validation with 5s timeout
- `popup.html` / `popup.js` — toolbar popup UI
- `Icon.png` — extension icon
- `README.md` — this file

## Notes

- The manifest requests `<all_urls>` host permission so the background worker can fetch M3U files cross-origin (CORS is not a problem for extensions with host permission).
- Only `<a>` tags and plain-text URLs are scanned by default.
- Some sites may block non-browser user agents or require authentication; those show up as red/invalid.
- Does not work on special Chrome pages (`chrome://`, `chrome-extension://`, the New Tab page) — that's a Chrome security restriction.
- The extension is named **M3U Stream** in the Chrome toolbar.

## Upload to GitHub

```bash
cd /home/kapivara/m3uextension
git init
git add .
git commit -m "Initial release: M3U Stream Chrome Extension"
git remote add origin https://github.com/alissonkn/m3u-stream.git
git branch -M main
git push -u origin main
```

Replace `m3u-stream` with your preferred repository name.