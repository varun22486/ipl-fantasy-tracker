"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

type Competition = {
  id: number;
  name: string;
  player1_name: string;
  player2_name: string;
  players?: string[];
};

function compLabel(c: Competition): string {
  const players: string[] = Array.isArray(c.players) ? c.players : [c.player1_name, c.player2_name];
  if (players.length > 2) return `${players[0]} +${players.length - 1}`;
  return `${players[0]} vs ${players[1]}`;
}

export default function ManageCompetitionsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeC = searchParams?.get("c");
  const parsed = activeC != null && activeC !== "" ? Number(activeC) : NaN;
  const activeId = Number.isFinite(parsed) && parsed >= 1 ? parsed : null;

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetch("/api/competitions")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setCompetitions(j.competitions ?? []);
        else setLoadError(j.error ?? "Could not load competitions.");
      })
      .catch(() => setLoadError("Network error."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!pending) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) setPending(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, deleting]);

  async function confirmDelete() {
    if (!pending) return;
    const idToDelete = pending.id;
    setDeleting(true);
    setDeleteError(null);
    try {
      const r = await fetch("/api/competitions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: idToDelete }),
      });
      const j = await r.json();
      if (!j.ok) {
        setDeleteError(j.error ?? "Delete failed.");
        return;
      }
      setCompetitions((prev) => prev.filter((c) => c.id !== idToDelete));
      setPending(null);
      if (activeId === idToDelete) {
        if (typeof document !== "undefined") {
          document.cookie = "active_comp=; path=/; max-age=0";
        }
        router.push("/");
        router.refresh();
      }
    } catch {
      setDeleteError("Network error.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div style={{ display: "grid", gap: 14 }}>
        {loading && <p style={{ color: "#64748b", margin: 0 }}>Loading…</p>}
        {loadError && (
          <p style={{ color: "#b91c1c", margin: 0 }}>
            {loadError}{" "}
            <button type="button" onClick={() => refresh()} style={retryBtn}>
              Retry
            </button>
          </p>
        )}
        {!loading && !loadError && competitions.length === 0 && (
          <p style={{ color: "#64748b", margin: 0 }}>
            No custom leagues yet. Create one from the sidebar under <strong>Competitions</strong>, or use the default Varun vs Rahul league.
          </p>
        )}
        {!loading &&
          competitions.map((c) => {
            const label = compLabel(c);
            const isActive = activeId === c.id;
            return (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                  padding: "16px 18px",
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a" }}>{label}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                    {Array.isArray(c.players) ? `${c.players.length} participants` : "2 participants"}
                    {isActive && (
                      <span style={{ marginLeft: 10, color: "#2563eb", fontWeight: 600 }}>Currently selected</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null);
                    setPending({ id: c.id, label });
                  }}
                  style={deleteOutlineBtn}
                >
                  Delete league
                </button>
              </div>
            );
          })}
      </div>

      <p style={{ marginTop: 24, fontSize: 14, color: "#64748b" }}>
        The <strong>default</strong> league (Varun vs Rahul from Settings) cannot be deleted here — it is not stored as a competition row.{" "}
        <Link href="/settings" style={{ color: "#2563eb", fontWeight: 600, textDecoration: "none" }}>
          Settings →
        </Link>
      </p>

      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-comp-title"
          style={overlayStyle}
          onClick={() => !deleting && setPending(null)}
        >
          <div
            style={modalStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-comp-title" style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              Delete this league?
            </h2>
            <p style={{ margin: "0 0 8px", fontSize: 15, color: "#334155", lineHeight: 1.5 }}>
              You are about to remove <strong>{pending.label}</strong>.
            </p>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#64748b", lineHeight: 1.5 }}>
              All fantasy picks and scores stored for this league will be permanently deleted. This cannot be undone.
            </p>
            {deleteError && (
              <p style={{ margin: "0 0 16px", fontSize: 14, color: "#b91c1c", fontWeight: 600 }}>{deleteError}</p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPending(null)}
                style={{ ...cancelModalBtn, opacity: deleting ? 0.5 : 1, cursor: deleting ? "not-allowed" : "pointer" }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                style={{ ...confirmDeleteBtn, opacity: deleting ? 0.85 : 1, cursor: deleting ? "wait" : "pointer" }}
              >
                {deleting ? "Deleting…" : "Yes, delete league"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const retryBtn: CSSProperties = {
  border: "none",
  background: "none",
  color: "#2563eb",
  cursor: "pointer",
  fontWeight: 600,
  textDecoration: "underline",
};
const deleteOutlineBtn: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 10,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#b91c1c",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 300,
  background: "rgba(15,23,42,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};
const modalStyle: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "white",
  borderRadius: 20,
  padding: 24,
  boxShadow: "0 25px 50px rgba(0,0,0,0.2)",
  border: "1px solid #e2e8f0",
};
const cancelModalBtn: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "white",
  color: "#475569",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const confirmDeleteBtn: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "#b91c1c",
  color: "white",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
