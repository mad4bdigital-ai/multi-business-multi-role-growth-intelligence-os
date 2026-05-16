/* global React */
const { useState: useStateB, useEffect: useEffectB, useRef: useRefB, useMemo: useMemoB } = React;

// ============================================================================
// ACTIVATION HUB — connection cards
// ============================================================================
function ActivationHub({ session, tenant, connections, onOpenCard, onLaunch }) {
  const cards = [
    { key: "cloudflare", name: "Cloudflare Tunnel", subtitle: "Edge routing for your customer's connector traffic", icon: <Icon.cloudflare width={22} height={22} stroke="currentColor"/>, accent: "var(--coral)", state: connections.cloudflare },
    { key: "hostinger", name: "Hostinger DNS", subtitle: "Route a subdomain at the registrar level", icon: <Icon.hostinger width={22} height={22} stroke="currentColor"/>, accent: "var(--cyan)", state: connections.hostinger },
    { key: "device", name: "Local Connector", subtitle: "Provision the runtime on this machine", icon: <Icon.device width={22} height={22} stroke="currentColor"/>, accent: "var(--lime)", state: connections.device },
    { key: "launch", name: "Custom GPT", subtitle: "Open the activated tenant GPT", icon: <Icon.gpt width={22} height={22} stroke="currentColor"/>, accent: "var(--blue)", state: connections.launch },
  ];
  const future = [
    { name: "GitHub", state: "soon" },
    { name: "Google Drive", state: "soon" },
    { name: "n8n", state: "soon" },
    { name: "Make", state: "soon" },
    { name: "WordPress", state: "soon" },
  ];
  const completedCount = ["cloudflare", "hostinger", "device"].filter(k => ["connected", "installed_here"].includes(connections[k])).length;

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, gap: 24 }}>
        <div>
          <span className="label-eyebrow" style={{ color: "var(--lime)" }}>/connect · step 03 · activation hub</span>
          <h1 style={{
            fontFamily: "var(--font-display)", fontWeight: 800,
            fontSize: 38, lineHeight: 1.05, letterSpacing: "-0.02em",
            margin: "8px 0 6px", textWrap: "balance",
          }}>Wire {tenant?.name || "your workspace"} up.</h1>
          <p style={{ fontSize: 14.5, color: "var(--ink-soft)", maxWidth: 580, margin: 0 }}>
            Each card is a backend option. Connect them in any order — the GPT unlocks once Cloudflare, Hostinger, and a local device are live.
          </p>
        </div>
        <div className="panel" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <ProgressRing value={completedCount / 3} size={44}/>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700 }}>{completedCount}/3 ready</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>activation_state</div>
          </div>
        </div>
      </div>

      {session?.owner && <OwnerBadge/>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
        {cards.map((c, i) => (
          <ConnectionCard key={c.key} {...c} onOpen={() => c.key === "launch" ? onLaunch() : onOpenCard(c.key)} index={i}/>
        ))}
      </div>

      <div style={{ marginTop: 28 }}>
        <span className="label-eyebrow">Optional · future modules</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {future.map(f => (
            <span key={f.name} style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "6px 12px", border: "1px dashed var(--line-strong)",
              borderRadius: 999, fontSize: 12.5, color: "var(--muted)",
              background: "var(--panel-tint)",
            }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--line-strong)" }}/>
              {f.name}
              <span className="mono" style={{ fontSize: 10, opacity: 0.7 }}>SOON</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConnectionCard({ name, subtitle, icon, accent, state, onOpen, index }) {
  const cta = useMemoB(() => {
    const map = {
      not_connected: "Connect",
      connected: "Manage",
      needs_attention: "Resolve",
      installed_here: "Verify health",
      installed_elsewhere: "Provision here",
      in_progress: "Working…",
      error: "Retry",
    };
    return map[state] || "Connect";
  }, [state]);

  return (
    <div className="panel" style={{
      padding: 20, position: "relative", overflow: "hidden",
      transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease",
      animation: `fade-up 320ms ${index * 70}ms backwards ease`,
    }}
    onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-2)"; }}
    onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-1)"; }}>
      {/* accent corner */}
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} aria-hidden/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 8,
          background: `color-mix(in srgb, ${accent} 14%, var(--panel))`,
          color: accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: `1px solid color-mix(in srgb, ${accent} 28%, var(--line))`,
        }}>{icon}</div>
        <StateChip state={state}/>
      </div>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 700, margin: "0 0 4px", letterSpacing: "-0.01em" }}>{name}</h3>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 16px", lineHeight: 1.5 }}>{subtitle}</p>
      <button className="btn btn-secondary btn-sm" onClick={onOpen}>
        {cta} <Icon.arrow width={14} height={14} stroke="currentColor"/>
      </button>
    </div>
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

// ============================================================================
// CREDENTIAL VAULT
// ============================================================================
function CredentialVault({ connections, onSave, onBack }) {
  const [cf, setCf] = useStateB({ token: "", account: "" });
  const [hg, setHg] = useStateB({ token: "" });
  const [cfTest, setCfTest] = useStateB("idle");
  const [hgTest, setHgTest] = useStateB("idle");
  const [cfShow, setCfShow] = useStateB(false);
  const [hgShow, setHgShow] = useStateB(false);
  const [cfMode, setCfMode] = useStateB("managed");
  const [hgMode, setHgMode] = useStateB("managed");
  const [cfOAuth, setCfOAuth] = useStateB("idle"); // idle | redirecting | validating | ok | error
  const [hgOAuth, setHgOAuth] = useStateB("idle");

  const test = (which) => {
    const setter = which === "cf" ? setCfTest : setHgTest;
    setter("testing");
    setTimeout(() => setter("ok"), 900);
  };

  const startOAuth = (which) => {
    const setter = which === "cf" ? setCfOAuth : setHgOAuth;
    setter("redirecting");
    setTimeout(() => setter("validating"), 1100);
    setTimeout(() => setter("ok"), 2300);
  };

  const cfReady = cfMode === "managed" ? cfOAuth === "ok" : cfTest === "ok";
  const hgReady = hgMode === "managed" ? hgOAuth === "ok" : hgTest === "ok";
  const allReady = cfReady && hgReady;

  return (
    <div style={{ position: "relative" }}>
      <span className="label-eyebrow" style={{ color: "var(--coral)" }}>/connect · step 03 · credential vault</span>
      <h1 style={{
        fontFamily: "var(--font-display)", fontWeight: 800,
        fontSize: 36, lineHeight: 1.06, letterSpacing: "-0.02em",
        margin: "8px 0 4px",
      }}>Save your customer-owned credentials.</h1>
      <p style={{ fontSize: 14.5, color: "var(--ink-soft)", maxWidth: 620, marginBottom: 24 }}>
        Stored as encrypted <span className="mono">user_app_connections</span> rows — never in a screen, never in <span className="mono">env</span>. We never show the secret material back to you.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <CredentialCard
          provider="cloudflare" title="Cloudflare" accent="var(--coral)"
          subtitle="API token + Account ID"
          icon={<Icon.cloudflare width={20} height={20} stroke="currentColor"/>}
          mode={cfMode} setMode={setCfMode}
          oauthState={cfOAuth} onOAuth={() => startOAuth("cf")}
          managedNote="Routed through the shared Mad4B Cloudflare instance. No setup, sandbox limits."
          dedicatedNote="Bring your own Cloudflare. Full control, your edge, your billing."
          fields={[
            { label: "Cloudflare API token", value: cf.token, set: (v) => setCf({ ...cf, token: v }), secret: true, show: cfShow, setShow: setCfShow, placeholder: "cf_live_••••••••••••••••••" },
            { label: "Cloudflare account ID", value: cf.account, set: (v) => setCf({ ...cf, account: v }), placeholder: "a1b2c3d4e5f6..." },
          ]}
          testState={cfTest} onTest={() => test("cf")} ready={cfReady}
        />
        <CredentialCard
          provider="hostinger" title="Hostinger" accent="var(--cyan)"
          subtitle="DNS API token"
          icon={<Icon.hostinger width={20} height={20} stroke="currentColor"/>}
          mode={hgMode} setMode={setHgMode}
          oauthState={hgOAuth} onOAuth={() => startOAuth("hg")}
          managedNote="Use the shared Mad4B DNS pool. Subdomain provisioned automatically."
          dedicatedNote="Bring your own Hostinger account. Apex domain + custom DNS records."
          fields={[
            { label: "Hostinger API token", value: hg.token, set: (v) => setHg({ token: v }), secret: true, show: hgShow, setShow: setHgShow, placeholder: "hg_••••••••••••••••" },
          ]}
          testState={hgTest} onTest={() => test("hg")} ready={hgReady}
        />
      </div>

      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
        <button className="btn btn-quiet btn-sm" onClick={onBack}><Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: "rotate(180deg)" }}/> Back to hub</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            {allReady ? "READY · 2/2 providers verified" : `WAITING · ${(cfReady?1:0)+(hgReady?1:0)}/2`}
          </span>
          <button className="btn btn-primary" disabled={!allReady} onClick={() => onSave()}>
            Save & continue
            <Icon.arrow width={14} height={14} stroke="currentColor"/>
          </button>
        </div>
      </div>
    </div>
  );
}

function CredentialCard({ provider, title, subtitle, icon, accent, fields, testState, onTest, ready, mode, setMode, managedNote, dedicatedNote, oauthState, onOAuth }) {
  const isManaged = mode === "managed";
  return (
    <div className="panel" style={{ padding: 20, position: "relative" }}>
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }}/>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 6,
            background: `color-mix(in srgb, ${accent} 14%, var(--panel))`,
            color: accent, display: "flex", alignItems: "center", justifyContent: "center",
            border: `1px solid color-mix(in srgb, ${accent} 28%, var(--line))`,
          }}>{icon}</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{title}</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>app_key="{provider}"</div>
          </div>
        </div>
        {ready && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 9px", borderRadius: 999, fontSize: 11,
            fontFamily: "var(--font-mono)", background: "var(--green-soft)", color: "var(--green)",
            border: "1px solid color-mix(in srgb, var(--green) 24%, transparent)",
          }}><Icon.check width={12} height={12}/> {isManaged ? "MANAGED" : "VERIFIED"}</span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 12 }}>{subtitle}</div>

      {/* Mode toggle */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12, padding: 4, background: "var(--fill)", border: "1px solid var(--line)", borderRadius: 8 }}>
        {[
          { v: "managed", label: "Managed", sub: "Mad4B instance" },
          { v: "dedicated", label: "Dedicated", sub: "Manual setup" },
        ].map((opt) => {
          const active = mode === opt.v;
          return (
            <button key={opt.v} onClick={() => setMode(opt.v)} style={{
              padding: "8px 10px", borderRadius: 6, textAlign: "left",
              background: active ? accent : "transparent",
              color: active ? "#fff" : "var(--ink-soft)",
              border: "none", cursor: "pointer",
              transition: "all 140ms ease",
            }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-display)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: "50%", display: "inline-block",
                  border: `2px solid ${active ? "#fff" : "var(--line-strong)"}`,
                  background: active ? "transparent" : "transparent",
                  boxShadow: active ? "inset 0 0 0 3px " + accent + ", inset 0 0 0 4px #fff" : "none",
                }}/>
                {opt.label}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: active ? "rgba(255,255,255,0.85)" : "var(--muted)", marginTop: 2, marginLeft: 20, letterSpacing: "0.03em" }}>{opt.sub}</div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5, fontStyle: "italic" }}>
        {isManaged ? managedNote : dedicatedNote}
      </div>

      {isManaged ? (
        <div>
          <div style={{
            padding: "12px 14px", borderRadius: 6,
            background: `color-mix(in srgb, ${accent} 6%, var(--panel))`,
            border: `1px dashed color-mix(in srgb, ${accent} 32%, var(--line))`,
            display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10,
          }}>
            <Icon.check width={16} height={16} stroke={accent} style={{ marginTop: 2, flexShrink: 0 }}/>
            <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.5 }}>
              <strong style={{ color: accent }}>OAuth required.</strong> We'll redirect you to {title} to grant Mad4B access on the shared instance — read-only on the routing scope.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-ghost btn-sm"
              onClick={onOAuth}
              disabled={oauthState === "redirecting" || oauthState === "validating"}
              style={{ borderColor: accent, color: oauthState === "ok" ? "var(--green)" : accent }}>
              {oauthState === "redirecting" ? (<><Spinner/> Redirecting to {title}…</>) :
               oauthState === "validating" ? (<><Spinner/> Validating grant…</>) :
               oauthState === "ok" ? (<><Icon.check width={14} height={14}/> Re-authorize</>) :
               oauthState === "error" ? (<>Retry authorization</>) :
               (<>Authorize with {title} <Icon.arrow width={14} height={14} stroke="currentColor"/></>)}
            </button>
            {oauthState === "ok" && (
              <span className="mono" style={{ fontSize: 11, color: "var(--green)" }}>oauth_token · scope=routing.read · 200 OK</span>
            )}
            {oauthState === "redirecting" && (
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>→ {provider}.com/oauth/authorize</span>
            )}
            {oauthState === "validating" && (
              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>POST /oauth/callback · validating…</span>
            )}
          </div>
        </div>
      ) : fields.map((f, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <label className="field-label">{f.label}</label>
          <div style={{ position: "relative" }}>
            <input
              className="input mono"
              type={f.secret && !f.show ? "password" : "text"}
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
              placeholder={f.placeholder}
              style={{ paddingRight: f.secret ? 40 : 12 }}
            />
            {f.secret && (
              <button type="button" className="btn btn-quiet btn-xs" onClick={() => { f.setShow(!f.show); if (!f.show) setTimeout(() => f.setShow(false), 10000); }}
                title={f.show ? "Hide (auto-hides in 10s)" : "Show for 10 seconds"}
                style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", height: 30, padding: "0 8px" }}>
                <Icon.eye width={14} height={14} stroke="currentColor"/>
              </button>
            )}
          </div>
        </div>
      ))}
      {!isManaged && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button className="btn btn-ghost btn-sm" onClick={onTest} disabled={testState === "testing"}>
            {testState === "testing" ? (<><Spinner/> Testing</>) : testState === "ok" ? (<><Icon.check width={14} height={14}/> Re-test</>) : "Test connection"}
          </button>
          {testState === "ok" && (
            <span className="mono" style={{ fontSize: 11, color: "var(--green)" }}>200 OK · 142ms</span>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: "spin 0.9s linear infinite" }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.4" fill="none" strokeDasharray="40 16" strokeLinecap="round"/>
    </svg>
  );
}

Object.assign(window, { ActivationHub, ConnectionCard, StateChip, ProgressRing, OwnerBadge, CredentialVault, CredentialCard, Spinner });
