"use client";

import type { ApiMsg } from "@/lib/api-message";

const PALETTE: Record<string, { bg: string; border: string; titleColor: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#86efac", titleColor: "#15803d", icon: "✓" },
  error:   { bg: "#fff1f2", border: "#fca5a5", titleColor: "#be123c", icon: "✕" },
  warning: { bg: "#fffbeb", border: "#fcd34d", titleColor: "#92400e", icon: "⚠" },
  info:    { bg: "#eff6ff", border: "#93c5fd", titleColor: "#1d4ed8", icon: "ℹ" },
  loading: { bg: "#f8fafc", border: "#cbd5e1", titleColor: "#475569", icon: "…" },
};

export default function ApiMessage({
  msg,
  onDismiss,
}: {
  msg: ApiMsg;
  onDismiss?: () => void;
}) {
  const p = PALETTE[msg.type] ?? PALETTE.info;
  return (
    <div
      role={msg.type === "error" || msg.type === "warning" ? "alert" : "status"}
      style={{
        display: "flex",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 12,
        border: `1px solid ${p.border}`,
        background: p.bg,
        alignItems: "flex-start",
      }}
    >
      {/* Icon */}
      <span
        style={{
          fontSize: 14,
          fontWeight: 800,
          color: p.titleColor,
          marginTop: 1,
          flexShrink: 0,
          width: 20,
          textAlign: "center",
        }}
      >
        {p.icon}
      </span>

      {/* Body */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: p.titleColor }}>{msg.title}</div>
        {msg.detail && (
          <div style={{ fontSize: 13, color: "#475569", marginTop: 4, lineHeight: 1.5 }}>
            {msg.detail}
          </div>
        )}
        {msg.action && (
          <div style={{ marginTop: 8 }}>
            {msg.actionHref ? (
              <a
                href={msg.actionHref}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: p.titleColor,
                  textDecoration: "underline",
                }}
              >
                {msg.action} →
              </a>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 600, color: p.titleColor }}>{msg.action}</span>
            )}
          </div>
        )}
      </div>

      {/* Dismiss */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            borderRadius: 999,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 14,
            color: "#94a3b8",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
