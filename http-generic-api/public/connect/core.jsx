/* global React */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ============================================================================
// State store
// ============================================================================
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "type": "geist",
  "accent": "hot",
  "evidence": "dark",
  "density": "comfortable",
  "spark": true
}/*EDITMODE-END*/;

// Sign-in is a GATE, not a step. Once authenticated the user navigates the 7
// activation steps below; returning to sign-in requires an explicit Sign out
// from the top bar.
const STEPS = [
  { key: "tenant", label: "Workspace", num: "01" },
  { key: "hub", label: "Activation", num: "02" },
  { key: "credentials", label: "Credentials", num: "03" },
  { key: "preferences", label: "Preferences", num: "04" },
  { key: "business", label: "Business profile", num: "05" },
  { key: "device", label: "Local connector", num: "06" },
  { key: "launch", label: "GPT launch", num: "07" },
];

const SAMPLE_MEMBERSHIPS = [
  { tenant_id: "tnt_8f3a91", name: "Northwind Coffee", role: "owner", role_label: "Owner", color: "coral", initial: "N", domain: "northwind.coffee", type: "Company", segment: "Corporate" },
  { tenant_id: "tnt_2c44b7", name: "Riverside Optometry", role: "admin", role_label: "Admin", color: "cyan", initial: "R", domain: "riverside-eye.com", type: "Company", segment: "Agency" },
  { tenant_id: "tnt_aa1102", name: "Forte Studio", role: "member", role_label: "Member", color: "lime", initial: "F", domain: "forte.studio", type: "Individual", segment: "Freelancer" },
  { tenant_id: "tnt_b39f01", name: "Lina Marom", role: "owner", role_label: "Owner", color: "blue", initial: "L", domain: "linamarom.io", type: "Individual", segment: "Affiliater" },
  { tenant_id: "tnt_e21a44", name: "Halcyon Member Club", role: "member", role_label: "Member", color: "coral", initial: "H", domain: "halcyon.club", type: "Individual", segment: "Member" },
];

// ============================================================================
// Icons (custom inline — minimal, geometric)
// ============================================================================
const Icon = {
  cloudflare: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M19.5 14.5c-.4-1.3-1.7-2.3-3.2-2.3-.4 0-.7 0-1 .1-.5-2-2.4-3.4-4.6-3.4-2.7 0-4.9 2-5.1 4.6-1.6.2-2.9 1.5-2.9 3.1 0 1.7 1.4 3.1 3.1 3.1h13c1.5 0 2.7-1.2 2.7-2.7 0-1.4-1-2.5-2-2.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
    </svg>
  ),
  hostinger: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <rect x="3" y="5" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <rect x="3" y="13" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="6.5" cy="8" r="0.9" fill="currentColor"/>
      <circle cx="6.5" cy="16" r="0.9" fill="currentColor"/>
    </svg>
  ),
  device: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <rect x="3" y="4" width="18" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M9 21h6M12 17v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  ),
  gpt: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  check: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M5 12.5l4 4 10-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  arrow: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  shield: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 3l8 3v5c0 4.5-3.2 8.6-8 10-4.8-1.4-8-5.5-8-10V6l8-3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  terminal: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <rect x="3" y="4" width="18" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M7 9l3 3-3 3M12 15h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  copy: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  download: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  refresh: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  eye: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.4"/>
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.4"/>
    </svg>
  ),
  sparkle: (p) => (
    <svg viewBox="0 0 24 24" fill="none" {...p}>
      <path d="M12 3l1.6 5L19 9.5l-5.4 1.5L12 16l-1.6-5L5 9.5l5.4-1.5L12 3z" fill="currentColor"/>
    </svg>
  ),
  google: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4c-.2 1.3-.9 2.3-2 3.1v2.6h3.2c1.9-1.7 3-4.3 3-7.5z"/>
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.6c-.9.6-2 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6C4.7 19.7 8.1 22 12 22z"/>
      <path fill="#FBBC05" d="M6.4 13.9c-.2-.6-.3-1.3-.3-1.9s.1-1.3.3-1.9V7.5H3.1C2.4 8.9 2 10.4 2 12s.4 3.1 1.1 4.5l3.3-2.6z"/>
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 3.1 14.7 2 12 2 8.1 2 4.7 4.3 3.1 7.5l3.3 2.6C7.2 7.7 9.4 6 12 6z"/>
    </svg>
  ),
};

// ============================================================================
// Status indicator — pulsing/breathing dot
// ============================================================================
function StatusDot({ state }) {
  const map = {
    not_connected: { color: "var(--muted)", anim: "" },
    in_progress: { color: "var(--blue)", anim: "pulse-ring 1.6s infinite" },
    connected: { color: "var(--green)", anim: "breath 2.4s ease-in-out infinite" },
    needs_attention: { color: "var(--warn)", anim: "" },
    installed_here: { color: "var(--green)", anim: "pulse-ring-green 2s infinite" },
    installed_elsewhere: { color: "var(--cyan)", anim: "" },
    error: { color: "var(--red)", anim: "" },
  };
  const cfg = map[state] || map.not_connected;
  return (
    <span style={{
      display: "inline-block", width: 10, height: 10, borderRadius: "50%",
      background: cfg.color, animation: cfg.anim, flexShrink: 0,
    }}/>
  );
}

const STATE_LABEL = {
  not_connected: "NOT_CONNECTED",
  in_progress: "IN_PROGRESS",
  connected: "CONNECTED",
  needs_attention: "NEEDS_ATTENTION",
  installed_here: "INSTALLED_ON_THIS_DEVICE",
  installed_elsewhere: "INSTALLED_ELSEWHERE",
  error: "ERROR",
};

// ============================================================================
// Mesh gradient hero — animated + low-fi
// ============================================================================
function MeshBackdrop({ active }) {
  if (!active) return null;
  return (
    <div aria-hidden style={{
      position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0,
    }}>
      <div className="shape-blob" style={{ width: 480, height: 480, top: -120, left: -100, background: "var(--coral)", opacity: 0.35 }}/>
      <div className="shape-blob" style={{ width: 380, height: 380, top: 80, right: -80, background: "var(--cyan)", opacity: 0.3, animationDelay: "-4s" }}/>
      <div className="shape-blob" style={{ width: 420, height: 420, bottom: -160, left: "30%", background: "var(--lime)", opacity: 0.28, animationDelay: "-7s" }}/>
      <div className="shape-blob" style={{ width: 260, height: 260, top: "40%", left: "55%", background: "var(--blue)", opacity: 0.18, animationDelay: "-10s" }}/>
    </div>
  );
}

// ============================================================================
// Top bar
// ============================================================================
function TopBar({ session, tenant, onSwitchTenant, gptReady, onLaunchGpt, onSignOut, onOpenEvidence }) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 30,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 28px",
      background: "color-mix(in srgb, var(--panel) 88%, transparent)",
      backdropFilter: "blur(14px)",
      borderBottom: "1px solid var(--line)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Brandmark/>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em" }}>MAD4B</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: "0.08em" }}>GROWTH·INTELLIGENCE·OS</span>
        </div>
        {tenant && (
          <button onClick={onSwitchTenant} className="btn btn-quiet btn-sm" style={{
            marginLeft: 12, gap: 8, paddingLeft: 8,
          }}>
            <TenantSwatch tenant={tenant} size={20}/>
            <span style={{ fontWeight: 600 }}>{tenant.name}</span>
            <span className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>{tenant.tenant_id}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M8 9l4 4 4-4M8 15l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-quiet btn-sm" onClick={onOpenEvidence}>
          <Icon.terminal width={14} height={14} stroke="currentColor"/>
          <span>Evidence</span>
        </button>
        {session && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 4 }}>
            <Avatar name={session.name} owner={session.owner}/>
            <button className="btn btn-quiet btn-xs" onClick={onSignOut} title="Sign out">Sign out</button>
          </div>
        )}
        <button className={`btn ${gptReady ? "btn-primary" : "btn-ghost"}`} onClick={onLaunchGpt} disabled={!gptReady} style={{ position: "relative" }}>
          <Icon.gpt width={14} height={14} stroke="currentColor"/>
          Open Custom GPT
          {gptReady && <span style={{
            position: "absolute", inset: -2, borderRadius: 8, pointerEvents: "none",
            boxShadow: "0 0 0 0 rgba(0,113,227,0.45)", animation: "pulse-ring 2s infinite",
          }}/>}
        </button>
      </div>
    </header>
  );
}

function Brandmark() {
  // Asymmetric M4B mark — two bars + a coral square that "breaks" out
  return (
    <div style={{ position: "relative", width: 32, height: 32 }}>
      <svg viewBox="0 0 32 32" width="32" height="32">
        <rect x="2" y="6" width="6" height="20" rx="1" fill="var(--ink)"/>
        <rect x="11" y="6" width="6" height="20" rx="1" fill="var(--ink)"/>
        <rect x="20" y="11" width="6" height="15" rx="1" fill="var(--blue)"/>
        <rect x="22" y="2" width="6" height="6" rx="1" fill="var(--coral)" style={{ animation: "breath 3s ease-in-out infinite" }}/>
      </svg>
    </div>
  );
}

function TenantSwatch({ tenant, size = 24 }) {
  const colorMap = { coral: "var(--coral)", cyan: "var(--cyan)", lime: "var(--lime)", blue: "var(--blue)" };
  return (
    <span style={{
      width: size, height: size, borderRadius: 4, display: "inline-flex",
      alignItems: "center", justifyContent: "center",
      background: colorMap[tenant.color] || "var(--blue)",
      color: "#1d1d1f", fontFamily: "var(--font-display)", fontWeight: 700,
      fontSize: size * 0.5,
    }}>{tenant.initial}</span>
  );
}

function Avatar({ name, owner }) {
  const initials = (name || "U").split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: "var(--ink)", color: "var(--fill)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700, fontFamily: "var(--font-display)",
      }}>{initials}</div>
      {owner && <span title="Platform owner" style={{
        position: "absolute", bottom: -2, right: -2,
        width: 12, height: 12, borderRadius: 3, background: "var(--coral)",
        border: "2px solid var(--panel)",
      }}/>}
    </div>
  );
}

Object.assign(window, { TWEAK_DEFAULTS, STEPS, SAMPLE_MEMBERSHIPS, Icon, StatusDot, STATE_LABEL, MeshBackdrop, TopBar, Brandmark, TenantSwatch, Avatar });
