import { SidecarApp, Response } from 'sidecar_sdk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = new SidecarApp();

/* ---------------- Constants ---------------- */
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_BODY_BYTES = 50 * 1024 * 1024;    // hard cap for proxied response bodies
const MAX_SNAPSHOT_B64 = 10 * 1024 * 1024;  // hard cap for snapshot uploads (~7.5MB binary)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Cloud metadata endpoints must never be reachable through the proxy (SSRF hardening)
const BLOCKED_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata.oraclecloud.com'
]);

/* ---------------- Static assets ---------------- */
function readAsset(file, label) {
  try {
    return readFileSync(join(__dirname, file), 'utf-8');
  } catch {
    console.warn(`[browser-plugin] asset missing: ${file} (${label})`);
    return null;
  }
}

const HTML2CANVAS_JS = readAsset('html2canvas.min.js', 'visual snapshot engine');

const UI_FALLBACK = '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#ffffff;color:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">ui.html failed to load. Check sidecar logs.</body></html>';

function serveUI() {
  const uiHtml = readAsset('ui.html', 'sidecar UI');
  return new Response(uiHtml ?? UI_FALLBACK, { contentType: 'text/html; charset=utf-8' });
}
app.page('/ui.html', serveUI);
app.page('/', serveUI);

app.page('/html2canvas.js', () => {
  const js = HTML2CANVAS_JS ?? 'console.warn("[browser-plugin] html2canvas.min.js not found");';
  return new Response(js, { contentType: 'application/javascript; charset=utf-8' });
});

/* ---------------- Helpers ---------------- */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function errorJson(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    contentType: 'application/json',
    status,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
}

function errorHtml(status, message) {
  const body = `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#ffffff;color:#0f172a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;max-width:80%"><div style="font-size:36px;margin-bottom:12px">⚠️</div><div>${message}</div></div></body></html>`;
  return new Response(body, {
    contentType: 'text/html; charset=utf-8',
    status,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
}

function normalizeCharset(cs) {
  const c = String(cs).toLowerCase();
  // GB18030 is a superset of GBK/GB2312 — always decode with the superset
  if (c === 'gb2312' || c === 'gbk') return 'gb18030';
  return c;
}

/**
 * Decode a response body using the charset from the Content-Type header.
 * When the header omits it, sniff <meta charset> from the first 2KB
 * (works for all ASCII-compatible encodings: gbk, big5, shift_jis, euc-kr...).
 */
function decodeBodyText(buf, contentType) {
  let charset = null;
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) charset = normalizeCharset(fromHeader[1]);
  if (!charset) {
    const head = buf.subarray(0, 2048).toString('latin1');
    const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
    if (meta) charset = normalizeCharset(meta[1]);
  }
  if (!charset) charset = 'utf-8';
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString('utf-8');
  }
}

/**
 * Inject our runtime into a proxied HTML document.
 *
 * ORDER MATTERS: the <script src="/html2canvas.js"> tag MUST come BEFORE the
 * <base> tag. Once <base> is in effect, every relative URL in the document
 * resolves against the EXTERNAL site, so the library would be requested from
 * the visited website (and 404) instead of from this sidecar.
 */
function injectRuntime(html, finalUrl, autoInspect = false) {
  // A meta CSP on the visited page would block our injected runtime; strip it.
  // (Header-based CSP is already dropped because we build a fresh Response.)
  html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, '');

  const safeBase = escapeHtml(finalUrl);
  const inspectorJs = readAsset('inspector-runtime.js', 'element inspector runtime');
  const inject =
    `<script src="/html2canvas.js"><\/script>\n` +
    `<script>window.__AG_TARGET_URL = ${JSON.stringify(finalUrl)};\n` +
    `window.__AG_AUTO_INSPECT = ${autoInspect ? 'true' : 'false'};\n` +
    `${inspectorJs ?? ''}\n<\/script>\n` +
    `<base href="${safeBase}">`;

  // Handle <head> with attributes (<head lang="en"> etc.); otherwise injecting
  // before <!DOCTYPE> would flip the page into quirks mode.
  const headOpen = /<head(\s[^>]*)?>/i;
  if (headOpen.test(html)) {
    return html.replace(headOpen, (m) => m + inject);
  }
  const htmlOpen = /<html(\s[^>]*)?>/i;
  if (htmlOpen.test(html)) {
    return html.replace(htmlOpen, (m) => m + `<head>${inject}</head>`);
  }
  return inject + html;
}

/* ---------------- Snapshot storage ---------------- */
// Saves the snapshot where the Antigravity conversation can pick it up.
// The conversation id is ONLY trusted after UUID validation — anything else
// (including path-traversal attempts) falls back to a plugin-owned directory.
app.api('/api/save-snapshot', (data) => {
  try {
    const { base64, conversationId } = data || {};
    if (!base64 || typeof base64 !== 'string' || base64.length > MAX_SNAPSHOT_B64) {
      return { ok: false, error: 'Missing or oversized snapshot data' };
    }

    const convId = conversationId || process.env.ANTIGRAVITY_CONVERSATION_ID;
    let uploadDir;
    if (convId && UUID_RE.test(convId)) {
      uploadDir = join(homedir(), '.gemini/antigravity/brain', convId, '.user_uploaded');
    } else {
      uploadDir = join(homedir(), '.gemini/antigravity/browser-plugin/snapshots');
    }
    mkdirSync(uploadDir, { recursive: true });

    const filename = `component_snapshot_${Date.now()}.png`;
    const filePath = join(uploadDir, filename);
    // Strips any data-URI prefix (image/png, image/svg+xml, ...)
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    writeFileSync(filePath, Buffer.from(cleanBase64, 'base64'));

    // Ready-to-embed file:// URL (Windows needs three slashes + forward slashes)
    const fileUrl = process.platform === 'win32'
      ? 'file:///' + filePath.replace(/\\/g, '/')
      : 'file://' + filePath;

    return { ok: true, path: filePath, fileUrl, filename };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}, 'POST');

/* ---------------- Proxy ---------------- */
app.api('/api/proxy', async (data) => {
  try {
    const targetUrl = data && data.url;
    if (!targetUrl || typeof targetUrl !== 'string') {
      return errorJson(400, 'Missing url parameter');
    }

    let resolvedUrl;
    let parsed;
    try {
      resolvedUrl = targetUrl.trim();
      const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(resolvedUrl);
      if (schemeMatch) {
        // Explicit scheme present: only http(s) is allowed (blocks file://, ftp://, ...)
        if (schemeMatch[1].toLowerCase() !== 'http' && schemeMatch[1].toLowerCase() !== 'https') {
          return errorJson(400, 'Only http:// and https:// URLs are supported');
        }
      } else {
        if (/^(data|javascript|blob|file):/i.test(resolvedUrl)) {
          return errorJson(400, 'Unsupported URL scheme');
        }
        resolvedUrl = 'https://' + resolvedUrl;
      }
      parsed = new URL(resolvedUrl);
    } catch {
      return errorJson(400, 'Invalid URL');
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return errorJson(400, 'Only http:// and https:// URLs are supported');
    }
    if (BLOCKED_HOSTS.has(parsed.hostname)) {
      return errorJson(403, 'Blocked host');
    }

    const isAutoInspect = data && (data.inspect === '1' || data.inspect === 'true');
    const isRSC = data && (data.rsc === '1' || data.rsc === 'true' || resolvedUrl.includes('_rsc='));

    const headerFile = join(tmpdir(), `agb_hdr_${randomUUID()}.txt`);
    const bodyFile = join(tmpdir(), `agb_body_${randomUUID()}.bin`);

    return await new Promise((resolve) => {
      const curlArgs = [
        '-sL',
        '--compressed',
        '-m', '30',
        '--max-filesize', String(MAX_BODY_BYTES),
        '-A', UA,
        '-H', 'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
        '-D', headerFile,
        '-o', bodyFile,              // body goes to disk (no memory buffering)
        '-w', '%{url_effective}'     // stdout carries ONLY the final URL
      ];

      if (isRSC) {
        curlArgs.push('-H', 'RSC: 1');
        curlArgs.push('-H', 'Accept: text/x-component, */*');
      } else {
        curlArgs.push('-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      }

      curlArgs.push(resolvedUrl);

      const curl = spawn('curl', curlArgs);

      // stdout is just the effective (post-redirect) URL — guard against runaway output
      let effUrl = '';
      curl.stdout.on('data', (c) => {
        if (effUrl.length < 4096) effUrl += c.toString('utf-8');
      });

      let settled = false;
      const cleanup = () => {
        for (const f of [headerFile, bodyFile]) {
          try { unlinkSync(f); } catch {}
        }
      };
      const done = (resp) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(resp);
      };

      curl.on('close', (code) => {
        // The URL after following redirects — <base> must point here, NOT to
        // the originally requested URL, or relative resources break.
        const finalUrl = (effUrl || '').trim() || resolvedUrl;

        let contentType = '';
        let statusCode = 200;
        try {
          const headerData = readFileSync(headerFile, 'utf-8');
          // -D dumps every hop's headers; only the last block is the final response
          const blocks = headerData.trim().split(/\r?\n\r?\n/);
          const lastBlock = blocks[blocks.length - 1] || '';
          for (const line of lastBlock.split(/\r?\n/)) {
            const lower = line.toLowerCase();
            if (lower.startsWith('http/')) {
              const parts = line.split(' ');
              if (parts[1]) statusCode = parseInt(parts[1], 10) || 200;
            } else if (lower.startsWith('content-type:')) {
              contentType = line.slice(13).trim();
            }
          }
        } catch {}

        let body = null;
        try { body = readFileSync(bodyFile); } catch {}

        if (code === 63 || (body && body.length > MAX_BODY_BYTES)) {
          return done(errorHtml(413, 'Response too large (&gt; 50 MB)'));
        }
        if (!body || body.length === 0) {
          if (code !== 0) {
            return done(errorHtml(502, `Failed to load <b>${escapeHtml(finalUrl)}</b><br/><small>curl exit code ${code}</small>`));
          }
          return done(new Response(Buffer.alloc(0), {
            contentType: contentType || 'application/octet-stream',
            status: statusCode,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
              'Access-Control-Allow-Headers': '*'
            }
          }));
        }

        // Sniff HTML when content-type is missing or uninformative
        const headStr = body.subarray(0, 256).toString('latin1');
        const looksHtml = /<(!doctype|html|head|body|div|script|h1|p)\b/i.test(headStr);
        const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType)
          || (!contentType && looksHtml);

        if (isHtml && !isRSC) {
          const html = decodeBodyText(body, contentType || '');
          return done(new Response(injectRuntime(html, finalUrl, isAutoInspect), {
            contentType: 'text/html; charset=utf-8',
            status: statusCode,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
              'Access-Control-Allow-Headers': '*'
            }
          }));
        }
        return done(new Response(body, {
          contentType: contentType || 'application/octet-stream',
          status: statusCode,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': '*'
          }
        }));
      });

      curl.on('error', (err) => {
        done(errorHtml(502, `Failed to start curl: ${escapeHtml(err.message)}`));
      });
    });
  } catch (err) {
    return errorHtml(500, `Error: ${escapeHtml(err.message)}`);
  }
}, 'GET');

/* ---------------- Open in system browser ---------------- */
// Cross-platform, always with an error callback so a missing opener
// (e.g. no xdg-open on a bare Linux box) can never crash the sidecar.
app.api('/api/open-external', (data) => {
  const url = data && data.url;
  if (!url || typeof url !== 'string') return { ok: false, error: 'Invalid URL' };
  let u;
  try { u = new URL(url); } catch { return { ok: false, error: 'Invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) URLs can be opened' };
  }

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const candidates = isWin
    ? [
        ['rundll32', ['url.dll,FileProtocolHandler', u.href]],
        ['cmd', ['/c', 'start', '', u.href]],
        ['powershell', ['-NoProfile', '-Command', `Start-Process "${u.href}"`]]
      ]
    : isMac
      ? [['open', [u.href]]]
      : [['xdg-open', [u.href]], ['gio', ['open', u.href]]];

  let idx = 0;
  const tryNext = () => {
    if (idx >= candidates.length) return;
    const [cmd, args] = candidates[idx++];
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
      child.on('error', tryNext); // fall back to the next opener, never crash
      child.unref();
    } catch {
      tryNext();
    }
  };
  tryNext();
  return { ok: true };
}, 'POST');

/* ---------------- Startup diagnostics ---------------- */
{
  const probe = spawn('curl', ['--version']);
  probe.on('error', () => {
    console.warn('[browser-plugin] "curl" was not found on PATH — /api/proxy will not work. Install curl and restart the sidecar.');
  });
}

app.run();
