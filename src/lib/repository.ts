import { DateTime } from "luxon";
import type {
  CrawlObservation,
  EventCandidate,
  FailedMonitor,
  PublishedEvent,
  ReviewActionType,
  SourceMonitor,
} from "../types.js";
import { JST_ZONE } from "./time.js";

export interface ObservationInsert {
  sourceMonitorId: number;
  fetchedAt: string;
  finalUrl: string;
  httpStatus: number;
  etag?: string | null;
  lastModifiedHeader?: string | null;
  robotsCheckedAt?: string | null;
  contentHash?: string | null;
  htmlBlobPath?: string | null;
  screenshotBlobPath?: string | null;
  textExcerpt?: string | null;
  detectedDateStrings?: string[];
  fetchError?: string | null;
}

export interface CandidateInsert {
  observationId?: number | null;
  candidateSlug: string;
  canonicalEventKey?: string | null;
  title: string;
  brand: EventCandidate["brand"];
  eventType: EventCandidate["eventType"];
  startsAtJst?: string | null;
  endsAtJst?: string | null;
  allDay: boolean;
  status: EventCandidate["status"];
  publicEvidenceSummary: string;
  sourceUrl: string;
  validationFlags: string[];
  rulePassed: boolean;
  needsReview: boolean;
  llmOutputJson?: string | null;
  parserVersion: string;
  proposedVersion: number;
}

export interface ReviewHistoryItem {
  reviewedAt: string;
  action: ReviewActionType;
  reviewerLabel: string;
  reason: string | null;
}

export interface PendingCandidate extends EventCandidate {
  observation?: CrawlObservation | null;
}

export interface CalendarRepository {
  initialize(): Promise<void>;
  close(): Promise<void>;
  healthCheck(): Promise<void>;
  setAllMonitorCrawlDelays(seconds: number): Promise<void>;
  listMonitors(): Promise<SourceMonitor[]>;
  getMonitorBySlug(slug: string): Promise<SourceMonitor | null>;
  getLatestObservationForUrl(sourceMonitorId: number, url: string): Promise<CrawlObservation | null>;
  insertObservation(input: ObservationInsert): Promise<CrawlObservation>;
  insertCandidate(input: CandidateInsert): Promise<EventCandidate>;
  updateCandidateStatus(candidateId: number, status: EventCandidate["status"], canonicalEventKey?: string | null): Promise<EventCandidate>;
  listPendingCandidates(): Promise<PendingCandidate[]>;
  getCandidateById(candidateId: number): Promise<EventCandidate | null>;
  getObservationById(observationId: number): Promise<CrawlObservation | null>;
  listReviewActions(candidateId: number): Promise<ReviewHistoryItem[]>;
  listPublishedEvents(): Promise<PublishedEvent[]>;
  listUpcomingEvents(limit?: number): Promise<PublishedEvent[]>;
  getPublishedEventBySlug(eventSlug: string): Promise<PublishedEvent | null>;
  getPublishedEventByCanonicalKey(canonicalEventKey: string): Promise<PublishedEvent | null>;
  getPublishedEventByType(eventType: EventCandidate["eventType"]): Promise<PublishedEvent | null>;
  listFeedEvents(feedKey: "all" | "lite" | "muji" | "amazon" | "rakuten"): Promise<PublishedEvent[]>;
  recordReviewAction(candidateId: number, reviewerLabel: string, action: ReviewActionType, reason?: string): Promise<void>;
  publishCandidate(
    candidateId: number,
    reviewerLabel: string,
    action: Extract<ReviewActionType, "approve" | "publish_update">,
  ): Promise<PublishedEvent>;
  rejectCandidate(candidateId: number, reviewerLabel: string, reason?: string): Promise<EventCandidate>;
  cancelPublishedEvent(eventSlug: string, reviewerLabel: string, reason?: string): Promise<PublishedEvent>;
  syncEndedStatuses(): Promise<void>;
}

export interface CrawlSummary {
  monitorsProcessed: number;
  observationsCreated: number;
  candidatesCreated: number;
  publishedCount: number;
  failedMonitors: FailedMonitor[];
}

export function buildCanonicalEventKey(
  brand: EventCandidate["brand"],
  eventType: EventCandidate["eventType"],
  sourceUrl: string,
  startsAtJst: string,
): string {
  const start = DateTime.fromISO(startsAtJst, { zone: JST_ZONE });
  if (eventType === "rakuten_thanks_day") {
    return `${brand}:${eventType}:${start.toFormat("yyyy-LL")}`;
  }

  const sourcePath = new URL(sourceUrl).pathname.replaceAll("/", "-").replace(/^-+|-+$/g, "") || "root";
  return `${brand}:${eventType}:${sourcePath}:${start.toFormat("yyyy-LL-dd")}`;
}
