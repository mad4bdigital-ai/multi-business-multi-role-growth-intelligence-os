/* global React */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;

// ============================================================================
// Activation rail (left)
// ============================================================================
function ActivationRail({ currentStep, completed, session, tenant, deviceId }) {
  const idx = STEPS.findIndex(s => s.key === currentStep);
  return (
    <aside style={{
      display: "flex", flexDirection: "column", gap: 18,
      paddingRight: 8, position: "sticky", top: 88, alignSelf: "start",
      minWidth: 0,
    }}>
      <div className="panel" style={{ padding: "18px 18px 14px", position: "relative", overflow: "hidden" }}>
        <span className="label-eyebrow">Tenant</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 12 }}>
          {tenant ? (
            <>
              <TenantSwatch tenant={tenant} size={36}/>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15 }}>{tenant.name}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>{tenant.tenant_id}</div>
              </div>
            </>
          ) : (
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>No workspace selected</div>
          )}
        </div>
        <div style={{ height: 1, background: "var(--line)", margin: "4px -18px 12px" }}/>
        <span className="label-eyebrow">Device</span>
        <div className="mono" style={{ fontSize: 12, marginTop: 6, color: "var(--ink-soft)", wordBreak: "break-all" }}>
          {deviceId || "—"}
        </div>
        <span style={{
          position: "absolute", top: -20, right: -20, width: 80, height: 80,
          background: "var(--lime)", opacity: 0.18, borderRadius: 4,
          transform: "rotate(18deg)",
        }} aria-hidden/>
      </div>

      <div className="panel" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="label-eyebrow">Activation</span>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
            {completed.size} / {STEPS.length}
          </span>
        </div>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {STEPS.map((s, i) => {
            const isDone = completed.has(s.key);
            const isCurrent = s.key === currentStep;
            return (
              <li key={s.key} style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                <div style={{
                  position: "relative", width: 28, height: 28, borderRadius: 6,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: isDone ? "var(--green)" : isCurrent ? "var(--blue)" : "var(--fill)",
                  color: isDone || isCurrent ? "#fff" : "var(--muted)",
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  transition: "all 200ms ease",
                  boxShadow: isCurrent ? "0 0 0 4px rgba(0,113,227,0.18)" : "none",
                }}>
                  {isDone ? <Icon.check width={14} height={14}/> : s.num}
                </div>
                {i < STEPS.length - 1 && (
                  <span style={{
                    position: "absolute", left: 13, top: 36, width: 2, height: 18,
                    background: isDone ? "var(--green)" : "var(--line)",
                  }}/>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontWeight: isCurrent ? 700 : 500,
                    color: isCurrent ? "var(--ink)" : isDone ? "var(--ink-soft)" : "var(--muted)",
                    fontSize: 13.5,
                  }}>{s.label}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div style={{ padding: "12px 14px", background: "color-mix(in srgb, var(--coral) 8%, var(--panel))", border: "1px solid color-mix(in srgb, var(--coral) 30%, var(--line))", borderRadius: 8 }}>
        <div className="label-eyebrow" style={{ color: "var(--coral)" }}>One device · One route</div>
        <div style={{ fontSize: 12, marginTop: 6, color: "var(--ink-soft)", lineHeight: 1.5 }}>
          Each device gets its own tunnel & secret. Reprovisioning is intentional, not accidental.
        </div>
      </div>
    </aside>
  );
}

// ============================================================================
// AUTH STEP
// ============================================================================
function AuthStep({ onSignIn, error }) {
  const [mode, setMode] = useStateA("login");
  const [email, setEmail] = useStateA("essam@northwind.coffee");
  const [password, setPassword] = useStateA("•••••••••••");
  const [name, setName] = useStateA("");
  const [tenantName, setTenantName] = useStateA("");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 24, position: "relative" }}>
      <div style={{ position: "relative", paddingTop: 12 }}>
        <span className="label-eyebrow" style={{ color: "var(--coral)" }}>/connect · sign-in gate</span>
        <h1 style={{
          fontFamily: "var(--font-display)", fontWeight: 800,
          fontSize: 56, lineHeight: 1.02, letterSpacing: "-0.025em",
          margin: "10px 0 14px", maxWidth: 520, textWrap: "balance",
        }}>
          Sign in to your <span style={{ position: "relative", whiteSpace: "nowrap" }}>
            <span style={{ position: "relative", zIndex: 1 }}>launchpad</span>
            <span style={{
              position: "absolute", left: -4, right: -4, bottom: 6, height: 14,
              background: "var(--lime)", zIndex: 0, borderRadius: 2,
              transform: "rotate(-1deg)",
            }} aria-hidden/>
          </span>.
        </h1>
        <p style={{ fontSize: 16, color: "var(--ink-soft)", maxWidth: 460, lineHeight: 1.5, marginTop: 0 }}>
          A guided activation for your tenant. Connect your Cloudflare and Hostinger,
          provision a local connector, and open the GPT &mdash; without touching platform credentials.
        </p>
        <div style={{ display: "flex", gap: 14, marginTop: 28, flexWrap: "wrap" }}>
          <TrustChip icon={<Icon.shield width={14} height={14} stroke="currentColor"/>} label="Encrypted at rest"/>
          <TrustChip icon={<Icon.device width={14} height={14} stroke="currentColor"/>} label="One device, one route"/>
          <TrustChip icon={<Icon.terminal width={14} height={14} stroke="currentColor"/>} label="Customer-owned credentials"/>
        </div>

        {/* Decorative break-the-grid mark */}
        <svg viewBox="0 0 200 200" style={{
          position: "absolute", left: -40, bottom: -60, width: 220, height: 220,
          opacity: 0.5, pointerEvents: "none",
        }}>
          <circle cx="100" cy="100" r="80" fill="none" stroke="var(--cyan)" strokeWidth="1" strokeDasharray="2 6"/>
          <circle cx="100" cy="100" r="55" fill="none" stroke="var(--coral)" strokeWidth="1" strokeDasharray="2 6"/>
          <circle cx="100" cy="100" r="30" fill="none" stroke="var(--lime)" strokeWidth="1"/>
        </svg>
      </div>

      <div className="panel" style={{ padding: 28, position: "relative", overflow: "hidden" }}>
        <span style={{
          position: "absolute", top: -28, right: -28, width: 80, height: 80,
          background: "var(--coral)", borderRadius: 4, transform: "rotate(20deg)",
          opacity: 0.9,
        }} aria-hidden/>
        <span className="label-eyebrow">Authenticate</span>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, margin: "6px 0 18px", letterSpacing: "-0.01em" }}>
          {mode === "login" ? "Welcome back." : "Create your workspace."}
        </h2>

        {/* GSI renders the real Google button here */}
        <div id="gsi-btn-container" style={{ width: "100%", minHeight: 44, display: "flex", justifyContent: "center", alignItems: "center" }}/>
        {/* Fallback shown only if GSI hasn't initialised yet */}
        <noscript>
          <p style={{ fontSize: 12, color: "var(--muted)", textAlign: "center" }}>Enable JavaScript to use Google Sign-In.</p>
        </noscript>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0", color: "var(--muted)" }}>
          <span style={{ flex: 1, height: 1, background: "var(--line)" }}/>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.08em" }}>OR WITH EMAIL</span>
          <span style={{ flex: 1, height: 1, background: "var(--line)" }}/>
        </div>

        <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--fill)", borderRadius: 8, marginBottom: 16 }}>
          {[["login", "Sign in"], ["signup", "Create account"]].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} className="btn btn-sm" style={{
              flex: 1, height: 32, border: "none",
              background: mode === k ? "var(--panel)" : "transparent",
              color: mode === k ? "var(--ink)" : "var(--muted)",
              boxShadow: mode === k ? "var(--shadow-1)" : "none",
              fontWeight: 600,
            }}>{label}</button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onSignIn({ provider: "email", email, name: name || "Essam Nagy", mode, password }); }}>
          {mode === "signup" && (
            <>
              <label className="field-label">Display name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Essam Nagy" style={{ marginBottom: 12 }}/>
              <label className="field-label">Workspace</label>
              <input className="input" value={tenantName} onChange={(e) => setTenantName(e.target.value)} placeholder="Northwind Coffee" style={{ marginBottom: 12 }}/>
            </>
          )}
          <label className="field-label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" style={{ marginBottom: 12 }}/>
          <label className="field-label">Password</label>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} type="password" style={{ marginBottom: 4 }}/>
          {error && <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--red-soft)", color: "var(--red)", borderRadius: 6, fontSize: 12.5, animation: "glitch-x 200ms 2" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <button type="submit" className="btn btn-primary" style={{ flex: 1, height: 44 }}>
              {mode === "login" ? "Sign in" : "Create workspace"}
              <Icon.arrow width={16} height={16} stroke="currentColor"/>
            </button>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
            {mode === "login" ? "Trouble signing in?" : "Already have a workspace?"}{" "}
            <a className="wavy-link" href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "login" ? "signup" : "login"); }}>
              {mode === "login" ? "Reset password" : "Sign in"}
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}

function TrustChip({ icon, label }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "5px 10px", border: "1px solid var(--line-strong)", borderRadius: 999,
      fontSize: 12, color: "var(--ink-soft)", background: "var(--panel)",
    }}>{icon}{label}</span>
  );
}

// ============================================================================
// TENANT PICKER
// ============================================================================
function TenantPicker({ memberships, onPick, onCreate }) {
  const [type, setType] = useStateA(null); // null | 'Individual' | 'Company'
  const [segment, setSegment] = useStateA(null);

  const segmentsByType = {
    Individual: ["Freelancer", "Affiliater", "Member"],
    Company: ["Corporate", "Agency"],
  };

  const filtered = memberships.filter(m =>
    (!type || m.type === type) && (!segment || m.segment === segment)
  );

  return (
    <div style={{ position: "relative", maxWidth: 720, margin: "0 auto", paddingTop: 16 }}>
      <span className="label-eyebrow" style={{ color: "var(--cyan)" }}>/connect · step 01 · workspace</span>
      <h1 style={{
        fontFamily: "var(--font-display)", fontWeight: 800,
        fontSize: 44, lineHeight: 1.1, letterSpacing: "-0.02em",
        margin: "10px 0 16px",
      }}>
        {type ? `Pick your ${type.toLowerCase()} workspace.` : "Choose your account type."}
      </h1>
      <p style={{ fontSize: 15, color: "var(--ink-soft)", maxWidth: 560, marginTop: 0, marginBottom: 24 }}>
        {!type && "Two trees branch from here. Pick the one that matches how this account is used."}
        {type && !segment && `Narrow by segment, or skip to see every ${type.toLowerCase()} workspace you belong to.`}
        {type && segment && `Showing ${type} · ${segment} memberships.`}
      </p>

      {!type ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            { key: "Individual", accent: "var(--coral)", desc: "Solo operator: freelancer, affiliate, or club member.", segs: segmentsByType.Individual, icon: (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
            )},
            { key: "Company", accent: "var(--blue)", desc: "Multi-seat: corporate operations or service agency.", segs: segmentsByType.Company, icon: (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none"><rect x="3" y="6" width="18" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.6"/><path d="M3 10h18M9 14h2M13 14h2M9 17h2M13 17h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
            )},
          ].map((opt, i) => (
            <button key={opt.key} onClick={() => setType(opt.key)} className="panel" style={{
              padding: 24, position: "relative", overflow: "hidden",
              textAlign: "left", cursor: "pointer", color: "var(--ink)",
              transition: "all 160ms ease",
              animation: `fade-up 280ms ${i * 70}ms backwards ease`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "var(--shadow-2)"; e.currentTarget.style.borderColor = opt.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-1)"; e.currentTarget.style.borderColor = "var(--line)"; }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: opt.accent }}/>
              <div style={{
                width: 44, height: 44, borderRadius: 8,
                background: `color-mix(in srgb, ${opt.accent} 14%, var(--panel))`,
                color: opt.accent, display: "flex", alignItems: "center", justifyContent: "center",
                border: `1px solid color-mix(in srgb, ${opt.accent} 28%, var(--line))`,
                marginBottom: 14,
              }}>{opt.icon}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 6 }}>{opt.key}</div>
              <div style={{ fontSize: 13.5, color: "var(--ink-soft)", marginBottom: 14, lineHeight: 1.5 }}>{opt.desc}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {opt.segs.map(s => (
                  <span key={s} className="mono" style={{
                    padding: "3px 8px", borderRadius: 999, fontSize: 11,
                    background: "var(--fill)", color: "var(--ink-soft)",
                    border: "1px solid var(--line)",
                  }}>{s}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <button className="btn btn-quiet btn-sm" onClick={() => { setType(null); setSegment(null); }}>
              <Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: "rotate(180deg)" }}/> Type
            </button>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>·</span>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-soft)", fontWeight: 600 }}>{type}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>·</span>
            {segmentsByType[type].map(s => (
              <button key={s} onClick={() => setSegment(segment === s ? null : s)} style={{
                padding: "5px 11px", borderRadius: 999, fontSize: 11.5,
                fontFamily: "var(--font-mono)", letterSpacing: "0.04em", fontWeight: 600,
                background: segment === s ? "var(--ink)" : "transparent",
                color: segment === s ? "var(--fill)" : "var(--ink-soft)",
                border: `1px solid ${segment === s ? "var(--ink)" : "var(--line-strong)"}`,
                cursor: "pointer",
              }}>{s.toUpperCase()}</button>
            ))}
            {segment && (
              <button className="btn btn-quiet btn-xs" onClick={() => setSegment(null)} style={{ marginLeft: 4 }}>clear</button>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="panel" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
              No memberships in <span className="mono" style={{ color: "var(--ink-soft)" }}>{type} · {segment}</span>.
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-secondary btn-sm" onClick={onCreate}>+ Create new workspace</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {filtered.map((m, i) => {
                const typeColor = m.type === "Company" ? "var(--blue)" : "var(--coral)";
                return (
                <button key={m.tenant_id} onClick={() => onPick(m)} className="panel" style={{
                  display: "grid", gridTemplateColumns: "44px minmax(0, 1fr) auto auto", gap: 14, alignItems: "center",
                  padding: "14px 18px", textAlign: "left", border: "1px solid var(--line)",
                  cursor: "pointer", transition: "all 160ms ease",
                  color: "var(--ink)",
                  animation: `fade-up 320ms ${i * 60}ms backwards ease`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--blue)"; e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "var(--shadow-2)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "var(--shadow-1)"; }}>
                  <TenantSwatch tenant={m} size={44}/>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>{m.name}</div>
                    <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>{m.tenant_id} · {m.domain}</div>
                  </div>
                  <span style={{
                    padding: "3px 8px", borderRadius: 4, fontSize: 10.5, fontWeight: 700,
                    fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
                    background: `color-mix(in srgb, ${typeColor} 12%, var(--panel))`,
                    color: typeColor,
                    border: `1px solid color-mix(in srgb, ${typeColor} 28%, transparent)`,
                    whiteSpace: "nowrap",
                  }}>{m.segment.toUpperCase()}</span>
                  <Icon.arrow width={18} height={18} stroke="currentColor" style={{ color: "var(--muted)" }}/>
                </button>
              );})}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="btn btn-quiet btn-sm" onClick={onCreate}>+ Create new workspace</button>
        <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
          {type ? `${filtered.length} / ${memberships.length} shown` : `memberships.length = ${memberships.length}`}
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { ActivationRail, AuthStep, TenantPicker, TrustChip });
