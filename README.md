# antigravity-browser

<p align="left">
  <a href="https://github.com/zhonggl951-prog/antigravity-browser"><img src="https://img.shields.io/github/stars/zhonggl951-prog/antigravity-browser?style=flat-square&logo=github" alt="Stars"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg?style=flat-square" alt="License"></a>
  <a href="https://github.com/zhonggl951-prog/antigravity-browser/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome"></a>
  <img src="https://img.shields.io/badge/platform-Antigravity%20Plugin-blue.svg?style=flat-square" alt="Platform">
</p>

An in-IDE web browser and visual element inspector plugin for Google Antigravity's Aux Pane. It allows you to browse external websites and local web applications, select DOM elements, generate visual snapshots, and submit targeted modification prompts directly to your AI agent.

## Features

- **Aux Pane In-IDE Browsing**: Runs inside Antigravity's auxiliary side pane without occupying the main editor area.
- **Visual Element Inspector (Inspect)**: Hover over any DOM element on the page to highlight it. Click to open a modal that packages the element's CSS selector, HTML snippet, and rendered canvas snapshot into a structured prompt for the agent.
- **Local Reactive App Support**: Built-in WebSocket target rewriting allows local reactive apps (such as R Shiny, Streamlit, and Vite HMR) to maintain persistent WebSocket connections through the sidecar proxy.
- **Dual Execution Modes**:
  - `🛡️ Proxy`: Routes traffic through the local Node.js proxy with injected DOM inspection and screenshot capabilities.
  - `⚡ Direct`: Loads the URL directly in a native iframe for heavy computational tasks or large file uploads without proxy overhead.
- **Cross-Platform**: Tested on macOS, Windows 10/11, and Linux. Includes Windows-specific path normalization, curl command routing, and fallback system browser launchers.
- **Security Hardening**: Rejects cloud provider metadata endpoints (such as `169.254.169.254`), validates conversation UUIDs against path traversal, and enforces payload limits.

## Installation

Clone this repository into your Antigravity plugins directory:

### macOS / Linux

```bash
git clone https://github.com/zhonggl951-prog/antigravity-browser.git ~/.gemini/config/plugins/browser
```

### Windows (PowerShell)

```powershell
git clone https://github.com/zhonggl951-prog/antigravity-browser.git $env:USERPROFILE\.gemini\config\plugins\browser
```

Validate the installation with the Antigravity CLI:

```bash
agy plugin validate ~/.gemini/config/plugins/browser
```

## Usage

Open the sidecar browser by typing or clicking its URI link in your Antigravity conversation:

```markdown
[Web Browser](sidecar://browser/web_browser/ui.html)
```

1. **Browse**: Enter a URL in the address bar (e.g., `https://github.com` or local apps such as `http://127.0.0.1:7123`) and press Enter.
2. **Inspect**: Click the `🎯` icon in the toolbar to activate inspect mode.
3. **Select**: Hover over any UI element on the page and click it.
4. **Send to Agent**: Describe the change you want in the modal dialog, then press `Cmd/Ctrl + Enter`. The agent receives the element selector, HTML snippet, and rendered visual snapshot.

## Project Structure

```
antigravity-browser/
├── plugin.json               # Antigravity plugin manifest
├── sidecars/
│   └── web_browser/
│       ├── sidecar.json      # Sidecar entrypoint and view specs
│       ├── server.mjs        # Backend proxy and snapshot storage (Node.js)
│       ├── ui.html           # Aux Pane frontend interface (Light theme)
│       ├── inspector-runtime.js # DOM inspection, canvas capture, and WebSocket routing
│       └── html2canvas.min.js   # Offline canvas rendering engine
├── LICENSE                   # MIT License
└── README.md                 # Documentation
```

## Requirements

- **Node.js** (v18+)
- **curl** (pre-installed on macOS, Linux, and Windows 10 build 1803+)
- [html2canvas](https://github.com/niklasvh/html2canvas) (included)

## License

[MIT License](LICENSE)
