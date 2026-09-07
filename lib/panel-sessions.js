/** An embedded panel owns its requests; disconnect/navigation cancels only that panel. */
var YB_PANEL_SESSIONS = (() => {
  const VIDEO = typeof YB_VIDEO !== "undefined" ? YB_VIDEO : require("./video-platform.js");

  function create({ tasks, newId = () => crypto.randomUUID() }) {
    const sessions = new Map();
    function close(id) {
      const session = sessions.get(id);
      if (!session) return;
      sessions.delete(id);
      session.controller.abort();
      for (const taskId of session.tasks) {
        tasks.cancel(taskId);
        tasks.finish(taskId, { state: "canceled", message: "弹窗已关闭" });
      }
      session.port.disconnect();
    }
    function open(port) {
      const video = VIDEO.parseUrl(port.sender?.tab?.url);
      const tabId = port.sender?.tab?.id;
      if (!video || !Number.isInteger(tabId)) { port.disconnect(); return null; }
      const id = newId();
      const session = { id, tabId, bvid: video.key, page: video.page,
        frameId: port.sender.frameId, documentId: port.sender.documentId,
        controller: new AbortController(), tasks: new Set(), port };
      sessions.set(id, session);
      port.onDisconnect.addListener(() => close(id));
      port.onMessage.addListener((message) => {
        if (message?.action === "close") close(id);
      });
      port.postMessage({ action: "panelReady", sessionId: id, tabId, bvid: video.key, page: video.page });
      return id;
    }
    function get(id, sender) {
      const session = sessions.get(id);
      if (!session || session.tabId !== sender?.tab?.id || session.frameId !== sender.frameId ||
          (session.documentId && session.documentId !== sender.documentId)) return null;
      return session;
    }
    function track(id, taskId) { sessions.get(id)?.tasks.add(taskId); }
    function navigate(tabId, url) {
      const video = VIDEO.parseUrl(url);
      for (const session of sessions.values()) {
        if (session.tabId === tabId && (session.bvid !== video?.key || session.page !== video?.page)) close(session.id);
      }
    }
    function removeTab(tabId) {
      for (const session of sessions.values()) if (session.tabId === tabId) close(session.id);
    }
    return { open, close, get, track, navigate, removeTab };
  }
  return { create };
})();
if (typeof module !== "undefined" && module.exports) module.exports = YB_PANEL_SESSIONS;
