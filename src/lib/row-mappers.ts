import type {
  CrawlObservation,
  EventCandidate,
  PublishedEvent,
  ReviewAction,
  SourceMonitor,
} from "../types.js";
import { parseJsonArray, parseJsonNumberArray } from "./utils.js";

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return parseJsonArray(value);
  }
  return [];
}

function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  }
  if (typeof value === "string") {
    return parseJsonNumberArray(value);
  }
  return [];
}

export function mapSourceMonitor(row: Record<string, unknown>): SourceMonitor {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    brand: row.brand as SourceMonitor["brand"],
    eventType: row.event_type as SourceMonitor["eventType"],
    strategy: row.strategy as SourceMonitor["strategy"],
    seedUrls: toStringArray(row.seed_urls),
    allowedDomains: toStringArray(row.allowed_domains),
    requiresManualReview: Boolean(row.requires_manual_review),
    liteDefault: Boolean(row.lite_default),
    crawlDelaySeconds: Number(row.crawl_delay_seconds),
    maxRetries: Number(row.max_retries),
    retryBackoffSeconds: toNumberArray(row.retry_backoff_seconds),
    respectRobots: Boolean(row.respect_robots),
    enabled: Boolean(row.enabled),
  };
}

export function mapObservation(row: Record<string, unknown>): CrawlObservation {
  return {
    id: Number(row.id),
    sourceMonitorId: Number(row.source_monitor_id),
    fetchedAt: String(row.fetched_at),
    finalUrl: String(row.final_url),
    httpStatus: Number(row.http_status),
    etag: row.etag ? String(row.etag) : null,
    lastModifiedHeader: row.last_modified_header ? String(row.last_modified_header) : null,
    robotsCheckedAt: row.robots_checked_at ? String(row.robots_checked_at) : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
    htmlBlobPath: row.html_blob_path ? String(row.html_blob_path) : null,
    screenshotBlobPath: row.screenshot_blob_path ? String(row.screenshot_blob_path) : null,
    textExcerpt: row.text_excerpt ? String(row.text_excerpt) : null,
    detectedDateStrings: toStringArray(row.detected_date_strings),
    fetchError: row.fetch_error ? String(row.fetch_error) : null,
  };
}

export function mapCandidate(row: Record<string, unknown>): EventCandidate {
  return {
    id: Number(row.id),
    observationId: row.observation_id === null || row.observation_id === undefined ? null : Number(row.observation_id),
    candidateSlug: String(row.candidate_slug),
    canonicalEventKey: row.canonical_event_key ? String(row.canonical_event_key) : null,
    title: String(row.title),
    brand: row.brand as EventCandidate["brand"],
    eventType: row.event_type as EventCandidate["eventType"],
    startsAtJst: row.starts_at_jst ? String(row.starts_at_jst) : null,
    endsAtJst: row.ends_at_jst ? String(row.ends_at_jst) : null,
    allDay: Boolean(row.all_day),
    status: row.status as EventCandidate["status"],
    publicEvidenceSummary: String(row.public_evidence_summary),
    sourceUrl: String(row.source_url),
    validationFlags: toStringArray(row.validation_flags),
    rulePassed: Boolean(row.rule_passed),
    needsReview: Boolean(row.needs_review),
    llmOutputJson: row.llm_output_json ? String(row.llm_output_json) : null,
    parserVersion: String(row.parser_version),
    proposedVersion: Number(row.proposed_version),
  };
}

export function mapReviewAction(row: Record<string, unknown>): ReviewAction {
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    reviewerLabel: String(row.reviewer_label),
    action: row.action as ReviewAction["action"],
    reason: row.reason ? String(row.reason) : null,
    reviewedAt: String(row.reviewed_at),
  };
}

export function mapPublishedEvent(row: Record<string, unknown>): PublishedEvent {
  return {
    id: Number(row.id),
    eventSlug: String(row.event_slug),
    canonicalEventKey: String(row.canonical_event_key),
    icsUid: String(row.ics_uid),
    title: String(row.title),
    brand: row.brand as PublishedEvent["brand"],
    eventType: row.event_type as PublishedEvent["eventType"],
    startsAtJst: String(row.starts_at_jst),
    endsAtJst: String(row.ends_at_jst),
    allDay: Boolean(row.all_day),
    summary: String(row.summary),
    sourceUrl: String(row.source_url),
    verifiedAt: String(row.verified_at),
    publishedAt: String(row.published_at),
    endedAt: row.ended_at ? String(row.ended_at) : null,
    sequence: Number(row.sequence),
    icalStatus: row.ical_status as PublishedEvent["icalStatus"],
    lastModifiedUtc: String(row.last_modified_utc),
    currentVersion: Number(row.current_version),
    status: row.status as PublishedEvent["status"],
  };
}
