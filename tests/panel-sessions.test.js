const test = require("node:test");
const assert = require("node:assert/strict");
const SESSIONS = require("../lib/panel-sessions.js");
const CLIENT = require("../lib/panel-client.js");
const TASKS = require("../lib/task-manager.js");
const { panelPort } = require("./helpers/panel-port.js");

function fixture() {
  const tasks = TASKS.createTaskManager();
  let next = 0;
  const sessions = SESSIONS.create({ tasks, newId: () => String(++next) });
  return { tasks, sessions };
}

test("disconnect cancels only tasks owned by that popup, even on the same video", () => {
  const { tasks, sessions } = fixture();
  const a = panelPort(1), b = panelPort(2);
  const first = sessions.open(a), second = sessions.open(b);
  tasks.start({ id: "a", kind: "summary", key: "a" });
  tasks.start({ id: "b", kind: "summary", key: "b" });
  sessions.track(first, "a"); sessions.track(second, "b");
  const aSignal = tasks.signal("a"), bSignal = tasks.signal("b");
  const sessionSignal = sessions.get(first, a.sender).controller.signal;
  a.disconnect();
  assert.equal(aSignal.aborted, true);
  assert.equal(sessionSignal.aborted, true);
  assert.equal(bSignal.aborted, false);
  assert.equal(tasks.get("a"), null);
  assert.equal(sessions.get(first, a.sender), null);
  assert.equal(sessions.get(second, b.sender).bvid, "BV1xx411c7mD");
});

test("navigation ignores timestamps but closes changed videos, parts and closed tabs", () => {
  const { sessions } = fixture();
  const a = panelPort();
  sessions.open(a);
  sessions.navigate(1, `${a.sender.tab.url}?t=42`);
  assert.equal(a.disconnected, false);
  sessions.navigate(2, "https://example.com");
  assert.equal(a.disconnected, false);
  sessions.navigate(1, `${a.sender.tab.url}?p=2`);
  assert.equal(a.disconnected, true);
  const b = panelPort(2, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  sessions.open(b);
  sessions.navigate(2, "https://www.youtube.com/");
  assert.equal(b.disconnected, true);
  const c = panelPort(3);
  sessions.open(c); sessions.removeTab(3);
  assert.equal(c.disconnected, true);
});

test("sessions reject unrelated documents, frames, tabs and non-video pages", () => {
  const { sessions } = fixture();
  const port = panelPort();
  const id = sessions.open(port);
  for (const patch of [{ frameId: 3 }, { documentId: "other" }, { tab: { id: 5 } }]) {
    assert.equal(sessions.get(id, { ...port.sender, ...patch }), null);
  }
  const invalid = panelPort(2, "https://example.com");
  assert.equal(sessions.open(invalid), null);
  assert.equal(invalid.disconnected, true);
});

test("panel client waits for binding and disconnect clears its heartbeat", async () => {
  const port = panelPort();
  let disconnected = 0;
  const connected = CLIENT.connect({ runtime: { connect: () => port }, onDisconnect: () => disconnected++ });
  port.onMessage.emit({ action: "panelReady", sessionId: "one", tabId: 1 });
  const client = await connected;
  assert.equal(client.sessionId, "one");
  client.close();
  assert.equal(disconnected, 1);
});

test("panel client rejects missing worker and handshake timeout", async () => {
  const port = panelPort();
  const connected = CLIENT.connect({ runtime: { connect: () => port } });
  port.disconnect();
  await assert.rejects(connected, /无法建立弹窗连接/);
  const timeout = panelPort();
  await assert.rejects(CLIENT.connect({ runtime: { connect: () => timeout }, timeoutMs: 5 }), /连接|超时/);
  assert.equal(timeout.disconnected, true);
});
