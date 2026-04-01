/**
 * Classify any API error text into a structured message the UI can render richly.
 */
export type MsgType = "success" | "error" | "warning" | "info" | "loading";

export type ApiMsg = {
  type: MsgType;
  title: string;
  detail?: string;
  action?: string; // CTA label
  actionHref?: string; // if set, action is a link
};

// Check quota BEFORE rate-limit — "blocked" appears in both our tags and quota messages
const QUOTA_RE = /\[QUOTA_EXHAUSTED\]|quota.?(exhausted|today|limit)|all.?keys.*(quota|exhausted)|daily.?quota|hits.?today|hits.?limit|exceeded.*limit/i;
const RATE_LIMIT_RE = /\[RATE_LIMITED\]|blocked? for 15|rate.?limit|15.?min/i;
const NETWORK_RE   = /network|fetch|failed to fetch|econnrefused|timeout/i;
const SUCCESS_RE   = /\b(ok|success|saved|linked|loaded|updated\s+\d|roster loaded|match linked|scores updated|refreshing|team saved)\b/i;
const INFO_RE      = /\b(cached|try again in|no ipl|none are ipl|matches in feed|scorecard not available|stats unchanged|fixture|fixtures found)\b/i;
const WARNING_RE   = /\b(didn.t match|unmatched|no player|no data|not available|check spelling|check debug)\b/i;
const LOADING_RE   = /\b(loading|syncing|fetching|linking|working)\b/i;

export function classifyApiMsg(raw: string, context?: string): ApiMsg {
  const r = (raw ?? "").trim();
  const rl = r.toLowerCase();

  if (!r) return { type: "success", title: "Done" };

  // Strip internal tags before showing to user
  const display = r.replace(/\[(QUOTA_EXHAUSTED|RATE_LIMITED)\]\s*/gi, "").trim();
  void display; // used in fallback below

  // Quota exhaustion checked first — must be before rate-limit check because
  // "blocked" appears in quota messages too
  if (QUOTA_RE.test(r)) {
    return {
      type: "error",
      title: "Daily API quota exhausted",
      detail: "All configured API keys have reached the 100-hit daily limit. Quota resets at the start of the next UTC day (times in the app are shown in Eastern Time). Try again tomorrow or add more keys in your .env.",
      action: "View key usage",
      actionHref: "/api/key-stats",
    };
  }

  if (RATE_LIMIT_RE.test(r)) {
    const mins = (r.match(/~?(\d+)\s*min/i) || [])[1] ?? "15";
    return {
      type: "warning",
      title: `All keys rate-limited — wait ~${mins} min`,
      detail: `CricAPI temporarily blocks a key after too many requests in a short burst. All keys are in the cooldown window. Try again in ${mins} minutes — no action needed on your side.`,
      action: "View key status",
      actionHref: "/api/key-stats",
    };
  }

  if (NETWORK_RE.test(r)) {
    return {
      type: "error",
      title: "Network error",
      detail: "Could not reach the server. Check your internet connection and try again.",
    };
  }

  if (SUCCESS_RE.test(r)) {
    return { type: "success", title: r };
  }

  if (LOADING_RE.test(r)) {
    return { type: "loading", title: r };
  }

  if (INFO_RE.test(r)) {
    return { type: "info", title: display || r };
  }

  if (WARNING_RE.test(r)) {
    return { type: "warning", title: display || r };
  }

  // Fallback — strip tags from user-visible text
  return {
    type: "error",
    title: context ? `${context} failed` : (display || r),
    detail: context ? (display || r) : undefined,
  };
}
