/**
 * User-facing dates/times use US Eastern (EST/EDT via America/New_York).
 * IPL scheduling logic elsewhere may still use Asia/Kolkata — only UI labels use this.
 */
export const UI_TIMEZONE = "America/New_York";

/** YYYY-MM-DD in Eastern for “today” boundaries (e.g. client quota date). */
export function formatUiCalendarDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: UI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Readable date+time for sync stamps, etc. */
export function formatUiDateTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    timeZone: UI_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Long form for API error / retry hints. */
export function formatUiDateTimeLong(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: UI_TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/** Short relative label for “last synced” (wall clock skew safe for typical use). */
export function formatRelativeTimeAgo(iso: string | Date, nowMs: number = Date.now()): string {
  const t = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  if (!Number.isFinite(t)) return "unknown";
  const sec = Math.round((nowMs - t) / 1000);
  if (sec < 0) return "just now";
  if (sec < 15) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
