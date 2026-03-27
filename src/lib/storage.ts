import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { S3Config } from "../config.js";
import { sha256 } from "./utils.js";

export interface ObjectStorage {
  assertAccess(): Promise<void>;
  saveHtml(sourceUrl: string, html: string): Promise<string>;
  readText(key: string): Promise<string | null>;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly rootDir: string) {
    mkdirSync(resolve(rootDir, "html"), { recursive: true });
    mkdirSync(resolve(rootDir, "screenshots"), { recursive: true });
  }

  async assertAccess(): Promise<void> {
    return Promise.resolve();
  }

  async saveHtml(sourceUrl: string, html: string): Promise<string> {
    const key = `html/${sha256(sourceUrl + html)}.html`;
    const absolutePath = resolve(this.rootDir, key);
    writeFileSync(absolutePath, html, "utf8");
    return key;
  }

  async readText(key: string): Promise<string | null> {
    try {
      return readFileSync(resolve(this.rootDir, key), "utf8");
    } catch {
      return null;
    }
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(
    private readonly config: S3Config,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  async assertAccess(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
  }

  async saveHtml(sourceUrl: string, html: string): Promise<string> {
    const key = `html/${sha256(sourceUrl + html)}.html`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: html,
        ContentType: "text/html; charset=utf-8",
      }),
    );
    return key;
  }

  async readText(key: string): Promise<string | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return response.Body ? await streamToString(response.Body as AsyncIterable<Uint8Array>) : null;
    } catch {
      return null;
    }
  }
}

export async function streamToString(body: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
