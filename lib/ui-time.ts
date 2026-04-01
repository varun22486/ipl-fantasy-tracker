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
