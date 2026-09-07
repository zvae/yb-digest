function event() {
  const listeners = [];
  return { addListener: (fn) => listeners.push(fn), emit: (...args) => listeners.forEach((fn) => fn(...args)) };
}

function panelPort(tabId = 1, url = "https://www.bilibili.com/video/BV1xx411c7mD") {
  const port = {
    name: "digest-panel",
    sender: { tab: { id: tabId, url }, frameId: 2, documentId: `document-${tabId}`, url: "sidepanel.html?embedded=1" },
    onDisconnect: event(), onMessage: event(), messages: [], disconnected: false,
    postMessage(message) { this.messages.push(message); },
    disconnect() {
      if (this.disconnected) return;
      this.disconnected = true;
      this.onDisconnect.emit();
    },
  };
  return port;
}
module.exports = { event, panelPort };
