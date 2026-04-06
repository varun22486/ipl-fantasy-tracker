import { NextRequest, NextResponse } from "next/server";
import { restoreMatchSnapshotById } from "@/lib/match-snapshot";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const snapshotId = Number(body?.snapshotId);
    if (!Number.isFinite(snapshotId) || snapshotId < 1) {
      return NextResponse.json({ ok: false, error: "snapshotId required" }, { status: 400 });
    }

    const result = await restoreMatchSnapshotById(snapshotId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "Match restored from snapshot." });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Restore failed" },
      { status: 500 }
    );
  }
}
