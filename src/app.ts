import cookieParser from "cookie-parser";
import express from "express";
import type { AppConfig } from "./config.js";
import type { CalendarRepository } from "./lib/repository.js";
import type { ObjectStorage } from "./lib/storage.js";
import { generateIcs } from "./services/ics.js";
import { runCrawlCycle } from "./services/crawler.js";
import {
  renderAdminEvents,
  renderAdminReviewDetail,
  renderAdminReviewList,
  renderCss,
  renderEventDetail,
  renderGuide,
  renderHome,
  renderLayout,
} from "./ui.js";

export function createApp(config: AppConfig, repository: CalendarRepository, storage: ObjectStorage) {
  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));

  app.get("/assets/app.css", (_req, res) => {
    res.type("text/css").send(renderCss());
  });

  app.get("/healthz", async (_req, res, next) => {
    try {
      await repository.healthCheck();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/", async (_req, res, next) => {
    try {
      res.send(renderHome(await repository.listUpcomingEvents(), config.baseUrl));
    } catch (error) {
      next(error);
    }
  });

  app.get("/guide", (_req, res) => {
    res.send(renderGuide(config.baseUrl));
  });

  app.get("/events/:slug", async (req, res, next) => {
    try {
      const event = await repository.getPublishedEventBySlug(req.params.slug);
      if (!event) {
        res.status(404).send(renderLayout("Not Found", `<section class="panel"><h1>イベントが見つかりません</h1></section>`));
        return;
      }
      res.send(renderEventDetail(event));
    } catch (error) {
      next(error);
    }
  });

  app.get("/cal/:feedKey.ics", async (req, res, next) => {
    try {
      const feedKey = req.params.feedKey;
      if (!["all", "lite", "muji", "amazon", "rakuten"].includes(feedKey)) {
        res.status(404).send("feed not found");
        return;
      }

      const body = generateIcs(
        feedKey as "all" | "lite" | "muji" | "amazon" | "rakuten",
        await repository.listFeedEvents(feedKey as never),
        config.baseUrl,
      );
      res.type("text/calendar; charset=utf-8");
      res.send(body);
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/run-crawl", basicAuth(config), async (_req, res, next) => {
    try {
      await runCrawlCycle(repository, storage);
      res.redirect("/admin/review");
    } catch (error) {
      next(error);
    }
  });

  app.use("/admin", basicAuth(config));

  app.get("/admin/review", async (_req, res, next) => {
    try {
      res.send(renderAdminReviewList(await repository.listPendingCandidates()));
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/review/:candidateId", async (req, res, next) => {
    try {
      const candidateId = Number(req.params.candidateId);
      const candidate = await repository.getCandidateById(candidateId);
      if (!candidate) {
        res.status(404).send(renderLayout("Not Found", `<section class="panel"><h1>候補が見つかりません</h1></section>`));
        return;
      }
      const observation = candidate.observationId ? await repository.getObservationById(candidate.observationId) : null;
      const observationText = observation?.textExcerpt ?? (observation?.htmlBlobPath ? await storage.readText(observation.htmlBlobPath) : null);
      const hasPublishedMatch = Boolean(
        candidate.canonicalEventKey && (await repository.getPublishedEventByCanonicalKey(candidate.canonicalEventKey)),
      );
      res.send(
        renderAdminReviewDetail({
          candidate,
          observationText,
          reviewHistory: await repository.listReviewActions(candidate.id),
          hasPublishedMatch,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/review/:candidateId/action", async (req, res, next) => {
    try {
      const candidateId = Number(req.params.candidateId);
      const action = String(req.body.action);
      const reason = typeof req.body.reason === "string" ? req.body.reason : undefined;

      if (action === "reject") {
        await repository.rejectCandidate(candidateId, config.reviewerLabel, reason);
      } else if (action === "approve" || action === "publish_update") {
        await repository.publishCandidate(candidateId, config.reviewerLabel, action);
      } else {
        res.status(400).send("invalid action");
        return;
      }
      res.redirect("/admin/review");
    } catch (error) {
      next(error);
    }
  });

  app.get("/admin/events", async (_req, res, next) => {
    try {
      res.send(renderAdminEvents(await repository.listPublishedEvents()));
    } catch (error) {
      next(error);
    }
  });

  app.post("/admin/events/:eventSlug/cancel", async (req, res, next) => {
    try {
      await repository.cancelPublishedEvent(req.params.eventSlug, config.reviewerLabel, String(req.body.reason ?? ""));
      res.redirect("/admin/events");
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "unexpected error";
    res.status(500).send(renderLayout("Error", `<section class="panel"><h1>内部エラー</h1><p>${message}</p></section>`));
  });

  return app;
}

function basicAuth(config: AppConfig): express.RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
      res.status(401).send("authentication required");
      return;
    }
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const [user, password] = decoded.split(":");
    if (user !== config.adminUser || password !== config.adminPassword) {
      res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
      res.status(401).send("invalid credentials");
      return;
    }
    next();
  };
}
