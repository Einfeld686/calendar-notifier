import { setTimeout as sleep } from "node:timers/promises";
import robotsParser from "robots-parser";
import type { RobotsParserInstance } from "robots-parser";
import { DateTime } from "luxon";
import { buildCanonicalEventKey, type CalendarRepository, type CrawlSummary } from "../lib/repository.js";
import type { ObjectStorage } from "../lib/storage.js";
import { JST_ZONE } from "../lib/time.js";
import { brandLabel, eventTypeLabel, sha256, slugify } from "../lib/utils.js";
import type { SourceMonitor } from "../types.js";
import { parseHtmlCandidate } from "./parser.js";

const USER_AGENT = "CalendarNotifierBot/0.1 (+https://example.invalid/calendar-notifier)";
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? "15000");

export interface CrawlOptions {
  monitorSlugs?: string[];
}

export async function runCrawlCycle(
  repository: CalendarRepository,
  storage: ObjectStorage,
  now = DateTime.now().setZone(JST_ZONE),
  options: CrawlOptions = {},
): Promise<CrawlSummary> {
  const robotsCache = new Map<string, RobotsParserInstance>();
  const domainThrottle = new Map<string, number>();
  const monitors = (await repository.listMonitors())
    .filter((monitor) => !options.monitorSlugs || options.monitorSlugs.includes(monitor.slug));
  let observationsCreated = 0;
  let candidatesCreated = 0;
  let publishedCount = 0;
  const failedMonitors: CrawlSummary["failedMonitors"] = [];

  for (const monitor of monitors) {
    try {
      if (monitor.strategy === "rule") {
        const count = await generateRuleCandidates(repository, monitor, now);
        candidatesCreated += count.candidates;
        publishedCount += count.published;
        continue;
      }

      const result = await crawlHtmlMonitor(repository, storage, monitor, robotsCache, domainThrottle);
      observationsCreated += result.observations;
      candidatesCreated += result.candidates;
      publishedCount += result.published;
    } catch (error) {
      failedMonitors.push({
        slug: monitor.slug,
        error: error instanceof Error ? error.message : "unexpected monitor failure",
      });
    }
  }

  await repository.syncEndedStatuses();
  return {
    monitorsProcessed: monitors.length,
    observationsCreated,
    candidatesCreated,
    publishedCount,
    failedMonitors,
  };
}

async function generateRuleCandidates(
  repository: CalendarRepository,
  monitor: SourceMonitor,
  now: DateTime,
): Promise<{ candidates: number; published: number }> {
  let candidates = 0;
  let published = 0;
  for (let offset = 0; offset < 12; offset += 1) {
    const targetMonth = now.startOf("month").plus({ months: offset });
    const start = targetMonth.set({ day: 18, hour: 0, minute: 0, second: 0, millisecond: 0 });
    const end = start.plus({ days: 1 });
    const canonicalEventKey = `${monitor.brand}:${monitor.eventType}:${targetMonth.toFormat("yyyy-LL")}`;
    if (await repository.getPublishedEventByCanonicalKey(canonicalEventKey)) {
      continue;
    }

    const candidate = await repository.insertCandidate({
      observationId: null,
      candidateSlug: `${monitor.slug}-${targetMonth.toFormat("yyyy-LL")}`,
      canonicalEventKey,
      title: eventTypeLabel(monitor.eventType),
      brand: monitor.brand,
      eventType: monitor.eventType,
      startsAtJst: start.toISO()!,
      endsAtJst: end.toISO()!,
      allDay: true,
      status: "confirmed",
      publicEvidenceSummary: `${brandLabel(monitor.brand)}の公式定期企画として、${targetMonth.toFormat("yyyy年M月")} のご愛顧感謝デーを自動生成しました。`,
      sourceUrl: monitor.seedUrls[0],
      validationFlags: ["ok:rule-generated", "ok:fixed-day-18"],
      rulePassed: true,
      needsReview: false,
      llmOutputJson: JSON.stringify({
        formatter: "rule-generator-v1",
        title: eventTypeLabel(monitor.eventType),
        start: start.toISO(),
        end: end.toISO(),
      }),
      parserVersion: "rule-generator-v1",
      proposedVersion: 1,
    });
    candidates += 1;
    await repository.publishCandidate(candidate.id, "system:auto", "publish_update");
    published += 1;
  }

  return { candidates, published };
}

async function crawlHtmlMonitor(
  repository: CalendarRepository,
  storage: ObjectStorage,
  monitor: SourceMonitor,
  robotsCache: Map<string, RobotsParserInstance>,
  domainThrottle: Map<string, number>,
): Promise<{ observations: number; candidates: number; published: number }> {
  let observations = 0;
  let candidates = 0;
  let published = 0;

  for (const url of monitor.seedUrls) {
    const robotsCheckedAt = DateTime.now().setZone(JST_ZONE).toISO()!;
    if (monitor.respectRobots) {
      const allowed = await isFetchAllowed(url, robotsCache, domainThrottle, monitor.crawlDelaySeconds);
      if (!allowed) {
        await repository.insertObservation({
          sourceMonitorId: monitor.id,
          fetchedAt: robotsCheckedAt,
          finalUrl: url,
          httpStatus: 0,
          robotsCheckedAt,
          fetchError: "robots-disallow",
          detectedDateStrings: [],
        });
        observations += 1;
        continue;
      }
    }

    const latest = await repository.getLatestObservationForUrl(monitor.id, url);
    await respectCrawlDelay(url, domainThrottle, monitor.crawlDelaySeconds);
    const fetchResult = await fetchWithRetry(url, monitor, latest?.etag ?? null, latest?.lastModifiedHeader ?? null);
    const observationBase = {
      sourceMonitorId: monitor.id,
      fetchedAt: DateTime.now().setZone(JST_ZONE).toISO()!,
      finalUrl: fetchResult.finalUrl || url,
      httpStatus: fetchResult.status,
      etag: fetchResult.etag,
      lastModifiedHeader: fetchResult.lastModifiedHeader,
      robotsCheckedAt,
    };

    if (fetchResult.status === 304) {
      await repository.insertObservation({
        ...observationBase,
        detectedDateStrings: latest?.detectedDateStrings ?? [],
      });
      observations += 1;
      continue;
    }

    if (!fetchResult.ok || !fetchResult.body) {
      await repository.insertObservation({
        ...observationBase,
        fetchError: fetchResult.error ?? `http-${fetchResult.status}`,
        detectedDateStrings: [],
      });
      observations += 1;
      continue;
    }

    const resolvedUrl = fetchResult.finalUrl || url;
    const htmlBlobPath = await storage.saveHtml(resolvedUrl, fetchResult.body);
    const parsed = parseHtmlCandidate(monitor, fetchResult.body, resolvedUrl, observationBase.fetchedAt);
    const contentHash = sha256(fetchResult.body);
    if (latest?.contentHash && latest.contentHash === contentHash) {
      await repository.insertObservation({
        ...observationBase,
        contentHash,
        htmlBlobPath,
        textExcerpt: parsed.textExcerpt,
        detectedDateStrings: parsed.detectedDateStrings,
      });
      observations += 1;
      continue;
    }

    const observation = await repository.insertObservation({
      ...observationBase,
      contentHash,
      htmlBlobPath,
      textExcerpt: parsed.textExcerpt,
      detectedDateStrings: parsed.detectedDateStrings,
    });
    observations += 1;

    const startsAt = parsed.startsAtJst;
    const canonicalEventKey =
      startsAt && parsed.endsAtJst ? buildCanonicalEventKey(monitor.brand, monitor.eventType, resolvedUrl, startsAt) : null;
    const existing = canonicalEventKey ? await repository.getPublishedEventByCanonicalKey(canonicalEventKey) : null;
    const candidate = await repository.insertCandidate({
      observationId: observation.id,
      candidateSlug: slugify(`${monitor.slug}-${observation.id}-${startsAt ?? observation.fetchedAt}`),
      canonicalEventKey,
      title: parsed.title,
      brand: monitor.brand,
      eventType: monitor.eventType,
      startsAtJst: parsed.startsAtJst,
      endsAtJst: parsed.endsAtJst,
      allDay: parsed.allDay,
      status: parsed.needsReview ? "pending_review" : "confirmed",
      publicEvidenceSummary: parsed.summary,
      sourceUrl: resolvedUrl,
      validationFlags: parsed.validationFlags,
      rulePassed: parsed.rulePassed,
      needsReview: parsed.needsReview,
      llmOutputJson: JSON.stringify(parsed.llmOutput),
      parserVersion: "heuristic-html-v1",
      proposedVersion: existing ? existing.currentVersion + 1 : 1,
    });
    candidates += 1;

    if (!parsed.needsReview && parsed.startsAtJst && parsed.endsAtJst) {
      await repository.publishCandidate(candidate.id, "system:auto", "publish_update");
      published += 1;
    }
  }

  return { observations, candidates, published };
}

async function isFetchAllowed(
  url: string,
  cache: Map<string, RobotsParserInstance>,
  domainThrottle: Map<string, number>,
  crawlDelaySeconds: number,
): Promise<boolean> {
  const parsed = new URL(url);
  const robotsUrl = `${parsed.origin}/robots.txt`;
  let robots = cache.get(robotsUrl);
  if (!robots) {
    try {
      await respectCrawlDelay(robotsUrl, domainThrottle, crawlDelaySeconds);
      const response = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT },
      });
      const body = response.ok ? await response.text() : "";
      robots = robotsParser(robotsUrl, body);
    } catch {
      robots = robotsParser(robotsUrl, "");
    }
    cache.set(robotsUrl, robots);
  }
  return robots.isAllowed(url, USER_AGENT) !== false;
}

async function respectCrawlDelay(url: string, domainThrottle: Map<string, number>, crawlDelaySeconds: number): Promise<void> {
  if (crawlDelaySeconds <= 0) {
    return;
  }

  const origin = new URL(url).origin;
  const now = Date.now();
  const lastRequestAt = domainThrottle.get(origin);
  const minGapMs = crawlDelaySeconds * 1000;
  if (lastRequestAt !== undefined && now - lastRequestAt < minGapMs) {
    await sleep(minGapMs - (now - lastRequestAt));
  }
  domainThrottle.set(origin, Date.now());
}

async function fetchWithRetry(
  url: string,
  monitor: SourceMonitor,
  etag?: string | null,
  lastModified?: string | null,
): Promise<{
  ok: boolean;
  status: number;
  finalUrl?: string;
  body?: string;
  etag?: string | null;
  lastModifiedHeader?: string | null;
  error?: string;
}> {
  const headers = new Headers({
    "user-agent": USER_AGENT,
    accept: "text/html,application/xhtml+xml",
  });
  if (etag) {
    headers.set("if-none-match", etag);
  }
  if (lastModified) {
    headers.set("if-modified-since", lastModified);
  }

  let attempt = 0;
  while (attempt <= monitor.maxRetries) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers,
      });
      if (response.status === 304) {
        return {
          ok: true,
          status: 304,
          finalUrl: response.url,
          etag: response.headers.get("etag"),
          lastModifiedHeader: response.headers.get("last-modified"),
        };
      }
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          finalUrl: response.url,
          body: await response.text(),
          etag: response.headers.get("etag"),
          lastModifiedHeader: response.headers.get("last-modified"),
        };
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < monitor.maxRetries) {
          await sleep((monitor.retryBackoffSeconds[attempt] ?? 60) * 1000);
        }
      } else {
        return {
          ok: false,
          status: response.status,
          finalUrl: response.url,
          error: `http-${response.status}`,
        };
      }
    } catch (error) {
      if (attempt >= monitor.maxRetries) {
        return {
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : "unknown-fetch-error",
        };
      }
      await sleep((monitor.retryBackoffSeconds[attempt] ?? 60) * 1000);
    }
    attempt += 1;
  }

  return {
    ok: false,
    status: 0,
    error: "retry-exhausted",
  };
}
