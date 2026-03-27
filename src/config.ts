import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export type AppDbBackend = "sqlite" | "postgres";
export type AppStorageBackend = "local" | "s3";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface AppConfig {
  baseUrl: string;
  port: number;
  dbBackend: AppDbBackend;
  dbPath: string;
  databaseUrl: string | null;
  storageBackend: AppStorageBackend;
  storageDir: string;
  s3: S3Config | null;
  adminUser: string;
  adminPassword: string;
  reviewerLabel: string;
  workerPollMinutes: number;
  fetchTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  const cwd = process.cwd();
  const dataDir = resolve(cwd, "data");
  const storageDir = resolve(cwd, "storage");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(storageDir, { recursive: true });

  const dbBackend = (process.env.APP_DB_BACKEND ??
    (process.env.DATABASE_URL ? "postgres" : "sqlite")) as AppDbBackend;
  const storageBackend = (process.env.APP_STORAGE_BACKEND ??
    (process.env.S3_BUCKET ? "s3" : "local")) as AppStorageBackend;
  const databaseUrl = process.env.DATABASE_URL ?? null;

  return {
    baseUrl: process.env.BASE_URL ?? "http://localhost:3000",
    port: Number(process.env.PORT ?? "3000"),
    dbBackend,
    dbPath: process.env.DB_PATH ?? resolve(dataDir, "calendar-notifier.sqlite"),
    databaseUrl,
    storageBackend,
    storageDir: process.env.STORAGE_DIR ?? storageDir,
    s3:
      storageBackend === "s3"
        ? {
            endpoint: requireEnv("S3_ENDPOINT"),
            region: requireEnv("S3_REGION"),
            bucket: requireEnv("S3_BUCKET"),
            accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
            secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
          }
        : null,
    adminUser: process.env.ADMIN_USER ?? "admin",
    adminPassword: process.env.ADMIN_PASSWORD ?? "change-me",
    reviewerLabel: process.env.REVIEWER_LABEL ?? "operator",
    workerPollMinutes: Number(process.env.WORKER_POLL_MINUTES ?? "15"),
    fetchTimeoutMs: Number(process.env.FETCH_TIMEOUT_MS ?? "15000"),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}
