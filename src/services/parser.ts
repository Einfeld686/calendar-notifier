import { load } from "cheerio";
import { DateTime } from "luxon";
import type { CandidateDraft, SourceMonitor } from "../types.js";
import { eventTypeLabel } from "../lib/utils.js";
import { JST_ZONE } from "../lib/time.js";

const DATE_TOKEN_REGEX =
  /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*[（(][^）)]{0,12}[）)])?(?:\s*(\d{1,2}):(\d{2}))?/g;

interface DateToken {
  raw: string;
  year: number | null;
  month: number;
  day: number;
  hour: number | null;
  minute: number | null;
  index: number;
}

export interface ParsedMonitorCandidate extends CandidateDraft {
  textExcerpt: string;
  rulePassed: boolean;
  needsReview: boolean;
}

export function extractTextExcerpt(html: string): string {
  const $ = load(html);
  $("script, style, noscript").remove();
  return $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);
}

export function parseHtmlCandidate(
  monitor: SourceMonitor,
  html: string,
  sourceUrl: string,
  fetchedAt: string,
): ParsedMonitorCandidate {
  const textExcerpt = extractTextExcerpt(html);
  const dateTokens = extractDateTokens(textExcerpt, fetchedAt);
  const range = inferDateRange(monitor, dateTokens, fetchedAt);
  const detectedDateStrings = dateTokens.slice(0, 6).map((token) => token.raw);
  const validationFlags = buildValidationFlags(monitor, sourceUrl, range);
  const rulePassed = validationFlags.every((flag) => !flag.startsWith("error:"));
  const needsReview = monitor.requiresManualReview || !rulePassed;
  const title = eventTypeLabel(monitor.eventType);
  const summary = buildEvidenceSummary(title, range, sourceUrl, needsReview);

  return {
    title,
    startsAtJst: range?.start ?? null,
    endsAtJst: range?.end ?? null,
    allDay: range?.allDay ?? true,
    summary,
    sourceUrl,
    detectedDateStrings,
    validationFlags,
    llmOutput: {
      formatter: "heuristic-v1",
      title,
      chosenRange: range,
      detectedDateStrings,
    },
    textExcerpt,
    rulePassed,
    needsReview,
  };
}

export interface InferredRange {
  start: string;
  end: string;
  allDay: boolean;
  timedPair: boolean;
}

function extractDateTokens(text: string, fetchedAt: string): DateToken[] {
  const tokens: DateToken[] = [];
  const fallbackYear = DateTime.fromISO(fetchedAt, { zone: JST_ZONE }).year;
  let carryYear: number | null = null;

  for (const match of text.matchAll(DATE_TOKEN_REGEX)) {
    const explicitYear = match[1] ? Number(match[1]) : null;
    const token: DateToken = {
      raw: match[0].trim(),
      year: explicitYear,
      month: Number(match[2]),
      day: Number(match[3]),
      hour: match[4] ? Number(match[4]) : null,
      minute: match[5] ? Number(match[5]) : null,
      index: match.index ?? 0,
    };
    if (explicitYear) {
      carryYear = explicitYear;
    } else if (carryYear) {
      token.year = carryYear;
    } else {
      token.year = fallbackYear;
    }
    tokens.push(token);
  }

  return tokens;
}

function inferDateRange(monitor: SourceMonitor, tokens: DateToken[], fetchedAt: string): InferredRange | null {
  if (tokens.length < 2) {
    return null;
  }

  let bestRange: InferredRange | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const limitedTokens = tokens.slice(0, 12);

  for (let startIndex = 0; startIndex < limitedTokens.length - 1; startIndex += 1) {
    for (let endIndex = startIndex + 1; endIndex < limitedTokens.length; endIndex += 1) {
      const range = inferDateRangePair(limitedTokens[startIndex], limitedTokens[endIndex], fetchedAt);
      if (!range) {
        continue;
      }
      const score = scoreRangeCandidate(monitor, range, limitedTokens[startIndex], limitedTokens[endIndex]);
      if (score > bestScore) {
        bestRange = range;
        bestScore = score;
      }
    }
  }

  return bestRange ?? inferDateRangePair(tokens[0], tokens[1], fetchedAt);
}

function inferDateRangePair(startTokenInput: DateToken, endTokenInput: DateToken, fetchedAt: string): InferredRange | null {
  const startToken = { ...startTokenInput };
  const endToken = { ...endTokenInput };
  const fallbackYear = DateTime.fromISO(fetchedAt, { zone: JST_ZONE }).year;

  if (!startToken.year) {
    startToken.year = fallbackYear;
  }
  if (!endToken.year) {
    endToken.year = startToken.year ?? fallbackYear;
  }
  if (
    endToken.year === startToken.year &&
    (endToken.month < startToken.month || (endToken.month === startToken.month && endToken.day < startToken.day))
  ) {
    endToken.year += 1;
  }

  const allDay = startToken.hour === null && endToken.hour === null;
  const timedPair = startToken.hour !== null && endToken.hour !== null;

  if (!allDay && !timedPair) {
    return {
      start: buildDateTime(startToken, false),
      end: buildDateTime(endToken, false),
      allDay: false,
      timedPair: false,
    };
  }

  if (allDay) {
    const start = DateTime.fromObject(
      { year: startToken.year!, month: startToken.month, day: startToken.day, hour: 0, minute: 0 },
      { zone: JST_ZONE },
    );
    const endInclusive = DateTime.fromObject(
      { year: endToken.year!, month: endToken.month, day: endToken.day, hour: 0, minute: 0 },
      { zone: JST_ZONE },
    );

    return {
      start: start.toISO()!,
      end: endInclusive.plus({ days: 1 }).toISO()!,
      allDay: true,
      timedPair: false,
    };
  }

  return {
    start: buildDateTime(startToken, false),
    end: buildDateTime(endToken, false),
    allDay: false,
    timedPair: true,
  };
}

function scoreRangeCandidate(
  monitor: SourceMonitor,
  range: InferredRange,
  startToken: DateToken,
  endToken: DateToken,
): number {
  const start = DateTime.fromISO(range.start, { zone: JST_ZONE });
  const end = DateTime.fromISO(range.end, { zone: JST_ZONE });
  if (end <= start) {
    return Number.NEGATIVE_INFINITY;
  }

  const durationDays = end.diff(start, "days").days;
  const durationHours = end.diff(start, "hours").hours;
  const tokenDistancePenalty = (endToken.index - startToken.index) / 1000;
  let score = startToken.hour !== null && endToken.hour !== null ? 30 : 10;

  switch (monitor.eventType) {
    case "muji_ryohin_week":
      score += durationDays >= 2 && durationDays <= 20 ? 120 - Math.abs(durationDays - 10) : -200;
      break;
    case "rakuten_marathon":
      score += durationHours >= 24 && durationHours <= 240 ? 140 - Math.abs(durationHours - 120) / 4 : -220;
      break;
    case "rakuten_super_sale":
      score += durationDays >= 2 && durationDays <= 14 ? 120 - Math.abs(durationDays - 7) : -200;
      break;
    default:
      score += durationDays >= 0 && durationDays <= 14 ? 80 - durationDays : -120;
      break;
  }

  return score - tokenDistancePenalty;
}

function buildDateTime(token: DateToken, isEndExclusive: boolean): string {
  return DateTime.fromObject(
    {
      year: token.year!,
      month: token.month,
      day: token.day,
      hour: token.hour ?? 0,
      minute: token.minute ?? 0,
    },
    { zone: JST_ZONE },
  )
    .plus(isEndExclusive ? { minutes: 0 } : {})
    .toISO()!;
}

function buildValidationFlags(
  monitor: SourceMonitor,
  sourceUrl: string,
  range: InferredRange | null,
): string[] {
  const flags: string[] = [];
  const hostname = new URL(sourceUrl).hostname;
  if (monitor.allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    flags.push("ok:allowed-domain");
  } else {
    flags.push("error:disallowed-domain");
  }

  if (!range) {
    flags.push("error:missing-date-range");
    return flags;
  }

  flags.push("ok:has-start");
  flags.push("ok:has-end");

  const start = DateTime.fromISO(range.start, { zone: JST_ZONE });
  const end = DateTime.fromISO(range.end, { zone: JST_ZONE });
  if (end <= start) {
    flags.push("error:non-positive-duration");
    return flags;
  }

  if (!range.allDay && !range.timedPair) {
    flags.push("error:partial-time-range");
  } else if (!range.allDay) {
    flags.push("ok:timed-range");
  } else {
    flags.push("ok:all-day");
  }

  const durationDays = end.diff(start, "days").days;
  const durationHours = end.diff(start, "hours").hours;
  switch (monitor.eventType) {
    case "muji_ryohin_week":
      if (durationDays >= 2 && durationDays <= 20) {
        flags.push("ok:muji-window");
      } else {
        flags.push("error:muji-window");
      }
      break;
    case "rakuten_marathon":
      if (durationHours >= 24 && durationHours <= 240) {
        flags.push("ok:rakuten-marathon-window");
      } else {
        flags.push("error:rakuten-marathon-window");
      }
      break;
    case "rakuten_super_sale":
      if (durationDays >= 2 && durationDays <= 14) {
        flags.push("ok:super-sale-window");
      } else {
        flags.push("error:super-sale-window");
      }
      break;
    default:
      if (durationDays >= 0 && durationDays <= 14) {
        flags.push("ok:event-window");
      } else {
        flags.push("error:event-window");
      }
      break;
  }

  return flags;
}

function buildEvidenceSummary(title: string, range: InferredRange | null, sourceUrl: string, needsReview: boolean): string {
  if (!range) {
    return `${title} の開催情報を公式ページで観測しましたが、期間の自動確定に必要な日付範囲が不足しているため確認待ちです。出典: ${sourceUrl}`;
  }

  const start = DateTime.fromISO(range.start, { zone: JST_ZONE });
  const end = DateTime.fromISO(range.end, { zone: JST_ZONE });
  if (range.allDay) {
    const inclusiveEnd = end.minus({ days: 1 });
    return `${title} の開催期間を公式ページから確認しました。${start.toFormat("yyyy年M月d日")} から ${inclusiveEnd.toFormat("yyyy年M月d日")} までです。${
      needsReview ? "公開前の最終確認待ちです。" : "公開条件を満たしています。"
    } 出典: ${sourceUrl}`;
  }

  return `${title} の開催期間を公式ページから確認しました。${start.toFormat("yyyy年M月d日 HH:mm")} から ${end.toFormat(
    "yyyy年M月d日 HH:mm",
  )} JST までです。${needsReview ? "公開前の最終確認待ちです。" : "公開条件を満たしています。"} 出典: ${sourceUrl}`;
}
