"use client";

import type { ApiMsg } from "@/lib/api-message";

const ICONS: Record<string, string> = {
  success: "✓",
  error: "✕",
  warning: "⚠",
  info: "ℹ",
  loading: "…",
};

export default function ApiMessage({
  msg,
  onDismiss,
}: {
  msg: ApiMsg;
  onDismiss?: () => void;
}) {
  const type = msg.type;
  const icon = ICONS[type] ?? ICONS.info;
  return (
    <div
      className={`api-msg api-msg--${type}`}
      role={type === "error" || type === "warning" ? "alert" : "status"}
    >
      <span className="api-msg__icon" aria-hidden>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="api-msg__title">{msg.title}</div>
        {msg.detail && <div className="api-msg__detail">{msg.detail}</div>}
        {msg.action && (
          <div className="api-msg__action">
            {msg.actionHref ? (
              <a href={msg.actionHref} target="_blank" rel="noopener noreferrer">
                {msg.action} →
              </a>
            ) : (
              <span>{msg.action}</span>
            )}
          </div>
        )}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="api-msg__dismiss" aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
