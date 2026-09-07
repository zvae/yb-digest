/** Shared identity boundary. The legacy `bvid` field stores BV ids or yt:<id>. */
var YB_VIDEO = (() => {
  const BVID = /^BV[0-9A-Za-z]{10}$/;
  const YTID = /^[0-9A-Za-z_-]{11}$/;

  function parseUrl(input) {
    try {
      const url = new URL(String(input || ""));
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      if (url.hostname === "www.bilibili.com") {
        if (!/^\/(video|list)\//.test(url.pathname)) return null;
        const id = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1]
          || url.searchParams.get("bvid");
        if (!BVID.test(id || "")) return null;
        const rawPage = Number(url.searchParams.get("p"));
        const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
        return { platform: "bilibili", videoId: id, key: id, page };
      }
      if (["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) {
        const id = url.hostname === "youtu.be" ? url.pathname.slice(1).split("/")[0]
          : url.pathname === "/watch" ? url.searchParams.get("v")
          : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1];
        if (!YTID.test(id || "")) return null;
        return { platform: "youtube", videoId: id, key: `yt:${id}`, page: 1 };
      }
    } catch (_) { /* Invalid URLs are not video identities. */ }
    return null;
  }

  function parse(input) {
    const text = String(input || "").trim();
    if (BVID.test(text)) return { platform: "bilibili", videoId: text, key: text, page: 1 };
    if (text.startsWith("yt:") && YTID.test(text.slice(3))) {
      return { platform: "youtube", videoId: text.slice(3), key: text, page: 1 };
    }
    return parseUrl(text);
  }

  const parseId = (input) => parse(input)?.key || null;

  function canonicalVideoUrl(input, seconds = 0, page) {
    const video = parse(input);
    if (!video) throw new Error("Invalid video id");
    const url = new URL(video.platform === "youtube"
      ? `https://www.youtube.com/watch?v=${video.videoId}`
      : `https://www.bilibili.com/video/${video.videoId}`);
    const part = Math.floor(Number(page ?? video.page));
    if (video.platform === "bilibili" && Number.isFinite(part) && part > 1) url.searchParams.set("p", String(part));
    const start = Math.floor(Number(seconds));
    if (Number.isFinite(start) && start > 0) url.searchParams.set("t", String(start));
    return url.toString();
  }

  return { parseUrl, parse, parseId, canonicalVideoUrl };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YB_VIDEO;
