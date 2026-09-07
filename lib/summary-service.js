/** Full-video synthesis, with bounded hierarchical reduction for long transcripts. */
var BILI_SUMMARY_SERVICE = (() => {
  const VIDEO = typeof YB_VIDEO !== "undefined" ? YB_VIDEO : require("./video-platform.js");
  const AI = typeof BILI_AI !== "undefined" ? BILI_AI : require("./ai.js");
  const SETTINGS = typeof BILI_SETTINGS !== "undefined" ? BILI_SETTINGS : require("../settings.js");
  const CONCURRENCY = typeof BILI_CONCURRENCY !== "undefined" ? BILI_CONCURRENCY : require("./concurrency.js");
  const LEARNING = typeof BILI_LEARNING_STORE !== "undefined" ? BILI_LEARNING_STORE : require("./learning-store.js");

  function normalize(value) {
    const clean = (text, max) => typeof text === "string" ? text.trim().slice(0, max) : "";
    const list = (items) => (Array.isArray(items) ? items : []).map((item) => clean(item, 500)).filter(Boolean).slice(0, 6);
    const summary = { core: clean(value?.core, 600), content: list(value?.content), viewpoints: list(value?.viewpoints), conclusion: clean(value?.conclusion, 600) };
    if (!summary.core || !summary.content.length || !summary.viewpoints.length) throw new Error("模型未返回完整总结，请重试。");
    return summary;
  }
  const check = (signal) => {
    if (signal?.aborted) throw Object.assign(new Error("已取消"), { code: "TASK_CANCELED" });
  };
  function create({ cache, ensureTranscript, updateCache, dataReady, learningRepository, getSettings,
    loadPromptSection, requestAiCompletion, aiErrorResponse, onTaskProgress = () => {} }) {
    async function summarize(bvidInput, { page = 1, forceRefresh = false, signal, taskId } = {}) {
      const video = VIDEO.parse(bvidInput);
      if (!video) return { success: false, error: "INVALID_VIDEO", message: "没有识别到视频。" };
      const bvid = video.key;
      const part = video.platform === "youtube" ? 1 : Math.max(1, Math.floor(Number(page) || 1));
      try {
        check(signal);
        await dataReady();
        const cached = await cache.load(bvid, { page: part });
        const record = await LEARNING.loadLearningRecord(bvid, part, { repository: learningRepository() });
        if (!forceRefresh && (cached?.summary || record?.summary)) {
          return { success: true, summary: cached?.summary || record.summary, fromCache: true };
        }
        const transcript = await ensureTranscript(bvid, part);
        if (!transcript.success) return transcript;
        const settings = await getSettings();
        const chunks = AI.planAnalysisChunks(transcript.segments, SETTINGS.analysisChunkOptions(settings));
        if (!chunks.length) return { success: false, error: "NO_TRANSCRIPT", message: "没有可用字幕。" };
        let completed = 0;
        const request = async (material, stage) => {
          check(signal);
          const vars = { videoTitle: transcript.videoInfo?.title || "未知", stage, material };
          const [system, user] = await Promise.all([
            loadPromptSection("summary.md", "系统提示词", vars),
            loadPromptSection("summary.md", "用户提示词", vars),
          ]);
          const { text } = await requestAiCompletion({ signal, maxTokens: 2400, temperature: 0.2,
            responseFormat: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
          check(signal);
          const result = normalize(AI.parseLooseJson(text));
          onTaskProgress(taskId, { done: ++completed, message: `已完成 ${completed} 次提炼` });
          return result;
        };
        let parts = await CONCURRENCY.mapWithConcurrency(chunks, settings.aiConcurrency, (chunk) =>
          request(chunk.text, chunks.length === 1 ? "整段视频总结" : "局部字幕提炼，保留本段独有的论点与重要内容"));
        check(signal);
        const failure = parts.find((part) => part.status === "rejected");
        if (failure) throw failure.reason;
        parts = parts.map((part) => part.value);
        // At most two bounded summaries per merge; no late-video material is truncated.
        while (parts.length > 1) {
          const next = [];
          for (let i = 0; i < parts.length; i += 2) {
            check(signal);
            next.push(i + 1 < parts.length
              ? await request(JSON.stringify(parts.slice(i, i + 2)), "综合这些按时间排序的提炼，形成覆盖全部材料的总结，不要逐段拼接")
              : parts[i]);
          }
          parts = next;
        }
        const summary = parts[0];
        check(signal);
        await LEARNING.saveLearningRecord({ bvid, page: part, summary,
          videoTitle: transcript.videoInfo?.title, ownerName: transcript.videoInfo?.owner }, { repository: learningRepository() });
        await updateCache(bvid, part, (current) => ({ ...current, summary }));
        return { success: true, summary, fromCache: false };
      } catch (error) { return aiErrorResponse(error); }
    }
    return { summarize };
  }
  return { create, normalize };
})();
if (typeof module !== "undefined" && module.exports) module.exports = BILI_SUMMARY_SERVICE;
