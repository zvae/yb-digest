const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient, normalizeTranscript } = require("../lib/youtube-api.js");
const KEY = "yt:dQw4w9WgXcQ";
const fixture = { lang: "en", availableLangs: ["en", "zh", "en"], content: [
  { text: ">> Hello world.", offset: 1250, duration: 1750 },
  { text: ">>", offset: 3000, duration: 1000 },
] };
const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });

test("Native captions use a canonical URL, separate key, no cookies and millisecond precision", async () => {
  const calls = [];
  const client = createClient({ fetch: async (...args) => { calls.push(args); return response(200, fixture); } });
  const result = await client.fetchTranscript("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=private&t=65", { apiKey: " secret ", lang: "ja" });
  const [rawUrl, init] = calls[0];
  const url = new URL(rawUrl);
  assert.equal(url.origin, "https://api.supadata.ai");
  assert.equal(url.searchParams.get("url"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(url.searchParams.get("mode"), "native");
  assert.equal(url.searchParams.get("text"), "false");
  assert.equal(url.searchParams.get("lang"), "ja");
  assert.equal(init.headers["x-api-key"], "secret");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "error");
  assert.deepEqual(result.entries, [{ text: "Hello world.", start: 1.25, duration: 1.75, language: "en" }]);
  assert.deepEqual(result.availableTracks.map((t) => t.lang), ["en", "zh"]);
});

test("Auto omits lang and async jobs use the same normalization", async () => {
  const calls = [];
  const replies = [response(202, { jobId: "a/b" }), response(200, { status: "active" }), response(200, { ...fixture, status: "completed" })];
  const client = createClient({ fetch: async (url) => { calls.push(url); return replies.shift(); }, sleep: async () => {} });
  const result = await client.fetchTranscript(KEY, { apiKey: "key" });
  assert.equal(new URL(calls[0]).searchParams.has("lang"), false);
  assert.equal(calls[1], "https://api.supadata.ai/v1/transcript/a%2Fb");
  assert.deepEqual(result, normalizeTranscript(fixture));
});

for (const [status, code] of [[401, "INVALID_SUPADATA_KEY"], [403, "INVALID_SUPADATA_KEY"], [404, "NO_SUBTITLE"], [206, "NO_SUBTITLE"], [429, "RATE_LIMITED"], [500, "YOUTUBE_FETCH_FAILED"]]) {
  test(`HTTP ${status} returns actionable ${code}`, async () => {
    const client = createClient({ fetch: async () => response(status, {}) });
    await assert.rejects(client.fetchTranscript(KEY, { apiKey: "key" }), { code });
  });
}

test("Missing key or invalid video never reaches the network", async () => {
  const client = createClient({ fetch: async () => assert.fail("Unexpected network request") });
  await assert.rejects(client.fetchTranscript(KEY), { code: "NO_SUPADATA_KEY" });
  await assert.rejects(client.fetchTranscript("BV1xx411c7mD", { apiKey: "key" }), { code: "INVALID_VIDEO" });
});

test("Malformed, empty, failed and stalled jobs do not become successful transcripts", async () => {
  for (const [job, code] of [[{}, "INVALID_JOB"], [{ jobId: "job", status: "failed" }, "TRANSCRIPT_JOB_FAILED"], [{ jobId: "job", status: "active" }, "TRANSCRIPT_TIMEOUT"], [{ jobId: "job", status: "completed", content: [] }, "EMPTY_TRANSCRIPT"]]) {
    let calls = 0;
    const client = createClient({ fetch: async () => response(++calls === 1 ? 202 : 200, job), sleep: async () => {}, maxAttempts: 2 });
    await assert.rejects(client.fetchTranscript(KEY, { apiKey: "key" }), { code });
    assert.ok(calls <= 3);
  }
  assert.throws(() => normalizeTranscript({ content: [{ text: "x", offset: "bad" }, null] }), { code: "EMPTY_TRANSCRIPT" });
});

test("Hanging network requests are aborted", async () => {
  const client = createClient({ requestTimeoutMs: 5, fetch: (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  }) });
  await assert.rejects(client.fetchTranscript(KEY, { apiKey: "key" }), { code: "TRANSCRIPT_TIMEOUT" });
});
