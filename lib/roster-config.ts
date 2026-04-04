/** Playing XI + super subs: first 4 slots count for fantasy; up to 3 extra picks (swap anytime). */

export const ROSTER_STARTING_COUNT = 4;
export const ROSTER_BENCH_SLOTS = 3;
export const ROSTER_MAX_PLAYERS = ROSTER_STARTING_COUNT + ROSTER_BENCH_SLOTS;

export type RosterSlotPlayer = { name: string; captain: boolean; providerId?: string };

export function emptyRosterSlots(): RosterSlotPlayer[] {
  return Array.from({ length: ROSTER_MAX_PLAYERS }, () => ({ name: "", captain: false }));
}

type SavedRow = {
  name: string;
  captain: boolean;
  bench?: boolean | null;
  provider_player_id?: string | null;
};

/** Restore 7 UI slots from DB rows (order: starters then bench). */
export function rosterSlotsFromSaved(rows: SavedRow[]): RosterSlotPlayer[] {
  const slots = emptyRosterSlots();
  if (!rows.length) return slots;
  const starters = rows.filter((r) => !r.bench);
  const bench = rows.filter((r) => r.bench);
  starters.slice(0, ROSTER_STARTING_COUNT).forEach((r, i) => {
    slots[i] = {
      name: r.name,
      captain: r.captain,
      providerId: r.provider_player_id?.trim() || undefined,
    };
  });
  bench.slice(0, ROSTER_BENCH_SLOTS).forEach((r, i) => {
    slots[ROSTER_STARTING_COUNT + i] = {
      name: r.name,
      captain: false,
      providerId: r.provider_player_id?.trim() || undefined,
    };
  });
  const head = slots.slice(0, ROSTER_STARTING_COUNT);
  if (!head.some((p) => p.captain && p.name.trim())) {
    const fi = head.findIndex((p) => p.name.trim());
    if (fi >= 0) slots[fi] = { ...slots[fi], captain: true };
  }
  return slots;
}

/** Payload for POST /api/lineup — only named slots; `bench` true for super subs. */
export function slotsToLineupPayload(slots: RosterSlotPlayer[]) {
  return slots
    .map((p, i) => ({
      name: p.name.trim(),
      captain: p.captain,
      bench: i >= ROSTER_STARTING_COUNT,
      providerId: p.providerId,
    }))
    .filter((p) => p.name.length > 0);
}

/** Client-side save validation mirror (server enforces too). */
export function rosterSlotsCanSave(slots: RosterSlotPlayer[]): boolean {
  const head = slots.slice(0, ROSTER_STARTING_COUNT);
  if (!head.every((p) => p.name.trim())) return false;
  if (head.filter((p) => p.captain).length !== 1) return false;
  const named = slots.filter((p) => p.name.trim());
  if (named.length > ROSTER_MAX_PLAYERS) return false;
  const lower = named.map((p) => p.name.trim().toLowerCase());
  if (new Set(lower).size !== lower.length) return false;
  for (let i = ROSTER_STARTING_COUNT; i < ROSTER_MAX_PLAYERS; i++) {
    if (slots[i].captain) return false;
  }
  return true;
}

export function rosterFilledCount(slots: RosterSlotPlayer[]): number {
  return slots.filter((p) => p.name.trim()).length;
}

export function rosterStartersFilled(slots: RosterSlotPlayer[]): number {
  return slots.slice(0, ROSTER_STARTING_COUNT).filter((p) => p.name.trim()).length;
}
