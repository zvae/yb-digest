var YB_PANEL_CLIENT = (() => {
  function connect({ runtime, onDisconnect = () => {}, timeoutMs = 10000 }) {
    return new Promise((resolve, reject) => {
      let port;
      try {
        // 扩展被重载/更新后旧上下文的 runtime 已失效，connect 会同步抛
        // "Extension context invalidated"，必须在这里兜住转成可读提示。
        port = runtime.connect({ name: "digest-panel" });
      } catch (error) {
        const invalidated = /context invalidated/i.test(String(error?.message || error));
        reject(new Error(invalidated
          ? "扩展已更新或重新加载，请关闭弹窗并刷新页面后重试。"
          : `无法建立弹窗连接：${error?.message || error}`));
        return;
      }
      let ready = false;
      let heartbeat = null;
      const timer = setTimeout(() => { try { port.disconnect(); } catch (_) {} reject(new Error("弹窗连接超时，请重新打开。")); }, timeoutMs);
      port.onMessage.addListener((message) => {
        if (message?.action !== "panelReady" || ready) return;
        ready = true;
        clearTimeout(timer);
        heartbeat = setInterval(() => { try { port.postMessage({ action: "heartbeat" }); } catch (_) { try { port.disconnect(); } catch (__) {} } }, 20000);
        resolve({ ...message, close() { try { port.disconnect(); } catch (_) {} } });
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
