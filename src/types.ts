export type MonitorStrategy = "rule" | "static_page" | "seeded_discovery";

export type Brand = "muji" | "rakuten" | "amazon";

export type EventType =
  | "muji_ryohin_week"
  | "rakuten_thanks_day"
  | "rakuten_marathon"
  | "rakuten_super_sale"
  | "amazon_prime_day"
  | "amazon_prime_thanks_festival"
  | "amazon_black_friday";

export type CandidateStatus =
  | "observed"
  | "parsed"
  | "confirmed"
  | "pending_review"
  | "published"
  | "ended"
  | "rejected"
  | "superseded";

export type ReviewActionType = "approve" | "reject" | "publish_update";

export type IcalStatus = "CONFIRMED" | "CANCELLED";

export interface FailedMonitor {
  slug: string;
  error: string;
}

export interface SourceMonitor {
  id: number;
  slug: string;
  brand: Brand;
  eventType: EventType;
  strategy: MonitorStrategy;
  seedUrls: string[];
  allowedDomains: string[];
  requiresManualReview: boolean;
  liteDefault: boolean;
  crawlDelaySeconds: number;
  maxRetries: number;
  retryBackoffSeconds: number[];
  respectRobots: boolean;
  enabled: boolean;
}

export interface CrawlObservation {
  id: number;
  sourceMonitorId: number;
  fetchedAt: string;
  finalUrl: string;
  httpStatus: number;
  etag: string | null;
  lastModifiedHeader: string | null;
  robotsCheckedAt: string | null;
  contentHash: string | null;
  htmlBlobPath: string | null;
  screenshotBlobPath: string | null;
  textExcerpt: string | null;
  detectedDateStrings: string[];
  fetchError: string | null;
}

export interface EventCandidate {
  id: number;
  observationId: number | null;
  candidateSlug: string;
  canonicalEventKey: string | null;
  title: string;
  brand: Brand;
  eventType: EventType;
  startsAtJst: string | null;
  endsAtJst: string | null;
  allDay: boolean;
  status: CandidateStatus;
  publicEvidenceSummary: string;
  sourceUrl: string;
  validationFlags: string[];
  rulePassed: boolean;
  needsReview: boolean;
  llmOutputJson: string | null;
  parserVersion: string;
  proposedVersion: number;
}

export interface ReviewAction {
  id: number;
  candidateId: number;
  reviewerLabel: string;
  action: ReviewActionType;
  reason: string | null;
  reviewedAt: string;
}

export interface PublishedEvent {
  id: number;
  eventSlug: string;
  canonicalEventKey: string;
  icsUid: string;
  title: string;
  brand: Brand;
  eventType: EventType;
  startsAtJst: string;
  endsAtJst: string;
  allDay: boolean;
  summary: string;
  sourceUrl: string;
  verifiedAt: string;
  publishedAt: string;
  endedAt: string | null;
  sequence: number;
  icalStatus: IcalStatus;
  lastModifiedUtc: string;
  currentVersion: number;
  status: "published" | "ended";
}

export interface CandidateDraft {
  title: string;
  startsAtJst: string | null;
  endsAtJst: string | null;
  allDay: boolean;
  summary: string;
  sourceUrl: string;
  detectedDateStrings: string[];
  validationFlags: string[];
  llmOutput: Record<string, unknown>;
}
