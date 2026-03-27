import { Pool, type PoolClient, type QueryResultRow } from "pg";
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

type Queryable = Pool | PoolClient;

export class PostgresCalendarRepository implements CalendarRepository {
  private readonly pool: Pool;

  constructor(
    private readonly databaseUrl: string,
    pool?: Pool,
  ) {
    this.pool = pool ?? new Pool({ connectionString: databaseUrl });
  }

  async initialize(): Promise<void> {
    await this.migrate(this.pool);
    await this.seedMonitors(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async healthCheck(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async setAllMonitorCrawlDelays(seconds: number): Promise<void> {
    await this.pool.query("UPDATE source_monitor SET crawl_delay_seconds = $1", [seconds]);
  }

  async listMonitors() {
    const result = await this.pool.query("SELECT * FROM source_monitor WHERE enabled = TRUE ORDER BY id ASC");
    return result.rows.map((row) => mapSourceMonitor(row as Record<string, unknown>));
  }

  async getMonitorBySlug(slug: string) {
    const result = await this.pool.query("SELECT * FROM source_monitor WHERE slug = $1", [slug]);
    return result.rows[0] ? mapSourceMonitor(result.rows[0] as Record<string, unknown>) : null;
  }

  async getLatestObservationForUrl(sourceMonitorId: number, url: string) {
    const result = await this.pool.query(
      `SELECT *
       FROM crawl_observation
       WHERE source_monitor_id = $1 AND final_url = $2
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [sourceMonitorId, url],
    );
    return result.rows[0] ? mapObservation(result.rows[0] as Record<string, unknown>) : null;
  }

  async insertObservation(input: ObservationInsert) {
    const result = await this.pool.query(
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
      RETURNING *`,
      [
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
      ],
    );
    return mapObservation(result.rows[0] as Record<string, unknown>);
  }

  async insertCandidate(input: CandidateInsert) {
    const result = await this.pool.query(
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb, $17, $18)
      RETURNING *`,
      [
        input.observationId ?? null,
        input.candidateSlug,
        input.canonicalEventKey ?? null,
        input.title,
        input.brand,
        input.eventType,
        input.startsAtJst ?? null,
        input.endsAtJst ?? null,
        input.allDay,
        input.status,
        input.publicEvidenceSummary,
        input.sourceUrl,
        JSON.stringify(input.validationFlags),
        input.rulePassed,
        input.needsReview,
        input.llmOutputJson ?? JSON.stringify({}),
        input.parserVersion,
        input.proposedVersion,
      ],
    );
    return mapCandidate(result.rows[0] as Record<string, unknown>);
  }

  async updateCandidateStatus(candidateId: number, status: EventCandidate["status"], canonicalEventKey?: string | null) {
    const result = await this.pool.query(
      `UPDATE event_candidate
       SET status = $1,
           canonical_event_key = COALESCE($2, canonical_event_key)
       WHERE id = $3
       RETURNING *`,
      [status, canonicalEventKey ?? null, candidateId],
    );
    return mapCandidate(result.rows[0] as Record<string, unknown>);
  }

  async listPendingCandidates(): Promise<PendingCandidate[]> {
    const result = await this.pool.query(
      `SELECT *
       FROM event_candidate
       WHERE status = 'pending_review'
       ORDER BY id DESC`,
    );
    const pending: PendingCandidate[] = [];
    for (const row of result.rows) {
      const candidate = mapCandidate(row as Record<string, unknown>);
      const observation = candidate.observationId ? await this.getObservationById(candidate.observationId) : null;
      pending.push({ ...candidate, observation });
    }
    return pending;
  }

  async getCandidateById(candidateId: number) {
    const result = await this.pool.query("SELECT * FROM event_candidate WHERE id = $1", [candidateId]);
    return result.rows[0] ? mapCandidate(result.rows[0] as Record<string, unknown>) : null;
  }

  async getObservationById(observationId: number) {
    const result = await this.pool.query("SELECT * FROM crawl_observation WHERE id = $1", [observationId]);
    return result.rows[0] ? mapObservation(result.rows[0] as Record<string, unknown>) : null;
  }

  async listReviewActions(candidateId: number): Promise<ReviewHistoryItem[]> {
    const result = await this.pool.query("SELECT * FROM review_action WHERE candidate_id = $1 ORDER BY reviewed_at DESC", [candidateId]);
    return result.rows.map((row) => mapReviewAction(row as Record<string, unknown>));
  }

  async listPublishedEvents() {
    const result = await this.pool.query("SELECT * FROM published_event ORDER BY starts_at_jst ASC, id ASC");
    return result.rows.map((row) => mapPublishedEvent(row as Record<string, unknown>));
  }

  async listUpcomingEvents(limit = 8) {
    await this.syncEndedStatuses();
    const now = DateTime.now().setZone(JST_ZONE).toISO()!;
    const result = await this.pool.query(
      `SELECT *
       FROM published_event
       WHERE status = 'published' AND ical_status != 'CANCELLED' AND ends_at_jst >= $1
       ORDER BY starts_at_jst ASC
       LIMIT $2`,
      [now, limit],
    );
    return result.rows.map((row) => mapPublishedEvent(row as Record<string, unknown>));
  }

  async getPublishedEventBySlug(eventSlug: string) {
    await this.syncEndedStatuses();
    const result = await this.pool.query("SELECT * FROM published_event WHERE event_slug = $1", [eventSlug]);
    return result.rows[0] ? mapPublishedEvent(result.rows[0] as Record<string, unknown>) : null;
  }

  async getPublishedEventByCanonicalKey(canonicalEventKey: string) {
    const result = await this.pool.query("SELECT * FROM published_event WHERE canonical_event_key = $1", [canonicalEventKey]);
    return result.rows[0] ? mapPublishedEvent(result.rows[0] as Record<string, unknown>) : null;
  }

  async getPublishedEventByType(eventType: EventCandidate["eventType"]) {
    const result = await this.pool.query(
      `SELECT *
       FROM published_event
       WHERE event_type = $1
       ORDER BY published_at DESC
       LIMIT 1`,
      [eventType],
    );
    return result.rows[0] ? mapPublishedEvent(result.rows[0] as Record<string, unknown>) : null;
  }

  async listFeedEvents(feedKey: "all" | "lite" | "muji" | "amazon" | "rakuten") {
    await this.syncEndedStatuses();
    const params: unknown[] = [];
    let sql =
      "SELECT * FROM published_event WHERE ical_status IN ('CONFIRMED', 'CANCELLED') AND status IN ('published', 'ended')";

    if (feedKey === "lite") {
      sql +=
        " AND event_type IN ('muji_ryohin_week','amazon_prime_day','amazon_prime_thanks_festival','amazon_black_friday','rakuten_super_sale')";
    } else if (feedKey !== "all") {
      params.push(feedKey);
      sql += ` AND brand = $${params.length}`;
    }

    sql += " ORDER BY starts_at_jst ASC, id ASC";
    const result = await this.pool.query(sql, params);
    return result.rows.map((row) => mapPublishedEvent(row as Record<string, unknown>));
  }

  async recordReviewAction(candidateId: number, reviewerLabel: string, action: ReviewActionType, reason?: string) {
    await this.pool.query(
      `INSERT INTO review_action (candidate_id, reviewer_label, action, reason, reviewed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [candidateId, reviewerLabel, action, reason ?? null, DateTime.now().setZone(JST_ZONE).toISO()],
    );
  }

  async publishCandidate(candidateId: number, reviewerLabel: string, action: Extract<ReviewActionType, "approve" | "publish_update">) {
    return this.transaction(async (client) => {
      const candidate = await this.getCandidateByIdWith(client, candidateId);
      if (!candidate) {
        throw new Error("Candidate not found");
      }
      if (!candidate.startsAtJst || !candidate.endsAtJst) {
        throw new Error("Candidate is missing normalized dates");
      }

      const canonicalEventKey =
        candidate.canonicalEventKey ?? buildCanonicalEventKey(candidate.brand, candidate.eventType, candidate.sourceUrl, candidate.startsAtJst);
      const existing = await this.getPublishedEventByCanonicalKeyWith(client, canonicalEventKey);
      const eventSlug = existing?.eventSlug ?? slugify(`${candidate.brand}-${candidate.eventType}-${candidate.startsAtJst.slice(0, 10)}`);
      const nowUtc = toUtcStamp();
      const currentVersion = (existing?.currentVersion ?? 0) + 1;
      const sequence = existing ? existing.sequence + 1 : 0;
      const status = deriveEventStatus(candidate.endsAtJst);
      const verifiedAt = DateTime.now().setZone(JST_ZONE).toISO()!;
      const icsUid = existing?.icsUid ?? `event-${sha256(canonicalEventKey).slice(0, 24)}@calendar-notifier.local`;

      if (existing) {
        await client.query(
          `UPDATE published_event
           SET title = $1,
               starts_at_jst = $2,
               ends_at_jst = $3,
               all_day = $4,
               summary = $5,
               source_url = $6,
               verified_at = $7,
               sequence = $8,
               last_modified_utc = $9,
               current_version = $10,
               status = $11,
               ended_at = $12,
               ical_status = 'CONFIRMED'
           WHERE id = $13`,
          [
            candidate.title,
            candidate.startsAtJst,
            candidate.endsAtJst,
            candidate.allDay,
            candidate.publicEvidenceSummary,
            candidate.sourceUrl,
            verifiedAt,
            sequence,
            nowUtc,
            currentVersion,
            status,
            status === "ended" ? candidate.endsAtJst : null,
            existing.id,
          ],
        );
      } else {
        await client.query(
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
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [
            eventSlug,
            canonicalEventKey,
            icsUid,
            candidate.title,
            candidate.brand,
            candidate.eventType,
            candidate.startsAtJst,
            candidate.endsAtJst,
            candidate.allDay,
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
          ],
        );
      }

      await client.query("UPDATE event_candidate SET status = 'published', canonical_event_key = $1 WHERE id = $2", [
        canonicalEventKey,
        candidateId,
      ]);
      await this.recordReviewActionWith(client, candidateId, reviewerLabel, action);
      const published = await this.getPublishedEventByCanonicalKeyWith(client, canonicalEventKey);
      if (!published) {
        throw new Error("Published event not found after upsert");
      }
      return published;
    });
  }

  async rejectCandidate(candidateId: number, reviewerLabel: string, reason?: string) {
    return this.transaction(async (client) => {
      await client.query("UPDATE event_candidate SET status = 'rejected' WHERE id = $1", [candidateId]);
      await this.recordReviewActionWith(client, candidateId, reviewerLabel, "reject", reason);
      const candidate = await this.getCandidateByIdWith(client, candidateId);
      if (!candidate) {
        throw new Error("Candidate not found after reject");
      }
      return candidate;
    });
  }

  async cancelPublishedEvent(eventSlug: string, reviewerLabel: string, reason?: string) {
    return this.transaction(async (client) => {
      const existing = await this.getPublishedEventBySlugWith(client, eventSlug);
      if (!existing) {
        throw new Error("Published event not found");
      }

      await client.query(
        `UPDATE published_event
         SET ical_status = 'CANCELLED',
             sequence = $1,
             current_version = current_version + 1,
             last_modified_utc = $2
         WHERE id = $3`,
        [existing.sequence + 1, toUtcStamp(), existing.id],
      );
      const candidateResult = await client.query(
        "SELECT id FROM event_candidate WHERE canonical_event_key = $1 ORDER BY id DESC LIMIT 1",
        [existing.canonicalEventKey],
      );
      const candidateId = candidateResult.rows[0]?.id ? Number(candidateResult.rows[0].id) : null;
      if (candidateId) {
        await this.recordReviewActionWith(client, candidateId, reviewerLabel, "publish_update", reason ?? "manual cancellation");
      }
      const updated = await this.getPublishedEventBySlugWith(client, eventSlug);
      if (!updated) {
        throw new Error("Published event not found after cancellation");
      }
      return updated;
    });
  }

  async syncEndedStatuses(): Promise<void> {
    const now = DateTime.now().setZone(JST_ZONE).toISO()!;
    await this.pool.query(
      `UPDATE published_event
       SET status = 'ended',
           ended_at = COALESCE(ended_at, ends_at_jst)
       WHERE ends_at_jst <= $1 AND status != 'ended'`,
      [now],
    );
  }

  private async migrate(db: Queryable): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS source_monitor (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        brand TEXT NOT NULL,
        event_type TEXT NOT NULL,
        strategy TEXT NOT NULL,
        seed_urls JSONB NOT NULL,
        allowed_domains JSONB NOT NULL,
        requires_manual_review BOOLEAN NOT NULL,
        lite_default BOOLEAN NOT NULL,
        crawl_delay_seconds INTEGER NOT NULL,
        max_retries INTEGER NOT NULL,
        retry_backoff_seconds JSONB NOT NULL,
        respect_robots BOOLEAN NOT NULL,
        enabled BOOLEAN NOT NULL
      );

      CREATE TABLE IF NOT EXISTS crawl_observation (
        id SERIAL PRIMARY KEY,
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
        detected_date_strings JSONB NOT NULL DEFAULT '[]'::jsonb,
        fetch_error TEXT
      );

      CREATE TABLE IF NOT EXISTS event_candidate (
        id SERIAL PRIMARY KEY,
        observation_id INTEGER REFERENCES crawl_observation(id),
        candidate_slug TEXT UNIQUE NOT NULL,
        canonical_event_key TEXT,
        title TEXT NOT NULL,
        brand TEXT NOT NULL,
        event_type TEXT NOT NULL,
        starts_at_jst TEXT,
        ends_at_jst TEXT,
        all_day BOOLEAN NOT NULL,
        status TEXT NOT NULL,
        public_evidence_summary TEXT NOT NULL,
        source_url TEXT NOT NULL,
        validation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
        rule_passed BOOLEAN NOT NULL,
        needs_review BOOLEAN NOT NULL,
        llm_output_json JSONB,
        parser_version TEXT NOT NULL,
        proposed_version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_action (
        id SERIAL PRIMARY KEY,
        candidate_id INTEGER NOT NULL REFERENCES event_candidate(id),
        reviewer_label TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        reviewed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS published_event (
        id SERIAL PRIMARY KEY,
        event_slug TEXT UNIQUE NOT NULL,
        canonical_event_key TEXT UNIQUE NOT NULL,
        ics_uid TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        brand TEXT NOT NULL,
        event_type TEXT NOT NULL,
        starts_at_jst TEXT NOT NULL,
        ends_at_jst TEXT NOT NULL,
        all_day BOOLEAN NOT NULL,
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

  private async seedMonitors(db: Queryable): Promise<void> {
    for (const seed of monitorSeeds) {
      await db.query(
        `INSERT INTO source_monitor (
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
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12, $13)
        ON CONFLICT (slug) DO UPDATE SET
          brand = EXCLUDED.brand,
          event_type = EXCLUDED.event_type,
          strategy = EXCLUDED.strategy,
          seed_urls = EXCLUDED.seed_urls,
          allowed_domains = EXCLUDED.allowed_domains,
          requires_manual_review = EXCLUDED.requires_manual_review,
          lite_default = EXCLUDED.lite_default,
          crawl_delay_seconds = EXCLUDED.crawl_delay_seconds,
          max_retries = EXCLUDED.max_retries,
          retry_backoff_seconds = EXCLUDED.retry_backoff_seconds,
          respect_robots = EXCLUDED.respect_robots,
          enabled = EXCLUDED.enabled`,
        [
          seed.slug,
          seed.brand,
          seed.eventType,
          seed.strategy,
          JSON.stringify(seed.seedUrls),
          JSON.stringify(seed.allowedDomains),
          seed.requiresManualReview,
          seed.liteDefault,
          seed.crawlDelaySeconds,
          seed.maxRetries,
          JSON.stringify(seed.retryBackoffSeconds),
          seed.respectRobots,
          seed.enabled,
        ],
      );
    }
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getCandidateByIdWith(db: Queryable, candidateId: number): Promise<EventCandidate | null> {
    const result = await db.query("SELECT * FROM event_candidate WHERE id = $1", [candidateId]);
    return result.rows[0] ? mapCandidate(result.rows[0] as Record<string, unknown>) : null;
  }

  private async getPublishedEventByCanonicalKeyWith(db: Queryable, canonicalEventKey: string): Promise<PublishedEvent | null> {
    const result = await db.query("SELECT * FROM published_event WHERE canonical_event_key = $1", [canonicalEventKey]);
    return result.rows[0] ? mapPublishedEvent(result.rows[0] as Record<string, unknown>) : null;
  }

  private async getPublishedEventBySlugWith(db: Queryable, eventSlug: string): Promise<PublishedEvent | null> {
    const result = await db.query("SELECT * FROM published_event WHERE event_slug = $1", [eventSlug]);
    return result.rows[0] ? mapPublishedEvent(result.rows[0] as Record<string, unknown>) : null;
  }

  private async recordReviewActionWith(
    db: Queryable,
    candidateId: number,
    reviewerLabel: string,
    action: ReviewActionType,
    reason?: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO review_action (candidate_id, reviewer_label, action, reason, reviewed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [candidateId, reviewerLabel, action, reason ?? null, DateTime.now().setZone(JST_ZONE).toISO()],
    );
  }
}
