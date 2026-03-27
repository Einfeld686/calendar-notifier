import { createRuntime } from "../lib/runtime.js";
import { runCrawlCycle } from "../services/crawler.js";

async function main() {
  const runtime = await createRuntime(undefined, { verifyStorageAccess: true });

  try {
    const summary = await runCrawlCycle(runtime.repository, runtime.storage);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await runtime.close();
  }
}

void main();
