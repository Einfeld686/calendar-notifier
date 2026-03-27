import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { CalendarRepository } from "../src/lib/repository.js";
import { SqliteCalendarRepository } from "../src/lib/sqlite-repository.js";
import { LocalObjectStorage } from "../src/lib/storage.js";
import type { EventCandidate } from "../src/types.js";

export interface TestContext {
  tmpRoot: string;
  config: AppConfig;
  repository: CalendarRepository;
  storage: LocalObjectStorage;
  app: Express;
  cleanup: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const tmpRoot = mkdtempSync(join(tmpdir(), "calendar-notifier-"));
  const config: AppConfig = {
    baseUrl: "http://localhost:3000",
    port: 3000,
    dbBackend: "sqlite",
    dbPath: ":memory:",
    databaseUrl: null,
    storageBackend: "local",
    storageDir: join(tmpRoot, "storage"),
    s3: null,
    adminUser: "admin",
    adminPassword: "secret",
    reviewerLabel: "tester",
    workerPollMinutes: 15,
    fetchTimeoutMs: 1000,
  };
  const repository = new SqliteCalendarRepository(config.dbPath);
  await repository.initialize();
  await repository.setAllMonitorCrawlDelays(0);
  const storage = new LocalObjectStorage(config.storageDir);
  const app = createApp(config, repository, storage);

  return {
    tmpRoot,
    config,
    repository,
    storage,
    app,
    cleanup: async () => {
      await repository.close();
      rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

export async function insertPublishedCandidate(
  repository: CalendarRepository,
  overrides: Partial<Pick<EventCandidate, "brand" | "eventType" | "title" | "startsAtJst" | "endsAtJst" | "allDay" | "sourceUrl" | "publicEvidenceSummary">> = {},
) {
  const start = overrides.startsAtJst ?? "2026-04-01T00:00:00.000+09:00";
  const end = overrides.endsAtJst ?? "2026-04-02T00:00:00.000+09:00";
  const candidate = await repository.insertCandidate({
    candidateSlug: `candidate-${Math.random().toString(16).slice(2)}`,
    title: overrides.title ?? "公開イベント",
    brand: overrides.brand ?? "rakuten",
    eventType: overrides.eventType ?? "rakuten_thanks_day",
    startsAtJst: start,
    endsAtJst: end,
    allDay: overrides.allDay ?? true,
    status: "confirmed",
    publicEvidenceSummary: overrides.publicEvidenceSummary ?? "公開条件を満たしています。",
    sourceUrl: overrides.sourceUrl ?? "https://example.com/source",
    validationFlags: ["ok:test"],
    rulePassed: true,
    needsReview: false,
    llmOutputJson: JSON.stringify({ formatter: "test" }),
    parserVersion: "test",
    proposedVersion: 1,
  });
  return repository.publishCandidate(candidate.id, "tester", "approve");
}
