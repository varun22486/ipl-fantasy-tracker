import { z } from "zod";

/** POST /api/seed */
export const seedPostSchema = z.object({
  externalMatchId: z
    .string()
    .max(256, "Fixture id too long")
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, "Missing externalMatchId"),
});

function normalizeRefreshBody(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = { ...(raw as Record<string, unknown>) };
  if (o.matchId === null || o.matchId === "") delete o.matchId;
  return o;
}

/** POST /api/refresh — optional matchId; tolerate numeric strings from older clients */
export const refreshPostSchema = z.preprocess(
  normalizeRefreshBody,
  z
    .object({
      matchId: z
        .union([
          z.number().int().positive(),
          z.string().regex(/^\d+$/).transform((s) => parseInt(s, 10)),
        ])
        .optional(),
      /** When true, skip the 15‑minute cooldown (user confirmed in the UI). */
      force: z.boolean().optional(),
      /** When true, after CricAPI yields no scorecard rows, try the optional Cricbuzz HTML fallback. */
      cricbuzzFallback: z.boolean().optional(),
    })
    .passthrough()
);
