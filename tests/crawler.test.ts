import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { runCrawlCycle } from "../src/services/crawler.js";
import { createTestContext, type TestContext } from "./helpers.js";

const contexts: TestContext[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  while (contexts.length) {
    await contexts.pop()!.cleanup();
  }
});

describe("runCrawlCycle", () => {
  it("auto-publishes rule/static monitors and leaves manual-review monitors pending", async () => {
    const context = await createTestContext();
    contexts.push(context);

    const pages = new Map<string, string>([
      ["https://www.muji.com/jp/ja/special-feature/ryohinweek/", "<html><body>無印良品週間 2026年3月20日（金）〜2026年3月30日（月）</body></html>"],
      ["https://event.rakuten.co.jp/campaign/point-up/marathon/", "<html><body>お買い物マラソン 2026年4月4日(土)20:00〜2026年4月10日(金)01:59</body></html>"],
      ["https://event.rakuten.co.jp/campaign/supersale/", "<html><body>楽天スーパーSALE 2026年6月4日(木)20:00〜2026年6月11日(木)01:59</body></html>"],
      ["https://www.amazon.co.jp/primeday", "<html><body>Prime Day 2026年7月11日(土)00:00〜2026年7月14日(火)23:59</body></html>"],
      ["https://www.amazon.co.jp/events/primethanks", "<html><body>プライム感謝祭 2026年10月17日(土)00:00〜2026年10月18日(日)23:59</body></html>"],
      ["https://www.amazon.co.jp/blackfriday", "<html><body>ブラックフライデー 2026年11月27日(金)00:00〜2026年12月3日(木)23:59</body></html>"],
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nAllow: /\n", { status: 200 });
        }
        const etag = pages.has(url) ? `"${url}-etag"` : null;
        if (init?.headers instanceof Headers && init.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { ETag: etag ?? "" } });
        }
        const html = pages.get(url);
        if (!html) {
          return new Response("not found", { status: 404 });
        }
        return new Response(html, {
          status: 200,
          headers: { ETag: etag ?? "", "Last-Modified": "Wed, 25 Mar 2026 00:00:00 GMT" },
        });
      }),
    );

    const summary = await runCrawlCycle(
      context.repository,
      context.storage,
      DateTime.fromISO("2026-03-25T12:00:00.000+09:00", { zone: "Asia/Tokyo" }),
    );

    expect(summary.monitorsProcessed).toBe(7);
    expect(summary.observationsCreated).toBe(6);
    expect(summary.candidatesCreated).toBeGreaterThanOrEqual(18);
    expect(summary.publishedCount).toBeGreaterThanOrEqual(14);
    expect(summary.failedMonitors).toEqual([]);

    const published = await context.repository.listPublishedEvents();
    expect(published.some((event) => event.eventType === "rakuten_thanks_day")).toBe(true);
    expect(published.some((event) => event.eventType === "muji_ryohin_week")).toBe(true);
    expect(published.some((event) => event.eventType === "rakuten_marathon")).toBe(true);

    const pending = await context.repository.listPendingCandidates();
    expect(pending.some((candidate) => candidate.eventType === "rakuten_super_sale")).toBe(true);
    expect(pending.some((candidate) => candidate.eventType === "amazon_prime_day")).toBe(true);
    expect(pending.some((candidate) => candidate.eventType === "amazon_prime_thanks_festival")).toBe(true);
    expect(pending.some((candidate) => candidate.eventType === "amazon_black_friday")).toBe(true);
  });
});
