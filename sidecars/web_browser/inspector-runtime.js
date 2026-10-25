/**
 * Browser-plugin injected runtime.
 * Injected by server.mjs into every proxied HTML page, BEFORE the <base> tag.
 *
 * Responsibilities:
 *   - route link clicks / window.open / GET-form submits back to the parent UI
 *   - visual element inspector with html2canvas snapshots
 *
 * NOTE: this file gets embedded inside a <script> element, so it must never
 * contain the literal sequence "</scr"+"ipt>".
 */
(function () {
  if (window.__AG_INSPECTOR_READY) return;
  window.__AG_INSPECTOR_READY = true;

  // The proxied document is same-origin with the parent UI (both are served by
  // the sidecar). Use the concrete origin when available; '*' only as a last
  // resort for opaque origins.
  var TARGET_ORIGIN = (location.origin && location.origin !== 'null') ? location.origin : '*';

  function postToParent(msg) {
    try { window.parent.postMessage(msg, TARGET_ORIGIN); } catch (e) {}
  }

  /* ---- 1. Keep navigation inside the in-IDE browser ---------------------- */
  window.open = function (url) {
    if (url) postToParent({ type: 'NAVIGATE', url: String(url) });
    return null;
  };

  /* ---- 1b. WebSocket target rewrite for local apps (R Shiny, Streamlit, Vite) ---- */
  try {
    var rawTarget = window.__AG_TARGET_URL || (document.baseURI && document.baseURI !== location.href ? document.baseURI : '');
    if (window.WebSocket && rawTarget) {
      var targetParsed = new URL(rawTarget);
      if (targetParsed.host && targetParsed.host !== location.host) {
        var OriginalWebSocket = window.WebSocket;
        window.WebSocket = function (url, protocols) {
          var destUrl = url;
          try {
            var parsedWs = new URL(url, location.href);
            // If the application tries to connect to the sidecar host, redirect it to the actual target host!
            if (parsedWs.host === location.host) {
              parsedWs.host = targetParsed.host;
              parsedWs.port = targetParsed.port;
              parsedWs.protocol = targetParsed.protocol === 'https:' ? 'wss:' : 'ws:';
              destUrl = parsedWs.href;
            }
          } catch (e) {}
          return protocols !== undefined ? new OriginalWebSocket(destUrl, protocols) : new OriginalWebSocket(destUrl);
        };
        window.WebSocket.prototype = OriginalWebSocket.prototype;
        window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        window.WebSocket.OPEN = OriginalWebSocket.OPEN;
        window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
        window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
      }
    }
  } catch (e) {}

  /* ---- 1c. Console error & exception auto-capture ------------------------- */
  try {
    window.addEventListener('error', function (event) {
      try {
        var message = event.message || (event.error && event.error.message) || 'Script Error';
        var errObj = {
          message: String(message),
          stack: (event.error && event.error.stack) ? String(event.error.stack) : '',
          filename: event.filename ? String(event.filename) : (document.baseURI || location.href),
          lineno: event.lineno || 0,
          colno: event.colno || 0,
          type: 'error',
          timestamp: Date.now()
        };
        postToParent({ type: 'CONSOLE_ERROR', error: errObj });
      } catch (e) {}
    }, true);

    window.addEventListener('unhandledrejection', function (event) {
      try {
        var reason = event.reason;
        var msg = 'Unhandled Promise Rejection';
        var stack = '';
        if (reason) {
          if (reason instanceof Error) {
            msg = reason.message || String(reason);
            stack = reason.stack || '';
          } else if (typeof reason === 'object') {
            try { msg = JSON.stringify(reason); } catch (e) { msg = String(reason); }
          } else {
            msg = String(reason);
          }
        }
        var errObj = {
          message: msg,
          stack: stack,
          filename: document.baseURI || location.href,
          lineno: 0,
          colno: 0,
          type: 'unhandledrejection',
          timestamp: Date.now()
        };
        postToParent({ type: 'CONSOLE_ERROR', error: errObj });
      } catch (e) {}
    }, true);

    if (window.console && console.error) {
      var origConsoleError = console.error;
      console.error = function () {
        try {
          var args = Array.prototype.slice.call(arguments);
          var parts = [];
          var stack = '';
          for (var i = 0; i < args.length; i++) {
            var item = args[i];
            if (item instanceof Error) {
              parts.push(item.message || String(item));
              if (!stack && item.stack) stack = item.stack;
            } else if (typeof item === 'object') {
              try { parts.push(JSON.stringify(item)); } catch (e) { parts.push(String(item)); }
            } else {
              parts.push(String(item));
            }
          }
          var msg = parts.join(' ');
          if (!stack) {
            try { stack = (new Error().stack || '').split('\n').slice(2).join('\n'); } catch (e) {}
          }
          // Avoid capturing internal browser-plugin logs
          if (msg && msg.indexOf('[browser-plugin]') === -1) {
            var errObj = {
              message: msg,
              stack: stack,
              filename: document.baseURI || location.href,
              lineno: 0,
              colno: 0,
              type: 'console.error',
              timestamp: Date.now()
            };
            postToParent({ type: 'CONSOLE_ERROR', error: errObj });
          }
        } catch (e) {}
        return origConsoleError.apply(console, arguments);
      };
    }
  } catch (e) {}

  var inspectorActive = false;
  var hoveredElement = null;
  var selectedElement = null;
  var currentSnapshotBase64 = null;

  /* ---- 2. Hover highlight overlay ---------------------------------------- */
  var overlay = document.createElement('div');
  overlay.id = '__ag_overlay';
  overlay.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483640;border:1px solid #2563eb;background:rgba(37,99,235,0.12);box-sizing:border-box;transition:top 0.04s ease,left 0.04s ease,width 0.04s ease,height 0.04s ease;';

  var badge = document.createElement('div');
  badge.id = '__ag_badge';
  badge.style.cssText = 'position:absolute;top:-22px;left:0;background:#0f172a;color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;font-weight:500;box-shadow:0 2px 4px rgba(0,0,0,0.15);pointer-events:none;line-height:1.2;';
  overlay.appendChild(badge);
  document.documentElement.appendChild(overlay);

  /* ---- 3. Prompt modal ----------------------------------------------------- */
  var modal = document.createElement('div');
  modal.id = '__ag_modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;display:none;pointer-events:none;';
  modal.innerHTML = `
    <div id="__ag_dialog" style="position:fixed;pointer-events:auto;background:#ffffff;color:#0f172a;padding:0;border-radius:8px;width:440px;max-width:calc(100vw - 32px);box-shadow:0 12px 32px -4px rgba(15,23,42,0.18),0 0 0 1px rgba(15,23,42,0.08);overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div id="__ag_modal_header" style="padding:10px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none;">
        <div style="display:flex;align-items:center;gap:8px;">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="#94a3b8" style="flex-shrink:0;">
            <circle cx="4" cy="4" r="1.5"/><circle cx="12" cy="4" r="1.5"/>
            <circle cx="4" cy="8" r="1.5"/><circle cx="12" cy="8" r="1.5"/>
            <circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/>
          </svg>
          <span style="font-size:12px;font-weight:600;color:#0f172a;letter-spacing:-0.01em;">Inspect Element</span>
          <span id="__ag_element_tag" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;background:#e2e8f0;color:#334155;padding:1px 5px;border-radius:3px;font-weight:600;text-transform:uppercase;"></span>
        </div>
        <button id="__ag_close" style="background:none;border:none;color:#94a3b8;font-size:13px;cursor:pointer;padding:2px 6px;border-radius:4px;line-height:1;display:flex;align-items:center;justify-content:center;transition:color 0.15s;" title="Close (Esc)">✕</button>
      </div>
      <div style="padding:12px 14px;background:#ffffff;">
        <div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;margin-bottom:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#475569;">
          <span id="__ag_selector" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;" title=""></span>
          <span id="__ag_size" style="color:#94a3b8;flex-shrink:0;margin-left:8px;font-size:10px;"></span>
        </div>
        <textarea id="__ag_prompt_input" placeholder="Prompt for Agent (e.g. modify styles, fix layout, inspect data)..." style="width:100%;height:84px;background:#ffffff;border:1px solid #cbd5e1;border-radius:6px;color:#0f172a;padding:8px 10px;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;resize:vertical;outline:none;line-height:1.45;box-sizing:border-box;transition:border-color 0.15s,box-shadow 0.15s;" spellcheck="false"></textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
          <div id="__ag_hint" style="font-size:11px;color:#94a3b8;display:flex;align-items:center;gap:4px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            <span>Snapshot included</span>
          </div>
          <div style="display:flex;gap:6px;">
            <button id="__ag_cancel" style="padding:5px 12px;border-radius:5px;border:1px solid #e2e8f0;background:#ffffff;color:#475569;cursor:pointer;font-size:12px;font-weight:500;transition:background 0.15s;">Cancel</button>
            <button id="__ag_send" style="padding:5px 12px;border-radius:5px;border:1px solid #0f172a;background:#0f172a;color:#ffffff;cursor:pointer;font-size:12px;font-weight:500;display:inline-flex;align-items:center;gap:5px;transition:background 0.15s;">
              <span>Send to Agent</span>
              <span style="font-size:10px;opacity:0.6;font-family:ui-monospace,monospace;">↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(modal);

  /* ---- Dragging for Prompt Modal ------------------------------------------- */
  var dialog = document.getElementById('__ag_dialog');
  var header = document.getElementById('__ag_modal_header');
  var isDragging = false;
  var dragStartX = 0;
  var dragStartY = 0;
  var initialLeft = 0;
  var initialTop = 0;

  header.addEventListener('mousedown', function (e) {
    if (e.target.closest('#__ag_close')) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    var rect = dialog.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;

    header.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    function onMouseMove(e) {
      if (!isDragging) return;
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;

      var newLeft = initialLeft + dx;
      var newTop = initialTop + dy;

      var maxLeft = window.innerWidth - dialog.offsetWidth - 8;
      var maxTop = window.innerHeight - dialog.offsetHeight - 8;
      newLeft = Math.max(8, Math.min(maxLeft, newLeft));
      newTop = Math.max(8, Math.min(maxTop, newTop));

      dialog.style.left = newLeft + 'px';
      dialog.style.top = newTop + 'px';
      dialog.style.right = 'auto';
      dialog.style.bottom = 'auto';
      dialog.style.margin = '0';
    }

    function onMouseUp() {
      if (!isDragging) return;
      isDragging = false;
      header.style.cursor = 'grab';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
    }

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
  });

  function resetModalPosition() {
    var w = Math.min(440, window.innerWidth - 32);
    dialog.style.width = w + 'px';
    var left = Math.max(16, (window.innerWidth - w) / 2);
    var top = Math.max(32, (window.innerHeight - 300) / 3);
    dialog.style.left = left + 'px';
    dialog.style.top = top + 'px';
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
    dialog.style.margin = '0';
  }

  function getSelector(el) {
    if (el.id) return '#' + el.id;
    var tag = el.tagName.toLowerCase();
    if (el.classList && el.classList.length > 0) {
      return tag + '.' + Array.from(el.classList).slice(0, 3).join('.');
    }
    return tag;
  }

  function getFullSelector(el) {
    var path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      var sel = getSelector(el);
      if (sel.startsWith('#')) { path.unshift(sel); break; }
      var parent = el.parentNode;
      if (parent) {
        var sibs = Array.from(parent.children).filter(function (c) { return c.tagName === el.tagName; });
        if (sibs.length > 1) {
          var idx = sibs.indexOf(el) + 1;
          sel += ':nth-of-type(' + idx + ')';
        }
      }
      path.unshift(sel);
      el = el.parentNode;
      if (path.length > 12) break;
    }
    return path.join(' > ');
  }

  function updateOverlay(el) {
    if (!el || !inspectorActive) {
      overlay.style.display = 'none';
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'block';
    overlay.style.top = r.top + 'px';
    overlay.style.left = r.left + 'px';
    overlay.style.width = r.width + 'px';
    overlay.style.height = r.height + 'px';
    badge.textContent = getSelector(el);
    if (r.top < 24) {
      badge.style.top = '2px';
    } else {
      badge.style.top = '-22px';
    }
  }

  /* ---- Hover detection (rAF-throttled) ---------------------------------- */
  var pendingHover = null;
  var rafId = null;
  window.addEventListener('mousemove', function (e) {
    if (!inspectorActive || modal.style.display === 'block') return;
    pendingHover = e.target;
    if (rafId === null) {
      rafId = requestAnimationFrame(function () {
        rafId = null;
        var el = pendingHover;
        pendingHover = null;
        if (!el || !el.closest) return;
        if (el.closest('#__ag_modal')) return;
        hoveredElement = el;
        updateOverlay(el);
      });
    }
  }, true);

  /* ---- Visual snapshot ---------------------------------------------------- */
  async function captureElementSnapshot(el) {
    if (typeof html2canvas !== 'function' || !el) return null;
    try {
      var capturePromise = html2canvas(el, {
        logging: false,
        useCORS: false,
        allowTaint: false,
        scale: 1,
        backgroundColor: null,
        ignoreElements: function (node) {
          if (!node || !node.tagName) return false;
          var tag = node.tagName.toLowerCase();
          if (tag === 'canvas' || tag === 'video' || tag === 'iframe') return true;
          if (node.id === '__ag_modal' || node.id === '__ag_overlay') return true;
          return false;
        }
      }).then(function (canvas) {
        return canvas.toDataURL('image/png');
      }).catch(function (err) {
        console.warn('[browser-plugin] html2canvas capture error:', err);
        return null;
      });

      var timeoutPromise = new Promise(function (resolve) {
        setTimeout(function () { resolve(null); }, 2500);
      });

      return await Promise.race([capturePromise, timeoutPromise]);
    } catch (err) {
      console.warn('[browser-plugin] html2canvas error:', err);
      return null;
    }
  }

  /* ---- Click handling ------------------------------------------------------ */
  window.addEventListener('click', async function (e) {
    if (!e.target || !e.target.closest) return;

    // Don't hijack interactions with our own modal
    if (e.target.closest('#__ag_modal')) return;

    if (inspectorActive) {
      e.preventDefault();
      e.stopPropagation();
      selectedElement = e.target;
      currentSnapshotBase64 = null;

      var tagEl = document.getElementById('__ag_element_tag');
      if (tagEl) tagEl.textContent = selectedElement.tagName.toLowerCase();

      var fullSel = getFullSelector(selectedElement);
      var selectorEl = document.getElementById('__ag_selector');
      if (selectorEl) {
        selectorEl.textContent = fullSel;
        selectorEl.title = fullSel;
      }

      var sizeEl = document.getElementById('__ag_size');
      if (sizeEl) {
        var rect = selectedElement.getBoundingClientRect();
        sizeEl.textContent = Math.round(rect.width) + ' × ' + Math.round(rect.height) + ' px';
      }

      if (!dialog.style.left || parseInt(dialog.style.left, 10) > window.innerWidth - 80 || parseInt(dialog.style.top, 10) > window.innerHeight - 80) {
        resetModalPosition();
      }

      var inputEl = document.getElementById('__ag_prompt_input');
      modal.style.display = 'block';
      if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
      }
      return;
    }

    // Regular browsing: intercept anchors so navigation stays in the proxy
    var a = e.target.closest('a');
    if (a) {
      var rawHref = a.getAttribute('href') || '';
      if (rawHref && !/^javascript:/i.test(rawHref) && !rawHref.startsWith('#')) {
        e.preventDefault();
        e.stopPropagation();
        postToParent({ type: 'NAVIGATE', url: a.href });
      }
    }
  }, true);

  /* ---- Form interception --------------------------------------------------- */
  // GET forms are rebuilt as URLs and routed through the proxy.
  // POST forms cannot be forwarded (no cookie/session support) — tell the user.
  document.addEventListener('submit', function (e) {
    var form = e.target && e.target.closest ? e.target.closest('form') : null;
    if (!form) return;
    e.preventDefault();
    e.stopPropagation();

    var method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method === 'get') {
      try {
        var action = form.getAttribute('action');
        // document.baseURI reflects our injected <base> → resolves to the
        // external site, NOT to the sidecar proxy URL.
        var url = action ? new URL(action, document.baseURI) : new URL(document.baseURI);
        var params = new URLSearchParams();
        var els = form.querySelectorAll('input, select, textarea');
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          if (!el.name || el.disabled) continue;
          var type = (el.type || '').toLowerCase();
          if (type === 'checkbox' || type === 'radio') {
            if (el.checked) params.append(el.name, el.value);
          } else if (type !== 'submit' && type !== 'button' && type !== 'image' && type !== 'file' && type !== 'reset') {
            params.append(el.name, el.value);
          }
        }
        url.search = params.toString();
        postToParent({ type: 'NAVIGATE', url: url.href });
      } catch (err) {
        postToParent({ type: 'PROXY_NOTICE', message: 'Failed to build form URL: ' + (err && err.message) });
      }
    } else {
      postToParent({
        type: 'PROXY_NOTICE',
        message: 'Form POST is not supported in the in-IDE browser (no cookie/session forwarding). Use ↗ to open in your system browser.'
      });
    }
  }, true);

  /* ---- Esc handling --------------------------------------------------------- */
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (modal.style.display === 'block') {
      e.preventDefault();
      closeModal();
    } else if (inspectorActive) {
      setInspector(false);
    }
  }, true);

  function closeModal() {
    modal.style.display = 'none';
    overlay.style.display = 'none';
  }

  document.getElementById('__ag_close').addEventListener('click', closeModal);
  document.getElementById('__ag_cancel').addEventListener('click', closeModal);

  async function doSubmit() {
    if (!selectedElement) return;
    var inputEl = document.getElementById('__ag_prompt_input');
    var sendBtn = document.getElementById('__ag_send');
    var hintEl = document.getElementById('__ag_hint');

    var userPrompt = (inputEl && inputEl.value || '').trim();
    if (!userPrompt) {
      if (inputEl) {
        inputEl.style.borderColor = '#ef4444';
        setTimeout(function () { inputEl.style.borderColor = '#cbd5e1'; }, 600);
      }
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Capturing...';

    if (!currentSnapshotBase64) {
      if (hintEl) hintEl.textContent = 'Capturing visual snapshot...';
      currentSnapshotBase64 = await captureElementSnapshot(selectedElement);
    }

    // Sends the user's request to the parent UI (which forwards it to the agent)
    postToParent({
      type: 'INSPECTOR_SUBMIT',
      payload: {
        prompt: userPrompt,
        url: location.origin === window.parent.location.origin ? document.baseURI : '',
        selector: getFullSelector(selectedElement),
        htmlSnippet: selectedElement.outerHTML ? selectedElement.outerHTML.slice(0, 2000) : '',
        innerText: selectedElement.innerText ? selectedElement.innerText.slice(0, 1000) : '',
        snapshot: currentSnapshotBase64
      }
    });

    sendBtn.textContent = 'Sent ✓';
    setTimeout(function () {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<span>Send to Agent</span><span style="font-size:10px;opacity:0.6;font-family:ui-monospace,monospace;">↵</span>';
      if (hintEl) hintEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>Snapshot included</span>';
    }, 1200);

    closeModal();
    setInspector(false);
  }

  document.getElementById('__ag_send').addEventListener('click', doSubmit);
  document.getElementById('__ag_prompt_input').addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      doSubmit();
    }
  });

  /* ---- Mode switching -------------------------------------------------------- */
  function setInspector(active) {
    inspectorActive = !!active;
    overlay.style.display = 'none';
    if (document.body) document.body.style.cursor = inspectorActive ? 'crosshair' : '';
    if (!inspectorActive) closeModal();
    postToParent({ type: 'INSPECTOR_STATE_CHANGE', active: inspectorActive });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    if (e.data && e.data.type === 'SET_INSPECTOR') setInspector(!!e.data.active);
  });
})();
