/**
 * Client-safe constants for match snapshots (no server / Supabase imports).
 */

export const MATCH_SNAPSHOT_MAX_PER_MATCH = 40;

/** At most one auto snapshot per match this often during rapid manual edits. */
export const MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS = 90_000;

export type MatchSnapshotSource =
  | "pre_void"
  | "pre_unvoid"
  | "pre_sync"
  | "pre_lineup"
  | "pre_lineup_lateness"
  | "pre_manual_score"
  | "pre_restore"
  | "user_checkpoint";

export const SNAPSHOT_SOURCE_LABEL: Record<MatchSnapshotSource, string> = {
  pre_void: "Before void",
  pre_unvoid: "Before remove void",
  pre_sync: "Before sync",
  pre_lineup: "Before lineup save",
  pre_lineup_lateness: "Before late-select on-time bonus change",
  pre_manual_score: "Before manual edit",
  pre_restore: "Before restore",
  user_checkpoint: "Saved checkpoint",
};
