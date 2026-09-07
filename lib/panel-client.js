var YB_PANEL_CLIENT = (() => {
  function connect({ runtime, onDisconnect = () => {}, timeoutMs = 10000 }) {
    return new Promise((resolve, reject) => {
      const port = runtime.connect({ name: "digest-panel" });
      let ready = false;
      let heartbeat = null;
      const timer = setTimeout(() => { port.disconnect(); reject(new Error("弹窗连接超时，请重新打开。")); }, timeoutMs);
      port.onMessage.addListener((message) => {
        if (message?.action !== "panelReady" || ready) return;
        ready = true;
        clearTimeout(timer);
        heartbeat = setInterval(() => { try { port.postMessage({ action: "heartbeat" }); } catch (_) { port.disconnect(); } }, 20000);
        resolve({ ...message, close() { port.disconnect(); } });
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(timer);
        clearInterval(heartbeat);
        if (!ready) reject(new Error("无法建立弹窗连接，请刷新视频页面后重试。"));
        onDisconnect();
      });
    });
  }
  return { connect };
})();
if (typeof module !== "undefined" && module.exports) module.exports = YB_PANEL_CLIENT;
