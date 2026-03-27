import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, insertPublishedCandidate, type TestContext } from "./helpers.js";

const contexts: TestContext[] = [];

afterEach(async () => {
  while (contexts.length) {
    await contexts.pop()!.cleanup();
  }
});

describe("public and admin routes", () => {
  it("keeps pending_review off public pages and exposes it only under admin auth", async () => {
    const context = await createTestContext();
    contexts.push(context);

    await insertPublishedCandidate(context.repository, {
      title: "公開済みイベント",
      publicEvidenceSummary: "公開条件を満たして公開されました。",
    });

    const pending = await context.repository.insertCandidate({
      candidateSlug: "pending-1",
      title: "保留イベント",
      brand: "amazon",
      eventType: "amazon_prime_day",
      startsAtJst: "2026-07-11T00:00:00.000+09:00",
      endsAtJst: "2026-07-15T00:00:00.000+09:00",
      allDay: true,
      status: "pending_review",
      publicEvidenceSummary: "確認待ちです。",
      sourceUrl: "https://www.amazon.co.jp/primeday",
      validationFlags: ["error:manual-review-required"],
      rulePassed: false,
      needsReview: true,
      llmOutputJson: JSON.stringify({ formatter: "test" }),
      parserVersion: "test",
      proposedVersion: 1,
    });

    const home = await request(context.app).get("/");
    expect(home.status).toBe(200);
    expect(home.text).toContain("公開済みイベント");
    expect(home.text).not.toContain("保留イベント");

    const unauthorized = await request(context.app).get("/admin/review");
    expect(unauthorized.status).toBe(401);

    const authorized = await request(context.app)
      .get("/admin/review")
      .auth(context.config.adminUser, context.config.adminPassword);
    expect(authorized.status).toBe(200);
    expect(authorized.text).toContain(String(pending.id));
    expect(authorized.text).toContain("保留イベント");
  });

  it("publishes an approved admin candidate and serves it from the ICS feed", async () => {
    const context = await createTestContext();
    contexts.push(context);

    const candidate = await context.repository.insertCandidate({
      candidateSlug: "manual-approve-1",
      title: "無印良品週間",
      brand: "muji",
      eventType: "muji_ryohin_week",
      startsAtJst: "2026-03-20T00:00:00.000+09:00",
      endsAtJst: "2026-03-31T00:00:00.000+09:00",
      allDay: true,
      status: "pending_review",
      publicEvidenceSummary: "公式ページに開催期間がありました。",
      sourceUrl: "https://www.muji.com/jp/ja/special-feature/ryohinweek/",
      validationFlags: ["ok:allowed-domain", "ok:has-start", "ok:has-end"],
      rulePassed: false,
      needsReview: true,
      llmOutputJson: JSON.stringify({ formatter: "test" }),
      parserVersion: "test",
      proposedVersion: 1,
    });

    const response = await request(context.app)
      .post(`/admin/review/${candidate.id}/action`)
      .auth(context.config.adminUser, context.config.adminPassword)
      .type("form")
      .send({ action: "approve", reason: "manual approval" });
    expect(response.status).toBe(302);

    const feed = await request(context.app).get("/cal/muji.ics");
    expect(feed.status).toBe(200);
    expect(feed.text).toContain("SUMMARY:無印良品週間");
    expect(feed.text).toContain("PRODID:-//calendar-notifier//JP Sales Calendar//JA");
  });

  it("returns healthy status from healthz", async () => {
    const context = await createTestContext();
    contexts.push(context);

    const response = await request(context.app).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
