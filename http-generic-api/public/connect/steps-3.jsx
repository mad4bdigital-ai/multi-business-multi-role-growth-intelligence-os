/* global React */
const { useState: useStateC, useEffect: useEffectC, useRef: useRefC } = React;

// ============================================================================
// DEVICE INSTALL — cascading reveal
// ============================================================================
function DeviceInstall({ tenant, deviceId, setDeviceId, onComplete, onBack, completed }) {
  const [phase, setPhase] = useStateC(completed ? "done" : "idle"); // idle, building, done
  const [progress, setProgress] = useStateC(completed ? 100 : 0);
  const [revealed, setRevealed] = useStateC(completed ? 6 : 0); // count of artifacts visible
  const [advanced, setAdvanced] = useStateC(false);

  const tunnelUrl = `https://${deviceId || "this-mac"}.connector.mad4b.com`;
  const dnsRecord = `connector.${tenant?.domain || "northwind.coffee"}  CNAME  ${deviceId || "this-mac"}.cfargotunnel.com`;
  const startCmd = `cd C:\\mad4b-connector && .\\start-connector.bat`;

  const artifacts = [
    { kind: "tunnel", label: "Cloudflare tunnel", code: "TUNNEL_OK", value: tunnelUrl, accent: "var(--coral)" },
    { kind: "dns", label: "Hostinger DNS record", code: "DNS_OK", value: dnsRecord, accent: "var(--cyan)" },
    { kind: "file", label: ".env", code: "ENV_BUILT", size: "612 B", icon: "ENV" },
    { kind: "file", label: "install-local-connector.ps1", code: "PS1_BUILT", size: "3.4 KB", icon: "PS1" },
    { kind: "file", label: "start-connector.bat", code: "BAT_BUILT", size: "184 B", icon: "BAT" },
    { kind: "cmd", label: "Run command", value: startCmd, accent: "var(--lime)" },
  ];

  const build = () => {
    setPhase("building");
    setProgress(0);
    setRevealed(0);
    let p = 0;
    const tick = setInterval(() => {
      p += 4 + Math.random() * 6;
      if (p >= 100) {
        p = 100;
        clearInterval(tick);
        setPhase("done");
        setProgress(100);
        // cascade reveal artifacts
        artifacts.forEach((_, i) => setTimeout(() => setRevealed(i + 1), 180 + i * 220));
        setTimeout(() => onComplete && onComplete(), 180 + artifacts.length * 220 + 400);
      } else {
        setProgress(p);
      }
    }, 90);
  };

  return (
    <div style={{ position: "relative" }}>
      <span className="label-eyebrow" style={{ color: "var(--lime)" }}>/connect · step 06 · local connector</span>
      <h1 style={{
        fontFamily: "var(--font-display)", fontWeight: 800,
        fontSize: 36, lineHeight: 1.06, letterSpacing: "-0.02em",
        margin: "8px 0 4px",
      }}>Provision a local route for this device.</h1>
      <p style={{ fontSize: 14.5, color: "var(--ink-soft)", maxWidth: 640, marginBottom: 24 }}>
        Each device gets its own subdomain, tunnel secret, and bundle. Idempotent: re-running on the same <span className="mono">device_id</span> returns the same artifacts.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
        <div className="panel" style={{ padding: 16 }}>
          <label className="field-label">Device ID</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input mono" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="this-mac"/>
            <button className="btn btn-ghost" title="Regenerate" onClick={() => setDeviceId("dev-" + Math.random().toString(36).slice(2, 8))}>
              <Icon.refresh width={14} height={14} stroke="currentColor"/>
            </button>
          </div>
          <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
            suggested from {(navigator.platform || "device").toLowerCase()} · used as subdomain prefix
          </div>
        </div>
        <div className="panel" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="label-eyebrow">Will create</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--blue)" }}>POST /local-connector/install</span>
          </div>
          <div className="mono" style={{ fontSize: 12.5, lineHeight: 1.7, color: "var(--ink-soft)" }}>
            <span style={{ color: "var(--coral)" }}>→</span> {tunnelUrl}<br/>
            <span style={{ color: "var(--cyan)" }}>→</span> connector.{tenant?.domain || "—"}<br/>
            <span style={{ color: "var(--lime)" }}>→</span> ./mad4b-connector/*
          </div>
        </div>
      </div>

      {phase === "idle" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <button className="btn btn-quiet btn-sm" onClick={onBack}><Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: "rotate(180deg)" }}/> Back</button>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn btn-quiet btn-sm" onClick={() => setAdvanced(!advanced)}>
              {advanced ? "Hide" : "Show"} advanced
            </button>
            <button className="btn btn-primary" onClick={build}>
              <Icon.sparkle width={14} height={14}/> Create install bundle
            </button>
          </div>
        </div>
      )}

      {advanced && phase === "idle" && (
        <div style={{
          padding: 12, background: "color-mix(in srgb, var(--red) 6%, var(--panel))",
          border: "1px solid color-mix(in srgb, var(--red) 25%, var(--line))",
          borderRadius: 6, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14,
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: "var(--red)" }}>Rotate this device</div>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>Issues a fresh tunnel secret and overwrites the existing route. <span className="mono">reprovision=true</span></div>
          </div>
          <button className="btn btn-danger btn-sm">Rotate</button>
        </div>
      )}

      {phase === "building" && (
        <div className="panel" style={{ padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>Building bundle…</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--blue)" }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 6, background: "var(--fill)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: progress + "%",
              background: "linear-gradient(90deg, var(--coral), var(--blue), var(--cyan), var(--lime))",
              backgroundSize: "200% 100%", animation: "shimmer 1.6s linear infinite",
              transition: "width 200ms ease",
            }}/>
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 14, lineHeight: 1.7 }}>
            <div style={{ opacity: progress > 5 ? 1 : 0.4 }}>→ POST /local-connector/install</div>
            <div style={{ opacity: progress > 25 ? 1 : 0.4 }}>→ creating Cloudflare tunnel...</div>
            <div style={{ opacity: progress > 50 ? 1 : 0.4 }}>→ writing Hostinger CNAME...</div>
            <div style={{ opacity: progress > 75 ? 1 : 0.4 }}>→ generating .env, .ps1, .bat...</div>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
            padding: "10px 14px",
            background: "color-mix(in srgb, var(--green) 8%, var(--panel))",
            border: "1px solid color-mix(in srgb, var(--green) 28%, var(--line))",
            borderRadius: 8,
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: "50%", background: "var(--green)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", animation: "pulse-ring-green 2s infinite",
            }}><Icon.check width={16} height={16}/></span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14 }}>Bundle ready · 6 artifacts</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                201 Created · device_id={deviceId} · tunnel_id=tnl_8f2a91
              </div>
            </div>
            <button className="btn btn-ghost btn-sm">
              <Icon.refresh width={13} height={13} stroke="currentColor"/> Health check
            </button>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {artifacts.slice(0, revealed).map((a, i) => <ArtifactCard key={i} index={i} {...a}/>)}
          </div>

          <div style={{ marginTop: 18, padding: "10px 14px", background: "var(--fill-2)", border: "1px dashed var(--line-strong)", borderRadius: 8 }}>
            <span className="label-eyebrow">Next</span>
            <div style={{ fontSize: 13, marginTop: 4, color: "var(--ink-soft)" }}>
              Run the PowerShell once on this Windows host. Open a new terminal and run <span className="mono" style={{ background: "var(--panel)", padding: "1px 6px", borderRadius: 3, border: "1px solid var(--line)" }}>start-connector.bat</span> — then come back to verify health.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactCard({ kind, label, code, value, size, icon, accent, index }) {
  const [copied, setCopied] = useStateC(false);
  const copy = () => { navigator.clipboard?.writeText(value || ""); setCopied(true); setTimeout(() => setCopied(false), 1300); };
  return (
    <div className="panel" style={{
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 12,
      animation: `fade-up 380ms ${index * 60}ms backwards ease`,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 6,
        background: kind === "file" ? "var(--ink)" : `color-mix(in srgb, ${accent} 14%, var(--panel))`,
        color: kind === "file" ? "var(--panel)" : accent,
        border: kind === "file" ? "1px solid var(--ink)" : `1px solid color-mix(in srgb, ${accent} 26%, var(--line))`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
        flexShrink: 0,
      }}>
        {kind === "file" ? icon
          : kind === "tunnel" ? <Icon.cloudflare width={18} height={18} stroke="currentColor"/>
          : kind === "dns" ? <Icon.hostinger width={18} height={18} stroke="currentColor"/>
          : <Icon.terminal width={18} height={18} stroke="currentColor"/>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5 }}>{label}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--green)", padding: "1px 6px", background: "var(--green-soft)", borderRadius: 3 }}>{code}</span>
          {size && <span className="mono" style={{ fontSize: 10.5, color: "var(--muted)" }}>{size}</span>}
        </div>
        {value && (
          <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {value}
          </div>
        )}
      </div>
      {kind === "file" ? (
        <button className="btn btn-ghost btn-sm">
          <Icon.download width={13} height={13} stroke="currentColor"/> Download
        </button>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={copy}>
          <Icon.copy width={13} height={13} stroke="currentColor"/> {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// GPT LAUNCH
// ============================================================================
function GptLaunch({ session, tenant, deviceId, connections, onLaunch, onBack, userToken }) {
  const checks = [
    { label: "Account signed in", state: !!session, value: session?.email },
    { label: "Workspace selected", state: !!tenant, value: tenant?.name },
    { label: "Cloudflare credentials", state: connections.cloudflare === "connected", value: "cf_conn_8a91b3" },
    { label: "Hostinger credentials", state: connections.hostinger === "connected", value: "hg_conn_2c44e7" },
    { label: "Local install bundle", state: connections.device === "installed_here", value: deviceId },
    { label: "Connector reachable", state: connections.device === "installed_here", value: "200 OK · 87ms" },
  ];
  const ready = checks.every(c => c.state);
  const [copied, setCopied] = useStateC(false);
  const [tokenVisible, setTokenVisible] = useStateC(false);
  const [tokenCopied, setTokenCopied] = useStateC(false);

  const ctx = `tenant_id=${tenant?.tenant_id}\ndevice_id=${deviceId}\ntunnel_url=https://${deviceId}.connector.mad4b.com${userToken ? `\nAuthorization: Bearer ${userToken}` : ""}`;
  const copy = () => { navigator.clipboard?.writeText(ctx); setCopied(true); setTimeout(() => setCopied(false), 1300); };
  const copyToken = () => { if (userToken) { navigator.clipboard?.writeText(userToken); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 1300); } };

  const maskedToken = userToken ? userToken.slice(0, 12) + "·".repeat(20) + userToken.slice(-6) : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 28, alignItems: "start" }}>
      <div>
        <span className="label-eyebrow" style={{ color: "var(--blue)" }}>/connect · step 07 · launch</span>
        <h1 style={{
          fontFamily: "var(--font-display)", fontWeight: 800,
          fontSize: 48, lineHeight: 1.02, letterSpacing: "-0.025em",
          margin: "8px 0 12px", textWrap: "balance",
        }}>
          {ready ? <>You're <span style={{
            background: "linear-gradient(120deg, var(--coral), var(--blue), var(--cyan))",
            WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          }}>cleared for launch</span>.</> : <>Almost ready to launch.</>}
        </h1>
        <p style={{ fontSize: 15, color: "var(--ink-soft)", maxWidth: 480, marginBottom: 28 }}>
          {ready
            ? `Open the Growth Intelligence GPT for ${tenant?.name}. Copy your session token below to link your account to the Tenant GPT.`
            : "Finish the activation steps to unlock the launch."}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 20, alignItems: "center" }}>
          <button
            className={`btn ${ready ? "btn-primary" : "btn-ghost"}`}
            disabled={!ready}
            onClick={onLaunch}
            style={{ height: 56, padding: "0 22px", fontSize: 15, position: "relative" }}>
            <Icon.gpt width={18} height={18} stroke="currentColor"/>
            Open Growth Intelligence GPT
            <Icon.arrow width={16} height={16} stroke="currentColor"/>
            {ready && <span aria-hidden style={{ position: "absolute", inset: -3, borderRadius: 9, animation: "pulse-ring 1.8s infinite", boxShadow: "0 0 0 0 rgba(0,113,227,0.4)" }}/>}
          </button>
          <button className="btn btn-ghost" onClick={copy}>
            <Icon.copy width={14} height={14} stroke="currentColor"/>
            {copied ? "Copied context" : "Copy activation context"}
          </button>
        </div>

        {userToken && (
          <div style={{ marginTop: 24, padding: "16px 18px", borderRadius: 8, background: "var(--fill)", border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Your session token</span>
              <button onClick={() => setTokenVisible(v => !v)} style={{ fontSize: 11.5, color: "var(--blue)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", padding: 0 }}>
                {tokenVisible ? "hide" : "reveal"}
              </button>
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink)", wordBreak: "break-all", lineHeight: 1.55, marginBottom: 10, userSelect: tokenVisible ? "text" : "none" }}>
              {tokenVisible ? userToken : maskedToken}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
              Paste this into the Tenant GPT when prompted for your session token to link your account and workspace.
            </p>
            <button className="btn btn-ghost btn-sm" onClick={copyToken}>
              <Icon.copy width={12} height={12} stroke="currentColor"/>
              {tokenCopied ? "Copied!" : "Copy token"}
            </button>
          </div>
        )}

        <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 14 }}>
          fallback: TENANT_GPT_URL → CUSTOM_GPT_URL → https://chatgpt.com/gpts
        </div>
        <button className="btn btn-quiet btn-sm" onClick={onBack} style={{ marginTop: 24 }}>
          <Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: "rotate(180deg)" }}/>
          Back to hub
        </button>
      </div>

      <div className="panel" style={{ padding: 22, position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", top: -32, right: -32, width: 90, height: 90, background: "var(--cyan)", opacity: 0.5, borderRadius: 4, transform: "rotate(18deg)" }} aria-hidden/>
        <span className="label-eyebrow">Readiness check</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {checks.map((c, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
              background: c.state ? "var(--green-soft)" : "var(--fill)",
              borderRadius: 6,
              border: `1px solid ${c.state ? "color-mix(in srgb, var(--green) 22%, transparent)" : "var(--line)"}`,
              animation: `fade-up 320ms ${i * 50}ms backwards ease`,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: "50%",
                background: c.state ? "var(--green)" : "var(--panel)",
                color: c.state ? "#fff" : "var(--muted)",
                border: c.state ? "none" : "1px solid var(--line-strong)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>{c.state ? <Icon.check width={12} height={12}/> : <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--muted)" }}/>}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.label}</div>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>{c.value || "—"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { DeviceInstall, ArtifactCard, GptLaunch });
