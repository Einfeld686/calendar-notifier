import { DateTime } from "luxon";
import type { SourceMonitor } from "../types.js";

const STATIC_HOURS = new Set([6, 12, 18, 23]);
const RULE_HOURS = new Set([3]);

export type CrawlBucket = "due" | "rule" | "content" | "all";

export function parseCrawlBucket(value: string | undefined): CrawlBucket {
  const normalized = value?.trim().toLowerCase() ?? "due";
  if (normalized === "due" || normalized === "rule" || normalized === "content" || normalized === "all") {
    return normalized;
  }
  throw new Error(`Unsupported CRAWL_BUCKET: ${value}`);
}

export function getDueMonitorSlugs(monitors: SourceMonitor[], now: DateTime): string[] {
  return getMonitorSlugsForBucket(monitors, now, "due");
}

export function getMonitorSlugsForBucket(
  monitors: SourceMonitor[],
  now: DateTime,
  bucket: CrawlBucket,
): string[] {
  return monitors
    .filter((monitor) => {
      if (bucket === "all") {
        return true;
      }
      if (bucket === "rule") {
        return monitor.strategy === "rule";
      }
      if (bucket === "content") {
        return monitor.strategy !== "rule";
      }
      const dueHours = monitor.strategy === "rule" ? RULE_HOURS : STATIC_HOURS;
      return dueHours.has(now.hour);
    })
    .map((monitor) => monitor.slug);
}
