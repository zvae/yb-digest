/** Supadata native-caption adapter, based on the original YouTube Digest pipeline. */
var YB_YOUTUBE = (() => {
  const VIDEO = typeof YB_VIDEO !== "undefined" ? YB_VIDEO : require("./video-platform.js");
  const ENDPOINT = "https://api.supadata.ai/v1/transcript";
  const fail = (code, message) => Object.assign(new Error(message), { code });

  function normalizeTranscript(data) {
    const entries = (Array.isArray(data?.content) ? data.content : []).flatMap((chunk) => {
      const text = typeof chunk?.text === "string" ? chunk.text.replace(/>> ?/g, "").trim() : "";
      const offset = Number(chunk?.offset ?? 0);
      const duration = Number(chunk?.duration ?? 0);
      if (!text || !Number.isFinite(offset) || offset < 0 || !Number.isFinite(duration)) return [];
      return [{ text, start: offset / 1000, duration: Math.max(0, duration / 1000), language: chunk.lang || data.lang || null }];
    }).sort((a, b) => a.start - b.start);
    if (!entries.length) throw fail("EMPTY_TRANSCRIPT", "YouTube 返回了空字幕。");
    const language = typeof data.lang === "string" ? data.lang : entries[0].language || "und";
    const languages = [...new Set([language, ...(Array.isArray(data.availableLangs) ? data.availableLangs : [])])]
      .filter((lang) => typeof lang === "string" && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/.test(lang));
    return {
      entries, language, languageLabel: language, isAiSubtitle: false,
      availableTracks: languages.map((lang) => ({ lang, langLabel: lang, isAi: false })),
    };
  }

  function createClient({ fetch: fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxAttempts = 60, requestTimeoutMs = 15000 } = {}) {
    async function request(url, key, deadline) {
      const controller = new AbortController();
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw fail("TRANSCRIPT_TIMEOUT", "YouTube 字幕处理超时，请重试。");
      const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remaining));
      try {
        const response = await fetchImpl(url, {
          headers: { "x-api-key": key }, credentials: "omit", redirect: "error", signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) throw fail("INVALID_SUPADATA_KEY", "Supadata 密钥无效或无访问权限，请检查设置。");
        if (response.status === 404 || response.status === 206) throw fail("NO_SUBTITLE", "该 YouTube 视频没有可用的原生字幕。");
        if (response.status === 429) throw fail("RATE_LIMITED", "Supadata 请求过于频繁或额度不足，请稍后重试。");
        if (!response.ok) throw fail("YOUTUBE_FETCH_FAILED", `Supadata 请求失败（HTTP ${response.status}）。`);
        return { status: response.status, data: await response.json() };
      } catch (error) {
        if (error.name === "AbortError") throw fail("TRANSCRIPT_TIMEOUT", "YouTube 字幕请求超时，请重试。");
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function fetchTranscript(input, { apiKey, lang = "auto" } = {}) {
      const video = VIDEO.parse(input);
      if (video?.platform !== "youtube") throw fail("INVALID_VIDEO", "没有识别到 YouTube 视频。");
      const key = typeof apiKey === "string" ? apiKey.trim() : "";
      if (!key) throw fail("NO_SUPADATA_KEY", "请在设置中填写并保存 YouTube 字幕的 Supadata API Key。");
      const url = new URL(ENDPOINT);
      url.searchParams.set("url", VIDEO.canonicalVideoUrl(video.key));
      url.searchParams.set("text", "false");
      url.searchParams.set("mode", "native");
      if (lang && lang !== "auto") url.searchParams.set("lang", lang);
      const deadline = Date.now() + 90000;
      let { status, data } = await request(url.toString(), key, deadline);
      if (status === 202) {
        if (typeof data?.jobId !== "string" || !data.jobId) throw fail("INVALID_JOB", "Supadata 未返回有效的字幕任务编号。");
        const jobUrl = `${ENDPOINT}/${encodeURIComponent(data.jobId)}`;
        let complete = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await sleep(1000);
          ({ data } = await request(jobUrl, key, deadline));
          if (data?.status === "completed") { complete = true; break; }
          if (data?.status === "failed") throw fail("TRANSCRIPT_JOB_FAILED", "YouTube 字幕任务失败，请重试。");
        }
        if (!complete) throw fail("TRANSCRIPT_TIMEOUT", "YouTube 字幕处理超时，请重试。");
      }
      return normalizeTranscript(data);
    }
    return { fetchTranscript };
  }

  return { createClient, normalizeTranscript };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YB_YOUTUBE;
