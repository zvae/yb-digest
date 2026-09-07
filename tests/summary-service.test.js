const test = require("node:test");
const assert = require("node:assert/strict");
const SERVICE = require("../lib/summary-service.js");
const LEARNING = require("../lib/learning-store.js");
const SUMMARY = { core: "核心主题", content: ["主要内容"], viewpoints: ["作者的观点"], conclusion: "结论" };

function fixture({ segments = [{ text: "完整字幕", start: 0 }], reply, saved, cached } = {}) {
  const records = new Map(saved ? [[saved.learningId, saved]] : []);
  const cache = new Map(cached ? [["BV1xx411c7mD:p1", cached]] : []);
  const calls = [];
  const repository = { find: async (id) => records.get(id), save: async (record) => records.set(record.learningId, record) };
  const service = SERVICE.create({
    cache: { load: async (id, { page }) => cache.get(`${id}:p${page}`) },
    updateCache: async (id, page, update) => cache.set(`${id}:p${page}`, update(cache.get(`${id}:p${page}`) || {})),
    ensureTranscript: async () => ({ success: true, segments, videoInfo: { title: "标题", owner: "作者" } }),
    dataReady: async () => {}, learningRepository: () => repository,
    getSettings: async () => ({ aiConcurrency: 1 }),
    loadPromptSection: async (_, section, vars) => section === "用户提示词" ? vars.material : vars.stage,
    requestAiCompletion: async (request) => {
      calls.push(request);
      return { text: JSON.stringify(reply ? await reply(request, calls.length) : SUMMARY) };
    },
    aiErrorResponse: (error) => ({ success: false, error: error.code || "AI_FAILED", message: error.message }),
  });
  return { service, calls, records, cache, repository };
}

test("whole-video summary persists on both platforms and is reusable without AI", async () => {
  const h = fixture();
  for (const [bvid, page] of [["BV1xx411c7mD", 2], ["yt:dQw4w9WgXcQ", 9]]) {
    const result = await h.service.summarize(bvid, { page });
    assert.deepEqual(result.summary, SUMMARY);
    const part = bvid.startsWith("yt:") ? 1 : page;
    assert.deepEqual(h.records.get(`${bvid}:p${part}`).summary, SUMMARY);
    assert.equal((await h.service.summarize(bvid, { page })).fromCache, true);
  }
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[0].messages[1].content, /完整字幕/);
});

test("long videos include every chunk and hierarchically synthesize the last one", async () => {
  const segments = Array.from({ length: 5 }, (_, index) => ({ start: index * 100, text: `${index}:` + "字".repeat(5000) }));
  const h = fixture({ segments, reply: (request, count) => ({ ...SUMMARY, core: `提炼-${count}` }) });
  assert.equal((await h.service.summarize("BV1xx411c7mD")).success, true);
  assert.equal(h.calls.length, 9);
  for (let i = 0; i < 5; i++) assert.ok(h.calls[i].messages[1].content.includes(segments[i].text));
  assert.match(h.calls.at(-1).messages[1].content, /提炼-5/);
  assert.match(h.calls.at(-1).messages[1].content, /提炼-8/);
});

test("failed chunks never persist a partial summary over the previous result", async () => {
  const saved = { learningId: "BV1xx411c7mD:p1", summary: SUMMARY };
  const h = fixture({ saved, segments: [{ start: 0, text: "a".repeat(5000) }, { start: 10, text: "b".repeat(5000) }],
    reply: (_, count) => { if (count === 2) throw new Error("provider failed"); return SUMMARY; } });
  assert.equal((await h.service.summarize("BV1xx411c7mD", { forceRefresh: true })).success, false);
  assert.equal(h.records.get(saved.learningId), saved);
  assert.equal(h.cache.size, 0);
});

test("cancel prevents further chunk requests and persistence", async () => {
  const controller = new AbortController();
  const h = fixture({ segments: [{ start: 0, text: "a".repeat(5000) }, { start: 10, text: "b".repeat(5000) }],
    reply: (request) => { assert.equal(request.signal, controller.signal); controller.abort(); return SUMMARY; } });
  const result = await h.service.summarize("BV1xx411c7mD", { signal: controller.signal });
  assert.equal(result.error, "TASK_CANCELED");
  assert.equal(h.calls.length, 1);
  assert.equal(h.records.size, 0);
  assert.equal(h.cache.size, 0);
});

test("persistent summaries survive absent transcript caches; refresh explicitly regenerates", async () => {
  const saved = { learningId: "BV1xx411c7mD:p1", summary: SUMMARY };
  const h = fixture({ saved });
  assert.equal((await h.service.summarize("BV1xx411c7mD")).fromCache, true);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.service.summarize("BV1xx411c7mD", { forceRefresh: true })).fromCache, false);
  assert.equal(h.calls.length, 1);
});

test("concurrent chapter and summary saves preserve both fields and clear old failures", async () => {
  const h = fixture();
  const analysis = { chapters: [{ title: "章节" }] };
  await Promise.all([
    LEARNING.saveLearningRecord({ bvid: "BV1xx411c7mD", analysis, analysisFailures: [{ index: 1 }] }, { repository: h.repository }),
    LEARNING.saveLearningRecord({ bvid: "BV1xx411c7mD", summary: SUMMARY }, { repository: h.repository }),
  ]);
  let record = h.records.get("BV1xx411c7mD:p1");
  assert.equal(record.analysis, analysis);
  assert.equal(record.summary, SUMMARY);
  assert.equal(record.analysisFailures.length, 1);
  await LEARNING.saveLearningRecord({ bvid: "BV1xx411c7mD", analysis }, { repository: h.repository });
  record = h.records.get("BV1xx411c7mD:p1");
  assert.equal(record.analysisFailures, undefined);
  assert.equal(record.summary, SUMMARY);
});

test("invalid input, no subtitles and malformed model output do not persist results", async () => {
  assert.throws(() => SERVICE.normalize({ core: "incomplete" }), /完整总结/);
  assert.equal((await fixture().service.summarize("bad")).error, "INVALID_VIDEO");
  assert.equal((await fixture({ segments: [] }).service.summarize("BV1xx411c7mD")).error, "NO_TRANSCRIPT");
  const h = fixture({ reply: () => ({ core: "incomplete" }) });
  assert.equal((await h.service.summarize("BV1xx411c7mD")).success, false);
  assert.equal(h.records.size, 0);
});

test("summary-only learning records survive backup export and restore", () => {
  const record = { learningId: "yt:dQw4w9WgXcQ:p1", bvid: "yt:dQw4w9WgXcQ", page: 1, summary: SUMMARY, updatedAt: 1 };
  const backup = LEARNING.buildBackup({ notes: [], learning: [record] });
  const parsed = LEARNING.parseBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(parsed.ok, true);
  const merged = LEARNING.mergeBackup([], [], parsed.backup);
  assert.deepEqual(merged.learning[0].summary, SUMMARY);
});
