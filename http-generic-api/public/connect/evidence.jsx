/* global React */
const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

// ============================================================================
// EVIDENCE DRAWER (right slide-over) — dark devtools style
// ============================================================================
function EvidenceDrawer({ open, onClose, log, style = "dark" }) {
  const ref = useRefD(null);
  useEffectD(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [log, open]);

  const dark = style === "dark";
  const palette = dark ? {
    bg: "#0c0d10", panel: "#15171c", line: "#23262d", ink: "#e4e6eb", muted: "#7d828c",
    method: { GET: "#7ec3ff", POST: "#84e4a8", PUT: "#ffd166", DELETE: "#ff8a80" },
    key: "#9cd5ff", string: "#a8e6a3", num: "#ffd17a", bool: "#ffb37a", tag: "#7d828c",
  } : {
    bg: "var(--panel)", panel: "var(--fill-2)", line: "var(--line)", ink: "var(--ink)", muted: "var(--muted)",
    method: { GET: "#0058b8", POST: "#0b7a5a", PUT: "#b87100", DELETE: "#c1352d" },
    key: "#0058b8", string: "#0b7a5a", num: "#b87100", bool: "#7a3aa3", tag: "var(--muted)",
  };

  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 40,
        background: "rgba(20,24,35,0.18)", backdropFilter: "blur(2px)",
        opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
        transition: "opacity 200ms ease",
      }}/>
      <aside style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480, zIndex: 50,
        background: palette.bg, color: palette.ink,
        borderLeft: `1px solid ${palette.line}`,
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 280ms cubic-bezier(0.32, 0.72, 0, 1)",
        display: "flex", flexDirection: "column",
        boxShadow: "var(--shadow-3)",
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "14px 18px", borderBottom: `1px solid ${palette.line}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "inline-flex", gap: 4 }}>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }}/>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e", display: "inline-block" }}/>
              <i style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840", display: "inline-block" }}/>
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: palette.muted, letterSpacing: "0.04em" }}>
              evidence ── /connect/console
            </span>
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: palette.muted,
            fontSize: 18, cursor: "pointer", padding: 4,
          }}>×</button>
        </div>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${palette.line}`, display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: palette.muted }}>{log.length} requests · live</span>
          <span style={{ flex: 1 }}/>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: palette.muted }}>•&nbsp;no secrets shown</span>
        </div>
        <div ref={ref} style={{
          flex: 1, overflow: "auto", padding: "10px 0",
          fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.55,
        }}>
          {log.length === 0 && (
            <div style={{ color: palette.muted, padding: "20px 18px", textAlign: "center", fontStyle: "italic" }}>
              waiting for traffic…
            </div>
          )}
          {log.map((entry, i) => <LogEntry key={i} entry={entry} palette={palette}/>)}
        </div>
      </aside>
    </>
  );
}

function LogEntry({ entry, palette }) {
  const statusColor = entry.status >= 400 ? "#ff8a80" : entry.status >= 300 ? "#ffd166" : "#84e4a8";
  const dropped = entry.body && Array.isArray(entry.body.dropped_fields) ? entry.body.dropped_fields : null;
  const approvalRequired = entry.body && entry.body.approval_required === true;
  return (
    <div style={{
      padding: "8px 18px", borderBottom: `1px solid ${palette.line}`,
      animation: "fade-up 240ms ease",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ color: palette.method[entry.method] || palette.muted, fontWeight: 700, minWidth: 48 }}>
          {entry.method}
        </span>
        <span style={{ color: palette.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.path}
        </span>
        <span style={{ color: statusColor, fontWeight: 600 }}>{entry.status}</span>
        <span style={{ color: palette.muted }}>{entry.ms}ms</span>
      </div>
      {(dropped && dropped.length > 0) && (
        <div style={{
          marginTop: 4, padding: "6px 8px",
          background: "color-mix(in srgb, #ffd166 14%, transparent)",
          border: `1px solid color-mix(in srgb, #ffd166 30%, ${palette.line})`,
          borderRadius: 4, color: "#ffd166", fontSize: 11.5,
        }}>
          <span style={{ fontWeight: 700, marginRight: 6 }}>⚠ dropped_fields[{dropped.length}]:</span>
          <span style={{ color: palette.ink }}>{dropped.join(", ")}</span>
          <div style={{ color: palette.muted, fontSize: 10.5, marginTop: 2 }}>not on allowlist or matches sensitive-key blocklist · see /connect/api/cms/claims for credentials</div>
        </div>
      )}
      {approvalRequired && (
        <div style={{
          marginTop: 4, padding: "6px 8px",
          background: "color-mix(in srgb, #ff8a80 12%, transparent)",
          border: `1px solid color-mix(in srgb, #ff8a80 30%, ${palette.line})`,
          borderRadius: 4, color: "#ff8a80", fontSize: 11.5,
        }}>
          <span style={{ fontWeight: 700, marginRight: 6 }}>⏸ approval_required</span>
          <span style={{ color: palette.ink }}>claim queued — awaiting platform owner</span>
        </div>
      )}
      {entry.body && <JsonBlock obj={entry.body} palette={palette}/>}
    </div>
  );
}

function JsonBlock({ obj, palette }) {
  const text = JSON.stringify(obj, null, 2);
  // Tokenize JSON for syntax color
  const tokens = text.split(/("(?:[^"\\]|\\.)*"\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*)|(true|false|null)/g);
  return (
    <pre style={{
      margin: "4px 0 0", padding: "8px 10px",
      background: palette.panel, border: `1px solid ${palette.line}`, borderRadius: 4,
      whiteSpace: "pre-wrap", wordBreak: "break-all", color: palette.ink,
    }}>
      {tokens.filter(Boolean).map((t, i) => {
        if (/^"[^"]*"\s*:$/.test(t)) return <span key={i} style={{ color: palette.key }}>{t}</span>;
        if (/^"[^"]*"$/.test(t)) return <span key={i} style={{ color: palette.string }}>{t}</span>;
        if (/^-?\d+\.?\d*$/.test(t)) return <span key={i} style={{ color: palette.num }}>{t}</span>;
        if (/^(true|false|null)$/.test(t)) return <span key={i} style={{ color: palette.bool }}>{t}</span>;
        return <span key={i}>{t}</span>;
      })}
    </pre>
  );
}

Object.assign(window, { EvidenceDrawer, LogEntry, JsonBlock });
