# Contributing to antigravity-browser

Contributions are welcome! Whether you are reporting a bug, proposing a new feature, or submitting improvements, follow these guidelines.

## Development Workflow

1. Fork the repository and clone your fork locally.
2. Create a feature branch:
   ```bash
   git checkout -b feat/your-feature-name
   ```
3. Test your changes locally in Google Antigravity:
   ```bash
   agy plugin validate /path/to/antigravity-browser
   ```
4. Verify code integrity with Node syntax checks:
   ```bash
   node --check sidecars/web_browser/server.mjs
   node --check sidecars/web_browser/inspector-runtime.js
   ```
5. Commit your changes with descriptive, conventional commit messages:
   ```bash
   git commit -m "feat: add support for custom proxy headers"
   ```
6. Push to your branch and open a Pull Request.

## Code Standards

- **Strict UTF-8 without BOM**.
- Keep dependencies minimal; rely on standard Node.js libraries and the Antigravity Sidecar SDK where possible.
- Ensure security boundaries (e.g. metadata blocking, path-traversal checks) are preserved.
