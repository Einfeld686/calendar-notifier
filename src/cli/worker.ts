import { setTimeout as sleep } from "node:timers/promises";
import { DateTime } from "luxon";
import { createRuntime } from "../lib/runtime.js";
import { getDueMonitorSlugs } from "../lib/schedule.js";
import { runCrawlCycle } from "../services/crawler.js";

async function main() {
  const runtime = await createRuntime(undefined, { verifyStorageAccess: true });
  const processedBuckets = new Set<string>();

  try {
    while (true) {
      const now = DateTime.now().setZone("Asia/Tokyo");
      const dueMonitorSlugs = getDueMonitorSlugs(await runtime.repository.listMonitors(), now).filter(
        (slug) => !processedBuckets.has(`${slug}:${now.toFormat("yyyy-LL-dd-HH")}`),
      );
      for (const slug of dueMonitorSlugs) {
        const bucket = `${slug}:${now.toFormat("yyyy-LL-dd-HH")}`;
        processedBuckets.add(bucket);
      }

      if (dueMonitorSlugs.length > 0) {
        const summary = await runCrawlCycle(runtime.repository, runtime.storage, now, {
          monitorSlugs: dueMonitorSlugs,
        });
        console.log(`${new Date().toISOString()} crawl summary ${JSON.stringify(summary)}`);
      }
      await sleep(runtime.config.workerPollMinutes * 60 * 1000);
    }
  } finally {
    await runtime.close();
  }
}

void main();
