import { describe, expect, it } from "vitest";
import { generateIcs } from "../src/services/ics.js";
import type { PublishedEvent } from "../src/types.js";

describe("generateIcs", () => {
  it("emits required calendar fields and escaped folded content with CRLF", () => {
    const event: PublishedEvent = {
      id: 1,
      eventSlug: "rakuten-super-sale-2026-06-04",
      canonicalEventKey: "rakuten:rakuten_super_sale:event-rakuten:2026-06-04",
      icsUid: "event-1@calendar-notifier.local",
      title: "楽天スーパーSALE, 先行告知; テスト",
      brand: "rakuten",
      eventType: "rakuten_super_sale",
      startsAtJst: "2026-06-04T20:00:00.000+09:00",
      endsAtJst: "2026-06-11T01:59:00.000+09:00",
      allDay: false,
      summary:
        "長い説明文, セミコロン; バックスラッシュ\\\\ と改行\nを含む根拠要約です。長い説明文, セミコロン; バックスラッシュ\\\\ と改行\nを含む根拠要約です。",
      sourceUrl: "https://example.com/source",
      verifiedAt: "2026-03-25T10:00:00.000+09:00",
      publishedAt: "2026-03-25T10:00:00.000+09:00",
      endedAt: null,
      sequence: 2,
      icalStatus: "CONFIRMED",
      lastModifiedUtc: "20260325T010000Z",
      currentVersion: 3,
      status: "published",
    };

    const ics = generateIcs("all", [event], "https://calendar.example.com");

    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("PRODID:-//calendar-notifier//JP Sales Calendar//JA\r\n");
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT12H\r\n");
    expect(ics).not.toMatch(/(?<!\r)\n/);
    expect(ics).toContain("SUMMARY:楽天スーパーSALE\\, 先行告知\\; テスト\r\n");
    expect(ics).toContain("DESCRIPTION:");
    expect(ics).toContain("SEQUENCE:2\r\n");
    expect(ics).toContain("STATUS:CONFIRMED\r\n");
    expect(ics).toContain("DTSTART:20260604T110000Z\r\n");
    expect(ics).toContain("DTEND:20260610T165900Z\r\n");

    const foldedLines = ics.split("\r\n").filter((line) => line.startsWith(" "));
    expect(foldedLines.length).toBeGreaterThan(0);
  });

  it("serializes all-day events with exclusive DTEND and cancellation status", () => {
    const event: PublishedEvent = {
      id: 2,
      eventSlug: "muji-ryohin-week-2026-03-20",
      canonicalEventKey: "muji:muji_ryohin_week:ryohinweek:2026-03-20",
      icsUid: "event-2@calendar-notifier.local",
      title: "無印良品週間",
      brand: "muji",
      eventType: "muji_ryohin_week",
      startsAtJst: "2026-03-20T00:00:00.000+09:00",
      endsAtJst: "2026-03-31T00:00:00.000+09:00",
      allDay: true,
      summary: "無印良品週間の開催期間を公式ページで確認しました。",
      sourceUrl: "https://www.muji.com/jp/ja/special-feature/ryohinweek/",
      verifiedAt: "2026-03-01T10:00:00.000+09:00",
      publishedAt: "2026-03-01T10:00:00.000+09:00",
      endedAt: null,
      sequence: 1,
      icalStatus: "CANCELLED",
      lastModifiedUtc: "20260301T010000Z",
      currentVersion: 2,
      status: "published",
    };

    const ics = generateIcs("muji", [event], "https://calendar.example.com");

    expect(ics).toContain("DTSTART;VALUE=DATE:20260320\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20260331\r\n");
    expect(ics).toContain("STATUS:CANCELLED\r\n");
  });
});
