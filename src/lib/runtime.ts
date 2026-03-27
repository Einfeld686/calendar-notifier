import type { AppConfig } from "../config.js";
import { loadConfig } from "../config.js";
import type { CalendarRepository } from "./repository.js";
import { LocalObjectStorage, type ObjectStorage, S3ObjectStorage } from "./storage.js";
import { PostgresCalendarRepository } from "./postgres-repository.js";
import { SqliteCalendarRepository } from "./sqlite-repository.js";

export interface AppRuntime {
  config: AppConfig;
  repository: CalendarRepository;
  storage: ObjectStorage;
  close(): Promise<void>;
}

export interface RuntimeOptions {
  verifyStorageAccess?: boolean;
}

export async function createRuntime(config = loadConfig(), options: RuntimeOptions = {}): Promise<AppRuntime> {
  const repository =
    config.dbBackend === "postgres"
      ? new PostgresCalendarRepository(config.databaseUrl ?? missing("DATABASE_URL"))
      : new SqliteCalendarRepository(config.dbPath);

  await repository.initialize();

  const storage =
    config.storageBackend === "s3"
      ? new S3ObjectStorage(config.s3 ?? missing("S3 configuration"))
      : new LocalObjectStorage(config.storageDir);

  if (options.verifyStorageAccess) {
    await storage.assertAccess();
  }

  return {
    config,
    repository,
    storage,
    close: async () => {
      await repository.close();
    },
  };
}

function missing(name: string): never {
  throw new Error(`${name} is required`);
}
