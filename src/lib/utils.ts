import { createHash } from "node:crypto";
import type { Brand, EventType } from "../types.js";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function brandLabel(brand: Brand): string {
  switch (brand) {
    case "muji":
      return "無印良品";
    case "rakuten":
      return "楽天";
    case "amazon":
      return "Amazon";
  }
}

export function eventTypeLabel(eventType: EventType): string {
  switch (eventType) {
    case "muji_ryohin_week":
      return "無印良品週間";
    case "rakuten_thanks_day":
      return "楽天 ご愛顧感謝デー";
    case "rakuten_marathon":
      return "楽天 お買い物マラソン";
    case "rakuten_super_sale":
      return "楽天スーパーSALE";
    case "amazon_prime_day":
      return "Amazon Prime Day";
    case "amazon_prime_thanks_festival":
      return "Amazon プライム感謝祭";
    case "amazon_black_friday":
      return "Amazon ブラックフライデー";
  }
}

export function parseJsonArray(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function parseJsonNumberArray(raw: string | null): number[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
