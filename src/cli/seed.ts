import { createRuntime } from "../lib/runtime.js";

async function main() {
  const runtime = await createRuntime();
  try {
    const monitors = await runtime.repository.listMonitors();
    const target = runtime.config.dbBackend === "postgres" ? runtime.config.databaseUrl : runtime.config.dbPath;
    console.log(`Seeded ${monitors.length} monitors into ${target}`);
  } finally {
    await runtime.close();
  }
}

void main();
