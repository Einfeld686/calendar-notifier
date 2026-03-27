import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { getMonitorSlugsForBucket, parseCrawlBucket } from "../src/lib/schedule.js";
import type { SourceMonitor } from "../src/types.js";

const monitors: SourceMonitor[] = [
  {
    id: 1,
    slug: "rakuten-thanks-day",
    brand: "rakuten",
    eventType: "rakuten_thanks_day",
    strategy: "rule",
    seedUrls: [],
    allowedDomains: [],
    requiresManualReview: false,
    liteDefault: false,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    id: 2,
    slug: "muji-ryohin-week",
    brand: "muji",
    eventType: "muji_ryohin_week",
    strategy: "static_page",
    seedUrls: [],
    allowedDomains: [],
    requiresManualReview: false,
    liteDefault: true,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
];

describe("schedule helpers", () => {
  it("filters monitors by explicit crawl bucket", () => {
    const now = DateTime.fromISO("2026-03-26T08:00:00+09:00", { zone: "Asia/Tokyo" });

    expect(getMonitorSlugsForBucket(monitors, now, "rule")).toEqual(["rakuten-thanks-day"]);
    expect(getMonitorSlugsForBucket(monitors, now, "content")).toEqual(["muji-ryohin-week"]);
    expect(getMonitorSlugsForBucket(monitors, now, "all")).toEqual(["rakuten-thanks-day", "muji-ryohin-week"]);
  });

  it("accepts supported crawl bucket values and rejects invalid ones", () => {
    expect(parseCrawlBucket(undefined)).toBe("due");
    expect(parseCrawlBucket("RULE")).toBe("rule");
    expect(() => parseCrawlBucket("nightly")).toThrow("Unsupported CRAWL_BUCKET");
  });
});
