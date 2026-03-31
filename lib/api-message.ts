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

const RATE_LIMIT_RE = /block|rate.?limit|15.?min/i;
const QUOTA_RE = /exceeded|hits.?today|hits.?limit|quota|credits/i;
const NETWORK_RE = /network|fetch|failed to fetch|econnrefused|timeout/i;

export function classifyApiMsg(raw: string, context?: string): ApiMsg {
  const r = raw ?? "";

  if (RATE_LIMIT_RE.test(r)) {
    const mins = (r.match(/(\d+)\s*min/i) || [])[1] ?? "15";
    return {
      type: "warning",
      title: "API rate-limited — wait ~" + mins + " min",
      detail: "CricAPI applies a per-key rate limit. All keys are in the temporary cooldown window. Try again in " + mins + " minutes.",
      action: "Check key status",
      actionHref: "/api/key-stats",
    };
  }

  if (QUOTA_RE.test(r)) {
    return {
      type: "error",
      title: "Daily API quota exhausted",
      detail: "All 7 keys have reached their 100-hit daily limit. Quota resets at midnight (CricAPI time). Try again tomorrow or add more API keys in Settings.",
      action: "Key usage stats",
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

  if (!r || r.toLowerCase().includes("ok") || r.toLowerCase().includes("success") || r.toLowerCase().includes("loaded") || r.toLowerCase().includes("linked") || r.toLowerCase().includes("saved") || r.toLowerCase().includes("updated") || r.toLowerCase().includes("refreshing")) {
    return { type: "success", title: r || "Done" };
  }

  if (r.toLowerCase().includes("no ipl") || r.toLowerCase().includes("none are ipl") || r.toLowerCase().includes("matches in feed")) {
    return {
      type: "info",
      title: r,
      detail: "No IPL fixture is in the feed for today ± 1 day. The feed updates closer to match time.",
    };
  }

  if (r.toLowerCase().includes("loading") || r.toLowerCase().includes("syncing") || r.toLowerCase().includes("fetching") || r.toLowerCase().includes("linking")) {
    return { type: "loading", title: r };
  }

  // Default: treat as a plain error
  return {
    type: "error",
    title: context ? `${context} failed` : "Something went wrong",
    detail: r,
  };
}
