# Media Downloader Unleashed!! — Chrome MV3 Port

> A powerful browser extension to detect and download videos, audio, HLS streams, subtitles, and more — ported from the original Firefox extension to Chrome Manifest V3.

---

## 🚀 Features

- 🎥 Detect and download **videos** (MP4, WebM, MKV, etc.)
- 🎵 Detect and download **audio** files (MP3, OGG, AAC, etc.)
- 📺 Download **HLS / M3U8 streams** (merges segments into a single file)
- 📝 Detect **subtitle files** (SRT, VTT, ASS, etc.)
- 📦 Batch download media as a **ZIP archive**
- 🌍 Multilingual support (English, German, French, Portuguese)
- ⚙️ Configurable settings and media filtering
- 🔍 Media preview before downloading

---

## 🌐 Browser Compatibility

| Browser | Status |
|---------|--------|
| **Google Chrome** | ✅ Supported (MV3) |
| **Brave** | ✅ Supported (MV3) |
| **Microsoft Edge** | ✅ Supported (MV3) |
| Firefox | ❌ Use the [original extension](https://github.com/helloyanis/media-downloader-unleashed) instead |

---

## 📦 Installation (Unpacked / Developer Mode)

Since this extension is not yet published to the Chrome Web Store, you need to load it manually in **4 steps**:

### Step 1 — Download the extension

Click the green **`Code`** button on this GitHub page → **`Download ZIP`**

Then **extract / unzip** the downloaded file. You'll get a folder like:
```
media-downloader-chrome-mv3-main/   ← outer folder (from GitHub)
└── manifest.json                   ← ✅ this is the folder you need
└── background.js
└── popup.html
└── ...
```

### Step 2 — Open your browser's Extensions page

| Browser | Address bar URL |
|---------|----------------|
| **Chrome** | `chrome://extensions/` |
| **Brave** | `brave://extensions/` |
| **Edge** | `edge://extensions/` |

### Step 3 — Enable Developer Mode

Toggle **"Developer mode"** ON (top-right corner of the Extensions page).

### Step 4 — Load the extension

1. Click **"Load unpacked"**
2. Navigate to and select the **extracted folder** — the one that contains `manifest.json` (this is the inner folder after extracting the ZIP)
3. Click **Select Folder**

✅ The **Media Downloader** icon will appear in your browser toolbar. Click it to start detecting and downloading media!

> 💡 **Tip:** Pin the extension to your toolbar by clicking the puzzle piece 🧩 icon → pin icon next to "Media Downloader Unleashed!!"

---

## 🛠️ How It Works

The extension passively monitors network requests made by your browser. When it detects a media file (video, audio, HLS playlist, subtitle), it records it and shows a badge count on the icon. Click the icon to open the popup, browse detected media, preview it, and download it.

### Key Technical Details (Chrome MV3 Port)

| Feature | Firefox (Original) | Chrome Port |
|---|---|---|
| Manifest Version | MV2 | **MV3** |
| Background | Background Page | **Service Worker** |
| DOM Access in BG | Available | **Offscreen Document API** |
| Response Interception | `filterResponseData` | Not available → best-effort |
| webRequest | Blocking mode | **Declarative / Observer mode** |
| `Temporal` API | Supported | **Replaced with `Date`** |
| Download headers | Supported | **Conditionally applied** |

---

## 📁 Project Structure

```
media-downloader-chrome-mv3/
├── manifest.json          # Chrome MV3 manifest
├── background.js          # Service Worker — detects media requests
├── offscreen.html         # Offscreen Document — handles DOM/ZIP/download
├── downloader.js          # Core download logic
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic
├── settings.js            # Settings page logic
├── translations.js        # i18n helper (with browser = chrome polyfill)
├── mediaPreviewer.html    # Media preview page
├── mediaPreviewer.js      # Media preview logic
├── icons/                 # Extension icons (PNG + SVG)
├── libraries/             # Bundled JS libraries (hls.js, client-zip, mdui)
├── styles/                # CSS stylesheets
└── _locales/              # Internationalization message files
    ├── en/
    ├── de/
    ├── fr/
    └── pt/
```

---

## ⚠️ Known Limitations

- **Response body caching** is not available in Chrome MV3 — the `filterResponseData` API is Firefox-only. Media URLs are captured, but the raw response bytes are not intercepted/cached.
- Some sites with aggressive anti-hotlinking may block direct downloads (use the preview to copy the URL instead).
- HLS stream downloads depend on network speed and segment count — large streams may take time.

---

## 🙏 Credits

- **Original extension:** [Media Downloader Unleashed!!](https://github.com/helloyanis/media-downloader-unleashed) by [@helloyanis](https://github.com/helloyanis)
- **Chrome MV3 port:** Adapted from the original Firefox extension
- **Libraries used:**
  - [hls.js](https://github.com/video-dev/hls.js/) — HLS stream playback & downloading
  - [client-zip](https://github.com/Touffy/client-zip) — In-browser ZIP creation
  - [MDUI](https://www.mdui.org/) — Material Design UI components

---

## 📄 License

This project is licensed under the **MIT License** — see [LICENSE](LICENSE) for details.

The original extension is also MIT licensed by [@helloyanis](https://github.com/helloyanis).

---

## 🤝 Contributing

Feel free to open issues or pull requests! Some areas that could use improvement:

- Publishing to the Chrome Web Store
- Better HLS segment error handling
- Support for DASH streams
- Improved media type detection heuristics
