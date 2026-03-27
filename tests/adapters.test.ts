import { describe, expect, it, vi } from "vitest";
import { newDb } from "pg-mem";
import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { PostgresCalendarRepository } from "../src/lib/postgres-repository.js";
import { S3ObjectStorage } from "../src/lib/storage.js";

describe("production adapters", () => {
  it("runs postgres migrations and monitor seed idempotently", async () => {
    const db = newDb({ noAstCoverageCheck: true });
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const repository = new PostgresCalendarRepository("postgres://unused", pool as never);

    await repository.initialize();
    await repository.initialize();

    const monitors = await repository.listMonitors();
    expect(monitors).toHaveLength(7);
    expect(monitors.map((monitor) => monitor.slug)).toContain("rakuten-thanks-day");

    await repository.close();
  });

  it("stores HTML into S3-compatible storage and returns an opaque key", async () => {
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof HeadBucketCommand) {
        return {};
      }
      if (command instanceof PutObjectCommand) {
        return { ETag: "etag" };
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: (async function* () {
            yield Buffer.from("<html>saved</html>", "utf8");
          })(),
        };
      }
      throw new Error("unexpected command");
    });

    const storage = new S3ObjectStorage(
      {
        endpoint: "https://example.invalid",
        region: "auto",
        bucket: "calendar-notifier",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
      { send } as unknown as S3Client,
    );

    await storage.assertAccess();
    const key = await storage.saveHtml("https://example.com/page", "<html>saved</html>");
    const text = await storage.readText(key);

    expect(key).toMatch(/^html\/[a-f0-9]+\.html$/);
    expect(text).toBe("<html>saved</html>");
    expect(send).toHaveBeenCalledTimes(3);
  });
});
