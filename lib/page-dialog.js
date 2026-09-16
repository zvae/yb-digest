/** Isolated, tab-local host for the extension UI. Removing the iframe closes its runtime port. */
var YB_DIALOG = (() => {
  const MIN_WIDTH = 360;
  const MIN_HEIGHT = 280;

  function create({ document, runtime, videoKey, onClose = () => {} }) {
    let host = null;
    let frame = null;
    let boundKey = null;
    let viewportResizeHandler = null;
    // Last geometry the user dragged/resized to. Kept for the lifetime of the
    // page so the dialog reopens (SPA video switch) where the user left it.
    let savedBox = null;
    // Cleanup of the gesture in flight, if any. A release outside the window
    // delivers no pointerup at all, so gestures can outlive their end event.
    let activeCleanup = null;

    function close() {
      activeCleanup?.();
      activeCleanup = null;
      if (viewportResizeHandler) {
        document.defaultView?.removeEventListener?.("resize", viewportResizeHandler);
        viewportResizeHandler = null;
      }
      host?.remove();
      host = frame = boundKey = null;
      onClose();
    }

    /** The host is fixed inset:0, so its client size is the viewport. */
    function clampBox(box) {
      const viewW = host.clientWidth;
      const viewH = host.clientHeight;
      const w = Math.min(Math.max(box.w, MIN_WIDTH), viewW);
      const h = Math.min(Math.max(box.h, MIN_HEIGHT), viewH);
      return {
        w,
        h,
        x: Math.min(Math.max(box.x, 0), viewW - w),
        y: Math.min(Math.max(box.y, 0), viewH - h),
      };
    }

    /** Switch from the CSS right/bottom default to explicit left/top + size. */
    function applyBox(win, box) {
      savedBox = box;
      win.style.left = box.x + "px";
      win.style.top = box.y + "px";
      win.style.width = box.w + "px";
      win.style.height = box.h + "px";
      win.style.right = "auto";
      win.style.bottom = "auto";
    }

    /**
     * Shared pointer-gesture plumbing. The iframe — which swallows pointer
     * events — is disabled for the duration of the gesture, so the cleanup
     * must run under EVERY possible ending:
     * - pointerup/pointercancel on the handle (normal end, capture active),
     * - lostpointercapture (authoritative: also covers a release OUTSIDE the
     *   window, where no pointerup is ever delivered to the page),
     * - document-level pointerup/pointercancel (capture never took hold),
     * - the next pointerdown anywhere (re-entry guard, self-heals a stuck
     *   gesture on the user's very next click).
     * stop() is idempotent, so overlapping signals are harmless.
     */
    function gesture(handle, start, move) {
      handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        const ctx = start(event);
        if (!ctx) return;
        // Local ref: close() mid-gesture nulls `frame`, the cleanup must not throw.
        const pane = frame;
        event.preventDefault();
        activeCleanup?.();
        let active = true;
        const onMove = (ev) => move(ev, ctx);
        const stop = () => {
          if (!active) return;
          active = false;
          activeCleanup = null;
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
          handle.removeEventListener("lostpointercapture", stop);
          document.removeEventListener("pointerup", stop, true);
          document.removeEventListener("pointercancel", stop, true);
          document.removeEventListener("pointerdown", onForeignDown, true);
          pane.style.pointerEvents = "";
        };
        const onForeignDown = () => stop();
        activeCleanup = stop;
        try { handle.setPointerCapture(event.pointerId); } catch { /* capture unavailable; document listeners still track the gesture */ }
        pane.style.pointerEvents = "none";
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
        handle.addEventListener("lostpointercapture", stop);
        document.addEventListener("pointerup", stop, true);
        document.addEventListener("pointercancel", stop, true);
        document.addEventListener("pointerdown", onForeignDown, true);
      });
    }

    /** Drag by the title bar; the grab point stays under the cursor. */
    function makeDraggable(win, header) {
      gesture(
        header,
        (down) => {
          if (down.target.closest("button")) return null;
          const rect = win.getBoundingClientRect();
          return { x: rect.left, y: rect.top, w: rect.width, h: rect.height, grabX: down.clientX - rect.left, grabY: down.clientY - rect.top };
        },
        (ev, ctx) => applyBox(win, clampBox({ x: ev.clientX - ctx.grabX, y: ev.clientY - ctx.grabY, w: ctx.w, h: ctx.h })),
      );
    }

    /** Resize via the bottom-right corner grip; the top-left corner stays put. */
    function makeResizable(win, grip) {
      gesture(
        grip,
        (down) => {
          const rect = win.getBoundingClientRect();
          return { x: rect.left, y: rect.top };
        },
        (ev, ctx) => applyBox(win, clampBox({ x: ctx.x, y: ctx.y, w: ev.clientX - ctx.x, h: ev.clientY - ctx.y })),
      );
    }

    function open() {
      const key = videoKey();
      if (!key) return false;
      if (host?.isConnected && key === boundKey) { frame.focus(); return true; }
      close();
      boundKey = key;
      host = document.createElement("div");
      host.id = "yb-digest-dialog";
      host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `
        :host { color-scheme: light dark; }
        .window { position:absolute;right:16px;bottom:16px;width:min(560px,calc(100vw - 32px));height:min(780px,calc(100dvh - 32px));
          display:flex;flex-direction:column;overflow:hidden;pointer-events:auto;border:1px solid #bbb;border-radius:8px;
          background:Canvas;color:CanvasText;box-shadow:0 12px 40px #0004;font:14px system-ui;letter-spacing:0; }
        header { display:flex;align-items:center;justify-content:space-between;flex:none;height:42px;padding:0 12px;border-bottom:1px solid #8884;
          cursor:move;user-select:none;touch-action:none; }
        strong { font-size:14px; }
        button { width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer; }
        button:hover { background:#8883; } button:focus-visible { outline:2px solid #fb7299; }
        iframe { display:block;width:100%;flex:1;min-height:0;border:0;background:Canvas; }
        .grip { position:absolute;right:0;bottom:0;width:18px;height:18px;display:grid;place-items:center;
          cursor:nwse-resize;touch-action:none;color:inherit; }
        .grip svg { opacity:.45; }
        @media(max-width:480px) { .window { right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100dvh - 16px); } }
      `;
      const win = document.createElement("section");
      win.className = "window";
      win.setAttribute("role", "dialog");
      win.setAttribute("aria-label", "YB Digest");
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = "YB Digest";
      const button = document.createElement("button");
      button.type = "button";
      button.title = "关闭弹窗并停止任务";
      button.setAttribute("aria-label", button.title);
      // Same close icon as the extension's existing search control.
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [name, value] of Object.entries({ viewBox: "0 0 16 16", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "1.5" })) svg.setAttribute(name, value);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "m3.5 3.5 9 9M12.5 3.5l-9 9");
      svg.appendChild(path);
      button.appendChild(svg);
      button.addEventListener("click", close);
      header.append(title, button);
      frame = document.createElement("iframe");
      frame.title = "YB Digest 视频学习";
      frame.allow = "clipboard-write";
      frame.src = runtime.getURL("sidepanel.html?embedded=1");
      // Corner resize handle, same stroke style as the close icon.
      const grip = document.createElement("div");
      grip.className = "grip";
      grip.title = "拖动调整大小";
      const gripSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      for (const [name, value] of Object.entries({ viewBox: "0 0 16 16", width: "12", height: "12", fill: "none", stroke: "currentColor", "stroke-width": "1.5", "stroke-linecap": "round" })) gripSvg.setAttribute(name, value);
      const gripPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      gripPath.setAttribute("d", "M13 6.5 6.5 13M13 11l-2 2");
      gripSvg.appendChild(gripPath);
      grip.appendChild(gripSvg);
      win.append(header, frame, grip);
      shadow.append(style, win);
      document.documentElement.appendChild(host);
      makeDraggable(win, header);
      makeResizable(win, grip);
      if (savedBox) applyBox(win, clampBox(savedBox));
      // Keep a dragged/resized window inside the viewport when it shrinks.
      viewportResizeHandler = () => { if (savedBox) applyBox(win, clampBox(savedBox)); };
      document.defaultView?.addEventListener?.("resize", viewportResizeHandler);
      button.focus();
      return true;
    }
    function sync() {
      if (boundKey && (videoKey() !== boundKey || !host?.isConnected)) close();
    }
    return { open, close, sync };
  }
  return { create };
})();
if (typeof module !== "undefined" && module.exports) module.exports = YB_DIALOG;
