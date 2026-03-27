import { createApp } from "./app.js";
import { createRuntime } from "./lib/runtime.js";

async function main() {
  const runtime = await createRuntime(undefined, { verifyStorageAccess: true });
  const app = createApp(runtime.config, runtime.repository, runtime.storage);

  const server = app.listen(runtime.config.port, () => {
    console.log(`Calendar Notifier listening on ${runtime.config.baseUrl}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await runtime.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main();
