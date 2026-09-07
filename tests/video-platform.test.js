const test = require("node:test");
const assert = require("node:assert/strict");
const VIDEO = require("../lib/video-platform.js");
const LEARNING = require("../lib/learning-store.js");

test("YouTube watch, Shorts, live and share URLs share a namespaced identity", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=private&t=20&p=7",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=private",
  ]) {
    assert.deepEqual(VIDEO.parseUrl(url), { platform: "youtube", videoId: "dQw4w9WgXcQ", key: "yt:dQw4w9WgXcQ", page: 1 });
    assert.equal(VIDEO.canonicalVideoUrl(url), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  }
});

test("Bilibili video parts and collection pages retain their identities", () => {
  for (const url of ["https://www.bilibili.com/video/BV1xx411c7mD?p=2", "https://www.bilibili.com/list/123?bvid=BV1xx411c7mD&p=2"]) {
    assert.deepEqual(VIDEO.parseUrl(url), { platform: "bilibili", videoId: "BV1xx411c7mD", key: "BV1xx411c7mD", page: 2 });
    assert.equal(VIDEO.canonicalVideoUrl(url, 9), "https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=9");
  }
});

test("Malformed URLs, lookalike hosts and IDs embedded in arbitrary pages are rejected", () => {
  for (const url of [
    "https://www.bilibili.com.evil.test/video/BV1xx411c7mD",
    "https://evil.test/?next=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.bilibili.com/?bvid=BV1xx411c7mD",
    "https://www.bilibili.com/video/BV1xx411c7mDextra",
    "https://www.youtube.com/results?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=invalid",
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "yt:invalid", "dQw4w9WgXcQ", null,
  ]) assert.equal(VIDEO.parse(url), null, String(url));
});

test("Learning identifiers and exported timestamp links remain platform-specific", () => {
  const youtube = "yt:dQw4w9WgXcQ";
  assert.notEqual(LEARNING.learningId(youtube), LEARNING.learningId("BV1xx411c7mD"));
  assert.equal(VIDEO.canonicalVideoUrl(youtube, 65, 7), "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=65");
  const md = LEARNING.notesAsMarkdown([{
    bvid: youtube, page: 1, videoTitle: "YouTube title", timestamp: "1:05", timestampSeconds: 65,
    timestampedUrl: VIDEO.canonicalVideoUrl(youtube, 65), text: "A note",
  }]);
  assert.match(md, /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=65/);
  assert.doesNotMatch(md, /bilibili\.com/);
});
