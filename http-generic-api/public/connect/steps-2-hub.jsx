/* global React, Icon, StatusDot */
const { useState: useStateB, useEffect: useEffectB, useRef: useRefB, useMemo: useMemoB } = React;

function Spinner({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "spin 0.9s linear infinite" }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" fill="none" strokeDasharray="40 16" strokeLinecap="round"/>
    </svg>
  );
}

// ============================================================================
// HOSTING PROVIDERS GLOSSARY
// ============================================================================
const HOSTING_PROVIDERS = [
  { key: "hostinger", name: "Hostinger", note: "DNS API · auto" },
  { key: "godaddy", name: "GoDaddy", note: "DNS + domains" },
  { key: "namecheap", name: "Namecheap", note: "DNS API" },
  { key: "cloudflare_reg", name: "Cloudflare Registrar", note: "Edge-native" },
  { key: "google_domains", name: "Google Domains", note: "Squarespace migration" },
  { key: "aws_route53", name: "AWS Route 53", note: "Programmatic DNS" },
  { key: "digitalocean", name: "DigitalOcean", note: "DNS only" },
  { key: "ovh", name: "OVHcloud", note: "EU registrar" },
  { key: "porkbun", name: "Porkbun", note: "API friendly" },
  { key: "custom", name: "Custom / Other", note: "Manual host record entry" },
];

// ============================================================================
// FEATURE-SCOPED ACTIVATION HUB
// ============================================================================
function ActivationHub({ session, tenant, connections, setConnections, onLaunch, pushLog }) {
  const ready = ["cloudflare", "hostinger", "device"].filter(k => ["connected", "installed_here"].includes(connections[k])).length;
  const optional = (connections.optional || {});
  const optionalCount = Object.values(optional).filter(v => v === "connected").length;

  const features = [
    {
      key: "cloudflare",
      title: "Empower local tools with public reach",
      hook: "Cloudflare Tunnel",
      subtitle: "Expose Auto-browsing, n8n autopilot, and local services to the public web — over a governed edge.",
      icon: <Icon.cloudflare width={22} height={22} stroke="currentColor"/>,
      accent: "var(--coral)",
      bullets: ["Auto-browsing reach", "Public n8n autopilot", "Edge-routed local APIs"],
      providers: [
        { key: "managed", label: "Mad4B Managed", note: "OAuth · shared edge" },
        { key: "dedicated", label: "Bring my own", note: "Cloudflare API token" },
      ],
      state: connections.cloudflare,
    },
    {
      key: "hostinger",
      title: "Connect your hosting provider",
      hook: "Grant AI control over DNS",
      subtitle: "Pick where your domain lives. The OS provisions the right host records and SSL automatically.",
      icon: <Icon.hostinger width={22} height={22} stroke="currentColor"/>,
      accent: "var(--cyan)",
      bullets: ["Host record automation", "Domain-level SSL handling", "Per-tenant subdomain"],
      providers: HOSTING_PROVIDERS.slice(0, 4).map(p => ({ key: p.key, label: p.name, note: p.note })).concat([{ key: "more", label: "More…", note: "10+ providers" }]),
      state: connections.hostinger,
    },
    {
      key: "device",
      title: "Install the local connector",
      hook: "Run the runtime on this machine",
      subtitle: "The connector stitches local files, browsers, and apps into the OS. Lives on the user's own hardware.",
      icon: <Icon.device width={22} height={22} stroke="currentColor"/>,
      accent: "var(--lime)",
      bullets: ["Local browsing & shell", "File/system access", "Auto-updates governed"],
      providers: [
        { key: "windows", label: "Windows", note: ".ps1 + .bat" },
        { key: "macos", label: "macOS", note: ".sh + brew" },
        { key: "linux", label: "Linux", note: "Docker / systemd" },
      ],
      state: connections.device,
    },
  ];

  const optionalCards = [
    { key: "github", name: "GitHub", note: "Code review & issues", accent: "var(--ink)", icon: "GH" },
    { key: "gdrive", name: "Google Drive", note: "Docs & sheets read/write", accent: "var(--blue)", icon: "GD" },
    { key: "n8n", name: "n8n", note: "Workflow autopilot", accent: "var(--coral)", icon: "n8" },
    { key: "make", name: "Make", note: "Scenario triggers", accent: "#6d3eff", icon: "Mk" },
    { key: "wp", name: "WordPress", note: "CMS publishing", accent: "#21759b", icon: "WP" },
    { key: "slack", name: "Slack", note: "Team notifications", accent: "#611f69", icon: "Sk" },
  ];

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, gap: 24 }}>
        <div>
          <span className="label-eyebrow" style={{ color: "var(--lime)" }}>/connect · step 02 · activation hub</span>
          <h1 style={{
            fontFamily: "var(--font-display)", fontWeight: 800,
            fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.02em",
            margin: "8px 0 6px", textWrap: "balance",
          }}>Wire {tenant?.name || "your workspace"} up.</h1>
          <p style={{ fontSize: 14.5, color: "var(--ink-soft)", maxWidth: 600, margin: 0 }}>
            Each card is a capability — pick a managed default or bring your own. The OS routes credentials into governed connections.
          </p>
        </div>
        <div className="panel" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <ProgressRing value={ready / 3} size={44}/>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700 }}>{ready}/3 ready</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>+{optionalCount} optional</div>
          </div>
        </div>
      </div>

      {session?.owner && <OwnerBadge/>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
        {features.map((f, i) => <FeatureCard key={f.key} feature={f} index={i} setConnections={setConnections} pushLog={pushLog}/>)}
      </div>

      <div style={{ marginTop: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
          <span className="label-eyebrow">Optional · activate any</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{optionalCount} connected</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {optionalCards.map((c) => (
            <OptionalConnectorCard key={c.key} card={c} state={optional[c.key] || "not_connected"} setConnections={setConnections} pushLog={pushLog}/>
          ))}
        </div>
      </div>
    </div>
  );
}

// Feature card — outcome-led with inline provider picker + ajax connect
function FeatureCard({ feature, index, setConnections, pushLog }) {
  const [expanded, setExpanded] = useStateB(false);
  const [provider, setProvider] = useStateB(feature.providers[0]?.key);
  const [busy, setBusy] = useStateB(false);
  const [customDomain, setCustomDomain] = useStateB("");
  const [allProviders, setAllProviders] = useStateB(false);

  const isHosting = feature.key === "hostinger";
  const providerList = isHosting && allProviders ? HOSTING_PROVIDERS.map(p => ({ key: p.key, label: p.name, note: p.note })) : feature.providers;

  const isConnected = ["connected", "installed_here"].includes(feature.state);

  const handleConnect = () => {
    setBusy(true);
    pushLog?.({ method: "POST", path: "/app-connections", status: 202, ms: 12, body: { app_key: feature.key, provider, mode: provider === "managed" ? "managed" : "dedicated" } });
    setTimeout(() => {
      pushLog?.({ method: "POST", path: feature.key === "device" ? "/local-connector/install" : "/app-connections", status: 201, ms: 218, body: { ok: true, app_key: feature.key, provider, connection_id: `${feature.key.slice(0,2)}_conn_${Math.random().toString(16).slice(2,8)}` } });
      setConnections(c => ({ ...c, [feature.key]: feature.key === "device" ? "installed_here" : "connected" }));
      setBusy(false);
      setExpanded(false);
    }, 1100);
  };

  return (
    <div className="panel" style={{
      padding: 0, position: "relative", overflow: "hidden",
      animation: `fade-up 320ms ${index * 70}ms backwards ease`,
      borderColor: isConnected ? `color-mix(in srgb, ${feature.accent} 38%, var(--line))` : undefined,
    }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: feature.accent }} aria-hidden/>
      <div style={{ padding: 20, display: "grid", gridTemplateColumns: "52px minmax(0,1fr) auto", gap: 16, alignItems: "flex-start" }}>
        <div style={{
          width: 44, height: 44, borderRadius: 8,
          background: `color-mix(in srgb, ${feature.accent} 14%, var(--panel))`,
          color: feature.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1px solid color-mix(in srgb, ${feature.accent} 28%, var(--line))`,
        }}>{feature.icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{feature.title}</h3>
            <span className="mono" style={{ fontSize: 10.5, color: feature.accent, fontWeight: 700, letterSpacing: "0.04em", padding: "2px 7px", borderRadius: 4, background: `color-mix(in srgb, ${feature.accent} 12%, var(--panel))`, border: `1px solid color-mix(in srgb, ${feature.accent} 28%, transparent)` }}>{feature.hook.toUpperCase()}</span>
          </div>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 10px", lineHeight: 1.5 }}>{feature.subtitle}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {feature.bullets.map(b => (
              <span key={b} style={{ fontSize: 11.5, color: "var(--muted)", padding: "3px 9px", background: "var(--fill)", borderRadius: 999, border: "1px solid var(--line)" }}>{b}</span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <StateChip state={feature.state}/>
          <button
            className={isConnected ? "btn btn-quiet btn-sm" : "btn btn-secondary btn-sm"}
            onClick={() => setExpanded(e => !e)}
            style={!isConnected ? { borderColor: feature.accent, color: feature.accent } : undefined}>
            {isConnected ? "Manage" : (expanded ? "Cancel" : "Connect")}
            <Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 180ms" }}/>
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--line)", padding: 18, background: "var(--panel-tint)", animation: "fade-up 220ms ease" }}>
          <div className="label-eyebrow" style={{ marginBottom: 10 }}>{isHosting ? "Hosting provider" : "Mode"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginBottom: 14 }}>
            {providerList.map((p) => {
              const active = provider === p.key;
              return (
                <button key={p.key} onClick={() => setProvider(p.key)} style={{
                  padding: "10px 12px", borderRadius: 8, textAlign: "left",
                  background: active ? `color-mix(in srgb, ${feature.accent} 12%, var(--panel))` : "var(--panel)",
                  color: active ? feature.accent : "var(--ink)",
                  border: `1px solid ${active ? feature.accent : "var(--line)"}`,
                  cursor: "pointer", transition: "all 140ms ease",
                }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-display)" }}>{p.label}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 2, letterSpacing: "0.03em" }}>{p.note}</div>
                </button>
              );
            })}
          </div>

          {isHosting && !allProviders && (
            <button className="btn btn-quiet btn-xs" onClick={() => setAllProviders(true)} style={{ marginBottom: 12 }}>
              Show all {HOSTING_PROVIDERS.length} providers
            </button>
          )}

          {isHosting && provider === "custom" && (
            <div style={{ marginBottom: 14 }}>
              <label className="field-label">Custom hosting · API endpoint or domain</label>
              <input className="input mono" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="api.myhost.com or domain.tld"/>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
              {provider === "managed" ? "OAuth → " + feature.hook : `POST /app-connections · provider=${provider}`}
            </span>
            <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={busy} style={{ background: feature.accent, borderColor: feature.accent }}>
              {busy ? (<><Spinner/> Connecting…</>) : (<>{provider === "managed" ? `Authorize ${feature.hook}` : `Connect ${feature.hook}`} <Icon.arrow width={14} height={14} stroke="currentColor"/></>)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionalConnectorCard({ card, state, setConnections, pushLog }) {
  const [busy, setBusy] = useStateB(false);
  const isConnected = state === "connected";

  const onClick = () => {
    if (isConnected) {
      setConnections(c => ({ ...c, optional: { ...(c.optional || {}), [card.key]: "not_connected" } }));
      pushLog?.({ method: "DELETE", path: `/app-connections/${card.key}`, status: 204, ms: 64, body: { ok: true } });
      return;
    }
    setBusy(true);
    pushLog?.({ method: "POST", path: "/app-connections", status: 202, ms: 18, body: { app_key: card.key, mode: "managed" } });
    setTimeout(() => {
      setConnections(c => ({ ...c, optional: { ...(c.optional || {}), [card.key]: "connected" } }));
      pushLog?.({ method: "POST", path: "/app-connections", status: 201, ms: 184, body: { ok: true, app_key: card.key, connection_id: `${card.key}_conn_${Math.random().toString(16).slice(2,8)}` } });
      setBusy(false);
    }, 900);
  };

  return (
    <button
      className="panel"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: 12, textAlign: "left", cursor: busy ? "wait" : "pointer",
        display: "grid", gridTemplateColumns: "32px minmax(0, 1fr) auto", gap: 10, alignItems: "center",
        background: isConnected ? `color-mix(in srgb, ${card.accent} 8%, var(--panel))` : "var(--panel)",
        borderColor: isConnected ? `color-mix(in srgb, ${card.accent} 34%, var(--line))` : "var(--line)",
        transition: "all 160ms ease",
      }}>
      <span style={{
        width: 32, height: 32, borderRadius: 6,
        background: `color-mix(in srgb, ${card.accent} 14%, var(--panel))`,
        color: card.accent, border: `1px solid color-mix(in srgb, ${card.accent} 28%, var(--line))`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700,
      }}>{card.icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700 }}>{card.name}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{card.note}</div>
      </div>
      <span style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", fontWeight: 700, letterSpacing: "0.04em", color: isConnected ? "var(--green)" : busy ? "var(--blue)" : "var(--muted)" }}>
        {busy ? "…" : isConnected ? "✓ ON" : "+ ADD"}
      </span>
    </button>
  );
}

function StateChip({ state }) {
  const map = {
    not_connected: { label: "Not connected", color: "var(--muted)", bg: "var(--fill)" },
    connected: { label: "Connected", color: "var(--green)", bg: "var(--green-soft)" },
    needs_attention: { label: "Attention", color: "var(--warn)", bg: "var(--warn-soft)" },
    installed_here: { label: "Installed · this device", color: "var(--green)", bg: "var(--green-soft)" },
    installed_elsewhere: { label: "Installed elsewhere", color: "var(--cyan)", bg: "color-mix(in srgb, var(--cyan) 12%, var(--panel))" },
    in_progress: { label: "Working", color: "var(--blue)", bg: "var(--blue-soft)" },
    error: { label: "Error", color: "var(--red)", bg: "var(--red-soft)" },
  };
  const cfg = map[state] || map.not_connected;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 9px", borderRadius: 999, fontSize: 11,
      fontFamily: "var(--font-mono)", fontWeight: 500, letterSpacing: "0.02em",
      background: cfg.bg, color: cfg.color,
      border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)`,
    }}>
      <StatusDot state={state}/> {cfg.label}
    </span>
  );
}

function ProgressRing({ value, size = 44 }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--line)" strokeWidth="3"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--blue)" strokeWidth="3"
        strokeDasharray={c} strokeDashoffset={c * (1 - value)} strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 600ms ease" }}/>
    </svg>
  );
}

function OwnerBadge() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", marginBottom: 16,
      background: "color-mix(in srgb, var(--coral) 8%, var(--panel))",
      border: "1px solid color-mix(in srgb, var(--coral) 28%, var(--line))",
      borderRadius: 8,
    }}>
      <span style={{
        padding: "3px 8px", background: "var(--coral)", color: "#fff",
        borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 10,
        fontWeight: 700, letterSpacing: "0.05em",
      }}>OWNER</span>
      <span style={{ fontSize: 13, color: "var(--ink-soft)" }}>
        Platform-owner session · server <span className="mono">env</span> credentials are visible to you. Customer view shows DB-backed connection IDs only.
      </span>
    </div>
  );
}

Object.assign(window, { ActivationHub, FeatureCard, OptionalConnectorCard, StateChip, ProgressRing, OwnerBadge, Spinner });
