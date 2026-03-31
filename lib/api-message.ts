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
const QUOTA_RE     = /exceeded|hits.?today|hits.?limit|quota|credits/i;
const NETWORK_RE   = /network|fetch|failed to fetch|econnrefused|timeout/i;
const SUCCESS_RE   = /\b(ok|success|saved|linked|loaded|updated\s+\d|roster loaded|match linked|scores updated|refreshing|team saved)\b/i;
const INFO_RE      = /\b(cached|try again in|no ipl|none are ipl|matches in feed|scorecard not available|stats unchanged|fixture|fixtures found)\b/i;
const WARNING_RE   = /\b(didn.t match|unmatched|no player|no data|not available|check spelling|check debug)\b/i;
const LOADING_RE   = /\b(loading|syncing|fetching|linking|working)\b/i;

export function classifyApiMsg(raw: string, context?: string): ApiMsg {
  const r = (raw ?? "").trim();
  const rl = r.toLowerCase();

  if (!r) return { type: "success", title: "Done" };

  if (RATE_LIMIT_RE.test(r)) {
    const mins = (r.match(/(\d+)\s*min/i) || [])[1] ?? "15";
    return {
      type: "warning",
      title: `API rate-limited — wait ~${mins} min`,
      detail: `CricAPI temporarily blocks a key after too many rapid requests. All keys are in cooldown. Try again in ${mins} minutes.`,
      action: "View key status",
      actionHref: "/api/key-stats",
    };
  }

  if (QUOTA_RE.test(r)) {
    return {
      type: "error",
      title: "Daily API quota exhausted",
      detail: "All keys have reached their 100-hit daily limit. Quota resets at midnight (CricAPI time). Try again tomorrow or add more API keys.",
      action: "View key usage",
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
    return { type: "info", title: r };
  }

  if (WARNING_RE.test(r)) {
    return { type: "warning", title: r };
  }

  // Fallback: if we have a context label use it, otherwise show the raw text as a plain error
  return {
    type: "error",
    title: context ? `${context} failed` : r,
    detail: context ? r : undefined,
  };
}
