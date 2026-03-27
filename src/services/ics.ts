import type { PublishedEvent } from "../types.js";
import { toDateOnly, toUtcIcs, toUtcStamp } from "../lib/time.js";

export const feedDefinitions = {
  all: {
    name: "日本主要セールカレンダー",
    description: "無印良品・楽天・Amazon の主要セールを根拠付きで配信する公開購読カレンダー",
    color: "teal",
  },
  lite: {
    name: "日本主要セールカレンダー Lite",
    description: "大型イベントだけを厳選した公開購読カレンダー",
    color: "tomato",
  },
  muji: {
    name: "無印良品セールカレンダー",
    description: "無印良品の主要セールを公開配信する購読カレンダー",
    color: "seagreen",
  },
  amazon: {
    name: "Amazonセールカレンダー",
    description: "Amazon の主要セールを公開配信する購読カレンダー",
    color: "royalblue",
  },
  rakuten: {
    name: "楽天セールカレンダー",
    description: "楽天の主要セールを公開配信する購読カレンダー",
    color: "crimson",
  },
} as const;

type FeedKey = keyof typeof feedDefinitions;

export function generateIcs(feedKey: FeedKey, events: PublishedEvent[], baseUrl: string): string {
  const feed = feedDefinitions[feedKey];
  const source = `${baseUrl}/cal/${feedKey}.ics`;
  const lastModified = events.reduce((latest, event) => {
    return event.lastModifiedUtc > latest ? event.lastModifiedUtc : latest;
  }, toUtcStamp());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "PRODID:-//calendar-notifier//JP Sales Calendar//JA",
    "VERSION:2.0",
    `NAME:${escapeIcsText(feed.name)}`,
    `DESCRIPTION:${escapeIcsText(feed.description)}`,
    `UID:feed-${feedKey}@calendar-notifier.local`,
    `LAST-MODIFIED:${lastModified}`,
    `SOURCE:${source}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    `COLOR:${feed.color}`,
    ...events.flatMap((event) => serializeEvent(event, baseUrl)),
    "END:VCALENDAR",
  ];

  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}

function serializeEvent(event: PublishedEvent, baseUrl: string): string[] {
  const eventUrl = `${baseUrl}/events/${event.eventSlug}`;
  const description = `${event.summary}\n出典: ${event.sourceUrl}\n詳細: ${eventUrl}`;
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.icsUid}`,
    `DTSTAMP:${event.lastModifiedUtc}`,
    event.allDay ? `DTSTART;VALUE=DATE:${toDateOnly(event.startsAtJst)}` : `DTSTART:${toUtcIcs(event.startsAtJst)}`,
    event.allDay ? `DTEND;VALUE=DATE:${toDateOnly(event.endsAtJst)}` : `DTEND:${toUtcIcs(event.endsAtJst)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${eventUrl}`,
    `LAST-MODIFIED:${event.lastModifiedUtc}`,
    `SEQUENCE:${event.sequence}`,
    `STATUS:${event.icalStatus}`,
    "END:VEVENT",
  ];
  return lines;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}

function foldLine(line: string): string[] {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) {
    return [line];
  }

  const folded: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + 75, bytes.length);
    while (end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) {
      end -= 1;
    }
    const chunk = bytes.subarray(start, end).toString("utf8");
    folded.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
  }
  return folded;
}
