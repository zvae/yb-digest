#!/usr/bin/env node
"use strict";

// Optional browser QA: no real accounts, external requests, or API credits.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");

async function uiSmoke() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext();
  const out = path.join(ROOT, "test-results");
  const errors = [];
  try {
    await fs.mkdir(out, { recursive: true });
    await context.route("https://**/*", async (route) => {
      const url = new URL(route.request().url());
      if (!["digest-ui.test", "video-ui.test"].includes(url.hostname)) return route.abort();
      const file = path.resolve(ROOT, "." + decodeURIComponent(url.pathname));
      if (!file.startsWith(ROOT + path.sep)) return route.abort();
      await route.fulfill({ path: file });
    });
    await context.addInitScript(({ rootUrl }) => {
      const event = { addListener() {} };
      const stored = {};
      const platform = new URLSearchParams(location.search).get("platform") || "youtube";
      window.fixtureUrl = platform === "youtube" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : "https://www.bilibili.com/video/BV1xx411c7mD";
      const summary = { core: "通过主动提问和实践，把视频中的信息转化为可复用的知识。",
        content: ["先理解视频的整体结构，区分主题、论据与具体案例。", "结合字幕回顾关键段落，用自己的语言整理笔记。", "在实际任务中验证学到的方法，再补充自己的理解。"],
        viewpoints: ["作者认为，学习效果取决于思考与实践，而不是观看时长。", "总结应保留原有论述的限定条件，避免把个别案例当作普遍结论。"], conclusion: "围绕具体问题观看、整理和应用，形成持续反馈。" };
      window.chrome = {
        windows: { getCurrent: async () => ({ id: 1 }) },
        tabs: {
          get: async () => ({ id: 1, url: window.fixtureUrl }),
          query: async () => [{ id: 1, url: window.fixtureUrl || "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }],
          sendMessage: async () => ({ currentTime: 0 }), onActivated: event, onUpdated: event,
        },
        storage: { local: { get: async () => stored, set: async (data) => Object.assign(stored, data) }, onChanged: event },
        permissions: { request: async () => true },
        runtime: {
          getURL: (value) => rootUrl + value + (value.includes("?") ? "&" : "?") + "platform=" + platform,
          connect: () => {
            let listener, disconnect;
            const port = { onMessage: { addListener: (fn) => { listener = fn; } },
              onDisconnect: { addListener: (fn) => { disconnect = fn; } }, postMessage() {},
              disconnect: () => disconnect?.() };
            queueMicrotask(() => listener({ action: "panelReady", sessionId: "smoke", tabId: 1,
              bvid: platform === "youtube" ? "yt:dQw4w9WgXcQ" : "BV1xx411c7mD", page: 1 }));
            return port;
          },
          onMessage: event, openOptionsPage: async () => {},
          sendMessage: async (message) => {
            if (message.action === "summarizeVideo") return { success: true, summary };
            if (message.action === "fetchTranscript") {
              const youtube = message.bvid.startsWith("yt:");
              const text = youtube ? "A useful lesson about learning from videos, with time to reflect on the key ideas." : "通过字幕、概览和笔记，整理视频中的知识。";
              return { success: true, fromCache: true,
                videoInfo: { bvid: message.bvid, title: youtube ? "YouTube learning video" : "Bilibili 学习视频", owner: "Sample channel" },
                language: youtube ? "en" : "zh-CN", languageLabel: youtube ? "English" : "中文",
                transcript: [{ text, start: 0 }], segments: [{ id: "s0", text, texts: [text], start: 0 }],
              };
            }
            return { success: true, notes: [], entries: [], tasks: [] };
          },
        },
      };
    }, { rootUrl: "https://digest-ui.test/" });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://digest-ui.test/sidepanel.html");
    for (const [platform, url] of [["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"], ["bilibili", "https://www.bilibili.com/video/BV1xx411c7mD"]]) {
      await page.evaluate(async (value) => { window.fixtureUrl = value; await syncWithActiveTab(); }, url);
      await page.waitForFunction(() => state.view === "ready");
      for (const width of [360, 720]) {
        await page.setViewportSize({ width, height: 820 });
        await page.screenshot({ path: path.join(out, `${platform}-${width}.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    for (const platform of ["youtube", "bilibili"]) {
      await page.goto("https://video-ui.test/tests/helpers/dialog-fixture.html?platform=" + platform);
      await page.addScriptTag({ path: path.join(ROOT, "lib/page-dialog.js") });
      await page.evaluate(() => {
        window.dialog = YB_DIALOG.create({ document, runtime: chrome.runtime, videoKey: () => window.fixtureUrl });
        window.dialog.open();
      });
      const panel = await page.locator("#yb-digest-dialog iframe").elementHandle().then((element) => element.contentFrame());
      await panel.waitForFunction(() => state.view === "ready");
      await panel.locator('[data-tab="summary"]').click();
      await panel.locator("#summaryGenerateBtn").click();
      await panel.locator("#summaryStatus").filter({ hasText: "总结完成" }).waitFor();
      assert.ok((await panel.locator("#summaryCore").innerText()).length > 10);
      await panel.locator("#summaryCopyBtn").click();
      await panel.locator("#summaryStatus").filter({ hasText: "已复制" }).waitFor();
      const downloadPromise = page.waitForEvent("download");
      await panel.locator("#summaryExportBtn").click();
      assert.match((await downloadPromise).suggestedFilename(), /总结\.md$/);
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({ path: path.join(out, `${platform}-dialog-${width}.png`) });
        assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const bounds = await page.locator("#yb-digest-dialog .window").boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 900);
      }
      await page.getByRole("button", { name: "关闭弹窗并停止任务" }).click();
      await page.locator("#yb-digest-dialog").waitFor({ state: "detached" });
      await page.evaluate(() => window.dialog.open());
      await page.locator("#yb-digest-dialog iframe").waitFor();
      await page.evaluate(() => { window.fixtureUrl = "changed-video"; window.dialog.sync(); });
      await page.locator("#yb-digest-dialog").waitFor({ state: "detached" });
    }
    await page.goto("https://digest-ui.test/options.html");
    await page.locator("#supadataApiKey").fill("smoke-key");
    await page.locator("#youtubeSourceLanguage").selectOption("ja");
    await page.locator("#saveSubtitleBtn").click();
    await page.locator("#subtitleStatus").filter({ hasText: "字幕设置已保存" }).waitFor();
    for (const width of [360, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(out, `options-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, mode: "offline UI with mocked extension APIs", screenshots: out }));
  } finally {
    await browser.close();
  }
}

async function main() {
  if (process.argv.includes("--ui-only")) return uiSmoke();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "yb-digest-smoke-"));
  const out = path.join(ROOT, "test-results");
  await fs.mkdir(out, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    });
    const errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    await context.route("https://**/*", async (route) => {
      if (route.request().resourceType() !== "document") return route.abort();
      const youtube = new URL(route.request().url()).hostname === "www.youtube.com";
      await route.fulfill({ contentType: "text/html", body: youtube
        ? '<!doctype html><title>YouTube fixture - YouTube</title><ytd-watch-metadata><h1><yt-formatted-string>YouTube fixture</yt-formatted-string></h1><div id="top-level-buttons-computed"></div></ytd-watch-metadata><div id="movie_player"><div><video></video></div></div>'
        : '<!doctype html><title>Bilibili fixture</title><h1 class="video-title">Bilibili fixture</h1><div class="video-toolbar-left"></div><div id="bilibili-player"><div class="bpx-player-video-wrap"><video></video></div></div>' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      await learningDataReady();
      for (const [key, title, language, platform] of [
        ["yt:dQw4w9WgXcQ", "YouTube fixture", "en", "youtube"],
        ["BV1xx411c7mD", "Bilibili fixture", "zh-CN", "bilibili"],
      ]) {
        const text = platform === "youtube" ? "A useful lesson about learning from videos." : "用字幕、概览与笔记整理视频中的知识。";
        await BILI_CACHE.save(key, {
          videoInfo: { bvid: key, title, owner: "Fixture channel", duration: 120, page: 1, platform },
          transcript: [{ text, start: 0, duration: 10 }],
          segments: [{ id: "s0", text, texts: [text], start: 0 }],
          transcriptText: text, transcriptTextTimestamped: `[0:00] ${text}`,
          language, languageLabel: language, availableTracks: [{ lang: language, langLabel: language }],
        });
      }
    });

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.waitForFunction(() => typeof syncWithActiveTab === "function");
    for (const [url, key, title] of [
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "yt:dQw4w9WgXcQ", "YouTube fixture"],
      ["https://www.bilibili.com/video/BV1xx411c7mD", "BV1xx411c7mD", "Bilibili fixture"],
    ]) {
      const video = await context.newPage();
      await video.goto(url);
      await video.locator("#bili-digest-button").waitFor();
      await video.locator("#bili-digest-note-button").click();
      await panel.evaluate(() => syncWithActiveTab());
      await panel.waitForFunction((expected) => state.bvid === expected && state.view === "ready", key);
      assert.equal(await panel.locator("#videoTitle").innerText(), title);
      const notes = await panel.evaluate((bvid) => chrome.runtime.sendMessage({ action: "getNotes", bvid, page: 1 }), key);
      assert.equal(notes.notes.length, 1);
      assert.ok(notes.notes[0].timestampedUrl.startsWith(url));
      const tabId = await panel.evaluate(() => state.tabId);
      const info = await panel.evaluate((id) => chrome.tabs.sendMessage(id, { action: "getVideoInfo" }), tabId);
      assert.equal(info.bvid, key);
      await panel.evaluate((id) => chrome.tabs.sendMessage(id, { action: "seekTo", seconds: 12 }), tabId);
      assert.equal(await video.locator("video").evaluate((element) => element.currentTime), 12);
      for (const width of [360, 720]) {
        await panel.setViewportSize({ width, height: 820 });
        await panel.screenshot({ path: path.join(out, `${key.startsWith("yt:") ? "youtube" : "bilibili"}-${width}.png`) });
        assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await video.close();
    }
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.locator("#supadataApiKey").fill("smoke-key");
    await options.locator("#youtubeSourceLanguage").selectOption("ja");
    await options.locator("#saveSubtitleBtn").click();
    await options.locator("#subtitleStatus").filter({ hasText: "字幕设置已保存" }).waitFor();
    const saved = await options.evaluate(async () => (await chrome.storage.local.get("bili_digest_settings")).bili_digest_settings);
    assert.equal(saved.supadataApiKey, "smoke-key");
    assert.equal(saved.youtubeSourceLanguage, "ja");
    assert.equal(saved.aiApiKey, "");
    for (const width of [360, 1100]) {
      await options.setViewportSize({ width, height: 900 });
      await options.screenshot({ path: path.join(out, `options-${width}.png`), fullPage: true });
      assert.equal(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ success: true, extensionId, checks: ["MV3 worker", "both content scripts", "notes", "timestamps", "shared panel", "subtitle-only settings", "responsive layout"], screenshots: out }));
  } finally {
    await context?.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
