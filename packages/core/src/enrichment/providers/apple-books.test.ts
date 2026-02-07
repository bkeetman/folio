import assert from "node:assert/strict";
import test from "node:test";
import { AppleBooksProvider } from "./apple-books";

test("normalizes Apple Books result and upgrades cover image URL", async () => {
  const provider = new AppleBooksProvider({
    fetcher: async () =>
      new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: "ebook",
              trackId: 123,
              trackName: "The Pragmatic Programmer",
              artistName: "David Thomas",
              releaseDate: "2019-09-13T07:00:00Z",
              description: "A practical software engineering classic.",
              artworkUrl100:
                "https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/a/b/c/cover.jpg/100x100bb.jpg",
              trackViewUrl: "https://books.apple.com/us/book/id123",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    minIntervalMs: 0,
  });

  const results = await provider.search({
    title: "Pragmatic Programmer",
    author: "David Thomas",
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.title, "The Pragmatic Programmer");
  assert.equal(results[0]?.publishedYear, 2019);
  assert.equal(
    results[0]?.coverUrl,
    "https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/a/b/c/cover.jpg/1200x1200bb.jpg"
  );
  assert.equal(results[0]?.source, "applebooks");
});

test("returns empty array on no Apple Books results", async () => {
  const provider = new AppleBooksProvider({
    fetcher: async () =>
      new Response(
        JSON.stringify({
          resultCount: 0,
          results: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
    minIntervalMs: 0,
  });

  const results = await provider.search({ title: "book that does not exist" });
  assert.deepEqual(results, []);
});

test("retries on 429 and succeeds on next response", async () => {
  let calls = 0;
  const provider = new AppleBooksProvider({
    fetcher: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("{}", {
          status: 429,
          headers: {
            "retry-after": "0",
          },
        });
      }

      return new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              kind: "ebook",
              trackName: "Clean Code",
              artistName: "Robert C. Martin",
              artworkUrl100: "https://example.com/100x100bb.jpg",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
    maxRetries: 2,
    minIntervalMs: 0,
  });

  const results = await provider.search({ title: "Clean Code" });
  assert.equal(calls, 2);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.title, "Clean Code");
});
