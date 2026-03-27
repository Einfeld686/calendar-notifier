import { DateTime } from "luxon";

export const JST_ZONE = "Asia/Tokyo";

export function nowJst(): DateTime {
  return DateTime.now().setZone(JST_ZONE);
}

export function toUtcIcs(value: string): string {
  return DateTime.fromISO(value, { zone: JST_ZONE }).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

export function toUtcStamp(value?: DateTime): string {
  return (value ?? DateTime.utc()).toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

export function toDateOnly(value: string): string {
  return DateTime.fromISO(value, { zone: JST_ZONE }).toFormat("yyyyLLdd");
}

export function humanDateRange(startIso: string, endIso: string, allDay: boolean): string {
  const start = DateTime.fromISO(startIso, { zone: JST_ZONE });
  const end = DateTime.fromISO(endIso, { zone: JST_ZONE });
  if (allDay) {
    const inclusiveEnd = end.minus({ days: 1 });
    if (start.hasSame(inclusiveEnd, "day")) {
      return `${start.toFormat("yyyy年M月d日")} 終日`;
    }

    return `${start.toFormat("yyyy年M月d日")} 〜 ${inclusiveEnd.toFormat("yyyy年M月d日")}（終日）`;
  }

  return `${start.toFormat("yyyy年M月d日 HH:mm")} 〜 ${end.toFormat("yyyy年M月d日 HH:mm")} JST`;
}

export function deriveEventStatus(endIso: string, now = nowJst()): "published" | "ended" {
  const end = DateTime.fromISO(endIso, { zone: JST_ZONE });
  return end <= now ? "ended" : "published";
}
