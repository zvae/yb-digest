/** Isolated, tab-local host for the extension UI. Removing the iframe closes its runtime port. */
var YB_DIALOG = (() => {
  function create({ document, runtime, videoKey, onClose = () => {} }) {
    let host = null;
    let frame = null;
    let boundKey = null;
    function close() {
      host?.remove();
      host = frame = boundKey = null;
      onClose();
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
        header { display:flex;align-items:center;justify-content:space-between;flex:none;height:42px;padding:0 12px;border-bottom:1px solid #8884; }
        strong { font-size:14px; }
        button { width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:4px;background:transparent;color:inherit;cursor:pointer; }
        button:hover { background:#8883; } button:focus-visible { outline:2px solid #fb7299; }
        iframe { display:block;width:100%;flex:1;min-height:0;border:0;background:Canvas; }
        @media(max-width:480px) { .window { right:8px;bottom:8px;width:calc(100vw - 16px);height:calc(100dvh - 16px); } }
      `;
      const window = document.createElement("section");
      window.className = "window";
      window.setAttribute("role", "dialog");
      window.setAttribute("aria-label", "YB Digest");
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
      window.append(header, frame);
      shadow.append(style, window);
      document.documentElement.appendChild(host);
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
