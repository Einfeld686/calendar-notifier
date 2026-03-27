import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import type {
  EventCandidate,
  PublishedEvent,
  ReviewActionType,
} from "../types.js";
import { monitorSeeds } from "./monitors.js";
import {
  buildCanonicalEventKey,
  type CalendarRepository,
  type CandidateInsert,
  type ObservationInsert,
  type PendingCandidate,
  type ReviewHistoryItem,
} from "./repository.js";
import { mapCandidate, mapObservation, mapPublishedEvent, mapReviewAction, mapSourceMonitor } from "./row-mappers.js";
import { deriveEventStatus, JST_ZONE, toUtcStamp } from "./time.js";
import { sha256, slugify } from "./utils.js";

export class SqliteCalendarRepository implements CalendarRepository {
  private connection: DatabaseSync | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.connection = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.initializeSchema();
    this.seedMonitors();
  }

  async close(): Promise<void> {
    this.connection?.close();
    this.connection = null;
  }

  async healthCheck(): Promise<void> {
    this.db.prepare("SELECT 1").get();
  }

  async setAllMonitorCrawlDelays(seconds: number): Promise<void> {
    this.db.prepare("UPDATE source_monitor SET crawl_delay_seconds = ?").run(seconds);
  }

  async listMonitors() {
    const rows = this.db.prepare("SELECT * FROM source_monitor WHERE enabled = 1 ORDER BY id ASC").all() as Array<Record<string, unknown>>;
    return rows.map(mapSourceMonitor);
  }

  async getMonitorBySlug(slug: string) {
    const row = this.db.prepare("SELECT * FROM source_monitor WHERE slug = ?").get(slug) as Record<string, unknown> | undefined;
    return row ? mapSourceMonitor(row) : null;
  }

  async getLatestObservationForUrl(sourceMonitorId: number, url: string) {
    const row = this.db
      .prepare(
        `SELECT *
         FROM crawl_observation
         WHERE source_monitor_id = ? AND final_url = ?
         ORDER BY fetched_at DESC
         LIMIT 1`,
      )
      .get(sourceMonitorId, url) as Record<string, unknown> | undefined;
    return row ? mapObservation(row) : null;
  }

  async insertObservation(input: ObservationInsert) {
    const result = this.db
      .prepare(
        `INSERT INTO crawl_observation (
          source_monitor_id,
          fetched_at,
          final_url,
          http_status,
          etag,
          last_modified_header,
          robots_checked_at,
          content_hash,
          html_blob_path,
          screenshot_blob_path,
          text_excerpt,
          detected_date_strings,
          fetch_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sourceMonitorId,
        input.fetchedAt,
        input.finalUrl,
        input.httpStatus,
        input.etag ?? null,
        input.lastModifiedHeader ?? null,
        input.robotsCheckedAt ?? null,
        input.contentHash ?? null,
        input.htmlBlobPath ?? null,
        input.screenshotBlobPath ?? null,
        input.textExcerpt ?? null,
        JSON.stringify(input.detectedDateStrings ?? []),
        input.fetchError ?? null,
      );
    const row = this.db.prepare("SELECT * FROM crawl_observation WHERE id = ?").get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return mapObservation(row);
  }

  async insertCandidate(input: CandidateInsert) {
    const result = this.db
      .prepare(
        `INSERT INTO event_candidate (
          observation_id,
          candidate_slug,
          canonical_event_key,
          title,
          brand,
          event_type,
          starts_at_jst,
          ends_at_jst,
          all_day,
          status,
          public_evidence_summary,
          source_url,
          validation_flags,
          rule_passed,
          needs_review,
          llm_output_json,
          parser_version,
          proposed_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.observationId ?? null,
        input.candidateSlug,
        input.canonicalEventKey ?? null,
        input.title,
        input.brand,
        input.eventType,
        input.startsAtJst ?? null,
        input.endsAtJst ?? null,
        Number(input.allDay),
        input.status,
        input.publicEvidenceSummary,
        input.sourceUrl,
        JSON.stringify(input.validationFlags),
        Number(input.rulePassed),
        Number(input.needsReview),
        input.llmOutputJson ?? null,
        input.parserVersion,
        input.proposedVersion,
      );
    const row = this.db.prepare("SELECT * FROM event_candidate WHERE id = ?").get(Number(result.lastInsertRowid)) as Record<string, unknown>;
    return mapCandidate(row);
  }

  async updateCandidateStatus(candidateId: number, status: EventCandidate["status"], canonicalEventKey?: string | null) {
    this.db
      .prepare("UPDATE event_candidate SET status = ?, canonical_event_key = COALESCE(?, canonical_event_key) WHERE id = ?")
      .run(status, canonicalEventKey ?? null, candidateId);
    return this.getCandidateById(candidateId) as Promise<EventCandidate>;
  }

  async listPendingCandidates(): Promise<PendingCandidate[]> {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM event_candidate
         WHERE status = 'pending_review'
         ORDER BY id DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    const pending: PendingCandidate[] = [];
    for (const row of rows) {
      const candidate = mapCandidate(row);
      const observation = candidate.observationId ? await this.getObservationById(candidate.observationId) : null;
      pending.push({ ...candidate, observation });
    }
    return pending;
  }

  async getCandidateById(candidateId: number) {
    const row = this.db.prepare("SELECT * FROM event_candidate WHERE id = ?").get(candidateId) as Record<string, unknown> | undefined;
    return row ? mapCandidate(row) : null;
  }

  async getObservationById(observationId: number) {
    const row = this.db.prepare("SELECT * FROM crawl_observation WHERE id = ?").get(observationId) as Record<string, unknown> | undefined;
    return row ? mapObservation(row) : null;
  }

  async listReviewActions(candidateId: number): Promise<ReviewHistoryItem[]> {
    const rows = this.db
      .prepare("SELECT * FROM review_action WHERE candidate_id = ? ORDER BY reviewed_at DESC")
      .all(candidateId) as Array<Record<string, unknown>>;
    return rows.map(mapReviewAction);
  }

  async listPublishedEvents() {
    const rows = this.db.prepare("SELECT * FROM published_event ORDER BY starts_at_jst ASC, id ASC").all() as Array<Record<string, unknown>>;
    return rows.map(mapPublishedEvent);
  }

  async listUpcomingEvents(limit = 8) {
    await this.syncEndedStatuses();
    const now = DateTime.now().setZone(JST_ZONE).toISO()!;
    const rows = this.db
      .prepare(
        `SELECT *
         FROM published_event
         WHERE status = 'published' AND ical_status != 'CANCELLED' AND ends_at_jst >= ?
         ORDER BY starts_at_jst ASC
         LIMIT ?`,
      )
      .all(now, limit) as Array<Record<string, unknown>>;
    return rows.map(mapPublishedEvent);
  }

  async getPublishedEventBySlug(eventSlug: string) {
    await this.syncEndedStatuses();
    const row = this.db.prepare("SELECT * FROM published_event WHERE event_slug = ?").get(eventSlug) as Record<string, unknown> | undefined;
    return row ? mapPublishedEvent(row) : null;
  }

  async getPublishedEventByCanonicalKey(canonicalEventKey: string) {
    const row = this.db
      .prepare("SELECT * FROM published_event WHERE canonical_event_key = ?")
      .get(canonicalEventKey) as Record<string, unknown> | undefined;
    return row ? mapPublishedEvent(row) : null;
  }

  async getPublishedEventByType(eventType: EventCandidate["eventType"]) {
    const row = this.db
      .prepare(
        `SELECT *
         FROM published_event
         WHERE event_type = ?
         ORDER BY published_at DESC
         LIMIT 1`,
      )
      .get(eventType) as Record<string, unknown> | undefined;
    return row ? mapPublishedEvent(row) : null;
  }

  async listFeedEvents(feedKey: "all" | "lite" | "muji" | "amazon" | "rakuten") {
    await this.syncEndedStatuses();
    const baseSql =
      "SELECT * FROM published_event WHERE ical_status IN ('CONFIRMED', 'CANCELLED') AND status IN ('published', 'ended')";
    let sql = baseSql;
    const params: unknown[] = [];

    if (feedKey === "lite") {
      sql +=
        " AND event_type IN ('muji_ryohin_week','amazon_prime_day','amazon_prime_thanks_festival','amazon_black_friday','rakuten_super_sale')";
    } else if (feedKey !== "all") {
      sql += " AND brand = ?";
      params.push(feedKey);
    }

    sql += " ORDER BY starts_at_jst ASC, id ASC";
    const rows = this.db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
    return rows.map(mapPublishedEvent);
  }

  async recordReviewAction(candidateId: number, reviewerLabel: string, action: ReviewActionType, reason?: string) {
    this.db
      .prepare(
        `INSERT INTO review_action (candidate_id, reviewer_label, action, reason, reviewed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(candidateId, reviewerLabel, action, reason ?? null, DateTime.now().setZone(JST_ZONE).toISO());
  }

  async publishCandidate(candidateId: number, reviewerLabel: string, action: Extract<ReviewActionType, "approve" | "publish_update">) {
    return this.transaction(async () => {
      const candidate = this.getCandidateByIdSync(candidateId);
      if (!candidate) {
        throw new Error("Candidate not found");
      }
      if (!candidate.startsAtJst || !candidate.endsAtJst) {
        throw new Error("Candidate is missing normalized dates");
      }

      const canonicalEventKey =
        candidate.canonicalEventKey ?? buildCanonicalEventKey(candidate.brand, candidate.eventType, candidate.sourceUrl, candidate.startsAtJst);
      const existing = this.getPublishedEventByCanonicalKeySync(canonicalEventKey);
      const eventSlug = existing?.eventSlug ?? slugify(`${candidate.brand}-${candidate.eventType}-${candidate.startsAtJst.slice(0, 10)}`);
      const nowUtc = toUtcStamp();
      const currentVersion = (existing?.currentVersion ?? 0) + 1;
      const sequence = existing ? existing.sequence + 1 : 0;
      const status = deriveEventStatus(candidate.endsAtJst);
      const verifiedAt = DateTime.now().setZone(JST_ZONE).toISO()!;
      const icsUid = existing?.icsUid ?? `event-${sha256(canonicalEventKey).slice(0, 24)}@calendar-notifier.local`;

      if (existing) {
        this.db
          .prepare(
            `UPDATE published_event
             SET title = ?,
                 starts_at_jst = ?,
                 ends_at_jst = ?,
                 all_day = ?,
                 summary = ?,
                 source_url = ?,
                 verified_at = ?,
                 sequence = ?,
                 last_modified_utc = ?,
                 current_version = ?,
                 status = ?,
                 ended_at = ?,
                 ical_status = 'CONFIRMED'
             WHERE id = ?`,
          )
          .run(
            candidate.title,
            candidate.startsAtJst,
            candidate.endsAtJst,
            Number(candidate.allDay),
            candidate.publicEvidenceSummary,
            candidate.sourceUrl,
            verifiedAt,
            sequence,
            nowUtc,
            currentVersion,
            status,
            status === "ended" ? candidate.endsAtJst : null,
            existing.id,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO published_event (
              event_slug,
              canonical_event_key,
              ics_uid,
              title,
              brand,
              event_type,
              starts_at_jst,
              ends_at_jst,
              all_day,
              summary,
              source_url,
              verified_at,
              published_at,
              ended_at,
              sequence,
              ical_status,
              last_modified_utc,
              current_version,
              status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            eventSlug,
            canonicalEventKey,
            icsUid,
            candidate.title,
            candidate.brand,
            candidate.eventType,
            candidate.startsAtJst,
            candidate.endsAtJst,
            Number(candidate.allDay),
            candidate.publicEvidenceSummary,
            candidate.sourceUrl,
            verifiedAt,
            verifiedAt,
            status === "ended" ? candidate.endsAtJst : null,
            sequence,
            "CONFIRMED",
            nowUtc,
            currentVersion,
            status,
          );
      }

      this.db
        .prepare("UPDATE event_candidate SET status = 'published', canonical_event_key = ? WHERE id = ?")
        .run(canonicalEventKey, candidateId);
      this.recordReviewActionSync(candidateId, reviewerLabel, action);
      return this.getPublishedEventByCanonicalKeySync(canonicalEventKey)!;
    });
  }

  async rejectCandidate(candidateId: number, reviewerLabel: string, reason?: string) {
    return this.transaction(async () => {
      this.db.prepare("UPDATE event_candidate SET status = 'rejected' WHERE id = ?").run(candidateId);
      this.recordReviewActionSync(candidateId, reviewerLabel, "reject", reason);
      return this.getCandidateByIdSync(candidateId)!;
    });
  }

  async cancelPublishedEvent(eventSlug: string, reviewerLabel: string, reason?: string) {
    return this.transaction(async () => {
      const existing = this.getPublishedEventBySlugSync(eventSlug);
      if (!existing) {
        throw new Error("Published event not found");
      }
      this.db
        .prepare(
          `UPDATE published_event
           SET ical_status = 'CANCELLED',
               sequence = ?,
               current_version = current_version + 1,
               last_modified_utc = ?
           WHERE id = ?`,
        )
        .run(existing.sequence + 1, toUtcStamp(), existing.id);
      const candidate = this.db
        .prepare("SELECT id FROM event_candidate WHERE canonical_event_key = ? ORDER BY id DESC LIMIT 1")
        .get(existing.canonicalEventKey) as { id?: number } | undefined;
      if (candidate?.id) {
        this.recordReviewActionSync(candidate.id, reviewerLabel, "publish_update", reason ?? "manual cancellation");
      }
      return this.getPublishedEventBySlugSync(eventSlug)!;
    });
  }

  async syncEndedStatuses(): Promise<void> {
    const now = DateTime.now().setZone(JST_ZONE).toISO()!;
    this.db
      .prepare(
        `UPDATE published_event
         SET status = 'ended',
             ended_at = COALESCE(ended_at, ends_at_jst)
         WHERE ends_at_jst <= ? AND status != 'ended'`,
      )
      .run(now);
  }

  private get db(): DatabaseSync {
    if (!this.connection) {
      throw new Error("SQLite repository is not initialized");
    }
    return this.connection;
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_monitor (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        brand TEXT NOT NULL,
        event_type TEXT NOT NULL,
        strategy TEXT NOT NULL,
        seed_urls TEXT NOT NULL,
        allowed_domains TEXT NOT NULL,
        requires_manual_review INTEGER NOT NULL,
        lite_default INTEGER NOT NULL,
        crawl_delay_seconds INTEGER NOT NULL,
        max_retries INTEGER NOT NULL,
        retry_backoff_seconds TEXT NOT NULL,
        respect_robots INTEGER NOT NULL,
        enabled INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crawl_observation (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_monitor_id INTEGER NOT NULL REFERENCES source_monitor(id),
        fetched_at TEXT NOT NULL,
        final_url TEXT NOT NULL,
        http_status INTEGER NOT NULL,
        etag TEXT,
        last_modified_header TEXT,
        robots_checked_at TEXT,
        content_hash TEXT,
        html_blob_path TEXT,
        screenshot_blob_path TEXT,
        text_excerpt TEXT,
        detected_date_strings TEXT NOT NULL DEFAULT '[]',
        fetch_error TEXT
      );

      CREATE TABLE IF NOT EXISTS event_candidate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observation_id INTEGER REFERENCES crawl_observation(id),
        candidate_slug TEXT UNIQUE NOT NULL,
        canonical_event_key TEXT,
        title TEXT NOT NULL,
        brand TEXT NOT NULL,
        event_type TEXT NOT NULL,
        starts_at_jst TEXT,
        ends_at_jst TEXT,
        all_day INTEGER NOT NULL,
        status TEXT NOT NULL,
        public_evidence_summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        validation_flags TEXT NOT NULL DEFAULT '[]',
        rule_passed INTEGER NOT NULL,
        needs_review INTEGER NOT NULL,
        llm_output_json TEXT,
        parser_version TEXT NOT NULL,
        proposed_version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_action (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER NOT NULL REFERENCES event_candidate(id),
        reviewer_label TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        reviewed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS published_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_slug TEXT UNIQUE NOT NULL,
        canonical_event_key TEXT UNIQUE NOT NULL,
        ics_uid TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        brand TEXT NOT NULL,
        event_type TEXT NOT NULL,
        starts_at_jst TEXT NOT NULL,
        ends_at_jst TEXT NOT NULL,
        all_day INTEGER NOT NULL,
        summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        published_at TEXT NOT NULL,
        ended_at TEXT,
        sequence INTEGER NOT NULL,
        ical_status TEXT NOT NULL,
        last_modified_utc TEXT NOT NULL,
        current_version INTEGER NOT NULL,
        status TEXT NOT NULL
      );
    `);
  }

  private seedMonitors(): void {
    const insert = this.db.prepare(`
      INSERT INTO source_monitor (
        slug,
        brand,
        event_type,
        strategy,
        seed_urls,
        allowed_domains,
        requires_manual_review,
        lite_default,
        crawl_delay_seconds,
        max_retries,
        retry_backoff_seconds,
        respect_robots,
        enabled
      ) VALUES (
        $slug,
        $brand,
        $eventType,
        $strategy,
        $seedUrls,
        $allowedDomains,
        $requiresManualReview,
        $liteDefault,
        $crawlDelaySeconds,
        $maxRetries,
        $retryBackoffSeconds,
        $respectRobots,
        $enabled
      )
      ON CONFLICT(slug) DO UPDATE SET
        brand = excluded.brand,
        event_type = excluded.event_type,
        strategy = excluded.strategy,
        seed_urls = excluded.seed_urls,
        allowed_domains = excluded.allowed_domains,
        requires_manual_review = excluded.requires_manual_review,
        lite_default = excluded.lite_default,
        crawl_delay_seconds = excluded.crawl_delay_seconds,
        max_retries = excluded.max_retries,
        retry_backoff_seconds = excluded.retry_backoff_seconds,
        respect_robots = excluded.respect_robots,
        enabled = excluded.enabled;
    `);

    for (const seed of monitorSeeds) {
      insert.run({
        $slug: seed.slug,
        $brand: seed.brand,
        $eventType: seed.eventType,
        $strategy: seed.strategy,
        $seedUrls: JSON.stringify(seed.seedUrls),
        $allowedDomains: JSON.stringify(seed.allowedDomains),
        $requiresManualReview: Number(seed.requiresManualReview),
        $liteDefault: Number(seed.liteDefault),
        $crawlDelaySeconds: seed.crawlDelaySeconds,
        $maxRetries: seed.maxRetries,
        $retryBackoffSeconds: JSON.stringify(seed.retryBackoffSeconds),
        $respectRobots: Number(seed.respectRobots),
        $enabled: Number(seed.enabled),
      });
    }
  }

  private transaction<T>(work: () => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      return Promise.resolve(result)
        .then((value) => {
          this.db.exec("COMMIT");
          return value;
        })
        .catch((error) => {
          this.db.exec("ROLLBACK");
          throw error;
        });
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private getCandidateByIdSync(candidateId: number): EventCandidate | null {
    const row = this.db.prepare("SELECT * FROM event_candidate WHERE id = ?").get(candidateId) as Record<string, unknown> | undefined;
    return row ? mapCandidate(row) : null;
  }

  private getPublishedEventByCanonicalKeySync(canonicalEventKey: string): PublishedEvent | null {
    const row = this.db
      .prepare("SELECT * FROM published_event WHERE canonical_event_key = ?")
      .get(canonicalEventKey) as Record<string, unknown> | undefined;
    return row ? mapPublishedEvent(row) : null;
  }

  private getPublishedEventBySlugSync(eventSlug: string): PublishedEvent | null {
    const row = this.db.prepare("SELECT * FROM published_event WHERE event_slug = ?").get(eventSlug) as Record<string, unknown> | undefined;
    return row ? mapPublishedEvent(row) : null;
  }

  private recordReviewActionSync(candidateId: number, reviewerLabel: string, action: ReviewActionType, reason?: string): void {
    this.db
      .prepare(
        `INSERT INTO review_action (candidate_id, reviewer_label, action, reason, reviewed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(candidateId, reviewerLabel, action, reason ?? null, DateTime.now().setZone(JST_ZONE).toISO());
  }
}
