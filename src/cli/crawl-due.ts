import { DateTime } from "luxon";
import { createRuntime } from "../lib/runtime.js";
import { getMonitorSlugsForBucket, parseCrawlBucket } from "../lib/schedule.js";
import { runCrawlCycle } from "../services/crawler.js";

async function main() {
  const runtime = await createRuntime(undefined, { verifyStorageAccess: true });
  try {
    const now = DateTime.now().setZone("Asia/Tokyo");
    const bucket = parseCrawlBucket(process.env.CRAWL_BUCKET);
    const monitorSlugs = getMonitorSlugsForBucket(await runtime.repository.listMonitors(), now, bucket);
    const summary = await runCrawlCycle(runtime.repository, runtime.storage, now, { monitorSlugs });
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await runtime.close();
  }
}

void main();
