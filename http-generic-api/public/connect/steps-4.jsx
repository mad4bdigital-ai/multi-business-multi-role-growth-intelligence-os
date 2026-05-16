/* global React */
const { useState: useStateE } = React;

// ============================================================================
// PERSONAL PREFERENCES — segment-aware (step 04)
// ============================================================================
function PreferencesStep({ tenant, session, onSave, onBack }) {
  const segment = tenant?.segment || "Freelancer";
  const isCompany = tenant?.type === "Company";

  const [tz, setTz] = useStateE("Africa/Cairo");
  const [language, setLanguage] = useStateE("English");
  const [currency, setCurrency] = useStateE("USD");
  const [comms, setComms] = useStateE(["email"]);
  const [tone, setTone] = useStateE("Direct");
  const [hours, setHours] = useStateE("Mornings");
  const [goals, setGoals] = useStateE([]);
  const [notify, setNotify] = useStateE("digest");

  // segment-specific extras
  const [niches, setNiches] = useStateE([]); // Freelancer
  const [networks, setNetworks] = useStateE([]); // Affiliater
  const [perks, setPerks] = useStateE([]); // Member
  const [seats, setSeats] = useStateE("11–50"); // Corporate
  const [services, setServices] = useStateE([]); // Agency

  const goalsBySegment = {
    Freelancer: ["Find clients", "Bill faster", "Automate proposals", "Track time"],
    Affiliater: ["Track conversions", "Find offers", "Optimize funnels", "Payout reports"],
    Member: ["Discover events", "Manage benefits", "Connect to peers", "Stay informed"],
    Corporate: ["Cut reporting time", "Forecast revenue", "Align teams", "Compliance"],
    Agency: ["Pitch faster", "Manage retainers", "Automate reports", "Cross-sell"],
  };

  const accent = isCompany ? "var(--blue)" : "var(--coral)";

  const SegmentExtras = () => {
    if (segment === "Freelancer") {
      return (
        <PrefSection title="Niches you serve" hint="Pick up to 4. Used to weight playbooks.">
          <ChipGroup options={["Brand strategy", "Web design", "SEO", "Copywriting", "Photography", "Dev", "Video", "Ads"]} value={niches} onChange={setNiches} multi max={4} accent={accent}/>
        </PrefSection>
      );
    }
    if (segment === "Affiliater") {
      return (
        <PrefSection title="Networks & verticals" hint="We pre-wire dashboards for what you actually run.">
          <ChipGroup options={["ClickBank", "ShareASale", "Impact", "PartnerStack", "Awin", "Direct"]} value={networks} onChange={setNetworks} multi accent={accent}/>
        </PrefSection>
      );
    }
    if (segment === "Member") {
      return (
        <PrefSection title="Perks you care about" hint="Surfaces matching events, drops, and benefits first.">
          <ChipGroup options={["Events", "Education", "Discounts", "Community", "Mentorship", "Gear"]} value={perks} onChange={setPerks} multi accent={accent}/>
        </PrefSection>
      );
    }
    if (segment === "Corporate") {
      return (
        <PrefSection title="Team size" hint="Right-sizes the org chart and approval flows.">
          <ChipGroup options={["1–10", "11–50", "51–200", "201–1000", "1000+"]} value={seats} onChange={setSeats} accent={accent}/>
        </PrefSection>
      );
    }
    if (segment === "Agency") {
      return (
        <PrefSection title="Service lines" hint="What you ship for clients. Drives templates & reports.">
          <ChipGroup options={["Performance ads", "SEO", "Content", "Social", "Brand", "Web build", "Email", "PR"]} value={services} onChange={setServices} multi accent={accent}/>
        </PrefSection>
      );
    }
    return null;
  };

  return (
    <div style={{ position: "relative" }}>
      <span className="label-eyebrow" style={{ color: accent }}>/connect · step 04 · personal preferences</span>
      <h1 style={{
        fontFamily: "var(--font-display)", fontWeight: 800,
        fontSize: 36, lineHeight: 1.06, letterSpacing: "-0.02em",
        margin: "8px 0 4px",
      }}>How should we tune the OS for you?</h1>
      <p style={{ fontSize: 14.5, color: "var(--ink-soft)", maxWidth: 620, marginBottom: 22 }}>
        Tailored to your <span className="mono" style={{ color: accent, fontWeight: 600 }}>{tenant?.type} · {segment}</span> profile. Every answer feeds the GPT's first turn — none of these block activation.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <PrefSection title="Working rhythm">
          <PrefRow label="Time zone"><input className="input" value={tz} onChange={(e) => setTz(e.target.value)}/></PrefRow>
          <PrefRow label="Language">
            <ChipGroup options={["English", "Arabic", "Spanish", "French"]} value={language} onChange={setLanguage} accent={accent}/>
          </PrefRow>
          <PrefRow label="Currency">
            <ChipGroup options={["USD", "EUR", "EGP", "GBP", "AED"]} value={currency} onChange={setCurrency} accent={accent}/>
          </PrefRow>
          <PrefRow label="Best hours">
            <ChipGroup options={["Mornings", "Afternoons", "Evenings", "Late night"]} value={hours} onChange={setHours} accent={accent}/>
          </PrefRow>
        </PrefSection>

        <PrefSection title="Voice & alerts">
          <PrefRow label="Communication">
            <ChipGroup options={["email", "slack", "whatsapp", "sms"]} value={comms} onChange={setComms} multi accent={accent}/>
          </PrefRow>
          <PrefRow label="GPT tone">
            <ChipGroup options={["Direct", "Coachy", "Punchy", "Formal"]} value={tone} onChange={setTone} accent={accent}/>
          </PrefRow>
          <PrefRow label="Notifications">
            <ChipGroup options={[
              { value: "realtime", label: "Real-time" },
              { value: "digest", label: "Daily digest" },
              { value: "weekly", label: "Weekly" },
              { value: "off", label: "Off" },
            ]} value={notify} onChange={setNotify} accent={accent}/>
          </PrefRow>
        </PrefSection>

        <PrefSection title={`Top goals for ${segment}`} hint="Pick the 2–3 outcomes you'd want first.">
          <ChipGroup options={goalsBySegment[segment]} value={goals} onChange={setGoals} multi max={3} accent={accent}/>
        </PrefSection>

        <SegmentExtras/>
      </div>

      <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button className="btn btn-quiet btn-sm" onClick={onBack}><Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: "rotate(180deg)" }}/> Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>POST /connect/preferences → metadata_json.onboarding_preferences</span>
          <button className="btn btn-primary" onClick={() => onSave({ tz, language, currency, comms, tone, hours, goals, notify, niches, networks, perks, seats, services })}>
            Save & continue <Icon.arrow width={14} height={14} stroke="currentColor"/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// BUSINESS PROFILE (step 06)
// ============================================================================
function BusinessProfileStep({ tenant, session, onSave, onBack }) {
  const accent = "var(--cyan)";
  const ownerMode = !!session?.owner;
  const [bizType, setBizType] = useStateE("Service");
  const [industry, setIndustry] = useStateE("Hospitality");
  const [brandVoice, setBrandVoice] = useStateE([]);
  const [tagline, setTagline] = useStateE("");
  const [story, setStory] = useStateE("");
  const [audience, setAudience] = useStateE("");

  const [locations, setLocations] = useStateE([
    { id: 1, name: "HQ · Cairo", address: "12 Talaat Harb St, Downtown, Cairo, EG", primary: true },
  ]);
  const [products, setProducts] = useStateE([
    { id: 1, name: "House blend espresso", sku: "NW-ESP-12", price: "$14", kind: "product" },
    { id: 2, name: "Wholesale subscription", sku: "NW-SUB-WH", price: "from $480/mo", kind: "service" },
  ]);

  const [socials, setSocials] = useStateE({
    instagram: "@northwind.coffee", x: "@northwindcoffee", linkedin: "company/northwind-coffee",
    facebook: "", tiktok: "", youtube: "", pinterest: "",
  });
  const [cms, setCms] = useStateE("WordPress");
  const [cmsUrl, setCmsUrl] = useStateE("https://northwind.coffee");
  const [cmsKey, setCmsKey] = useStateE("");
  const [analytics, setAnalytics] = useStateE(["GA4"]);

  // requested_scope governs what the CMS claim can do; non-owners requesting > read_only are queued for approval
  const [requestedScope, setRequestedScope] = useStateE("read_only");
  const claimRequiresApproval = !ownerMode && requestedScope !== "read_only" && cmsKey.length > 0;

  const addLocation = () => setLocations([...locations, { id: Date.now(), name: "New location", address: "", primary: false }]);
  const removeLocation = (id) => setLocations(locations.filter(l => l.id !== id));
  const addProduct = () => setProducts([...products, { id: Date.now(), name: "New offering", sku: "", price: "", kind: "product" }]);
  const removeProduct = (id) => setProducts(products.filter(p => p.id !== id));

  return (
    <div style={{ position: "relative" }}>
      <span className="label-eyebrow" style={{ color: accent }}>/connect · step 05 · business profile</span>
      <h1 style={{
        fontFamily: "var(--font-display)", fontWeight: 800,
        fontSize: 36, lineHeight: 1.06, letterSpacing: "-0.02em",
        margin: "8px 0 4px",
      }}>Tell {tenant?.name || "us"} apart.</h1>
      <p style={{ fontSize: 14.5, color: "var(--ink-soft)", maxWidth: 620, marginBottom: 22 }}>
        The brand DNA, where you operate, what you sell, and where you publish. The GPT uses this to write in-voice and pull the right metrics.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <PrefSection title="Business & brand">
          <PrefRow label="Business type">
            <ChipGroup options={["Product", "Service", "SaaS", "Marketplace", "Hybrid"]} value={bizType} onChange={setBizType} accent={accent}/>
          </PrefRow>
          <PrefRow label="Industry">
            <input className="input" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Hospitality, FinTech, B2B SaaS..."/>
          </PrefRow>
          <PrefRow label="Brand voice">
            <ChipGroup options={["Warm", "Bold", "Witty", "Premium", "Quiet", "Provocative"]} value={brandVoice} onChange={setBrandVoice} multi max={3} accent={accent}/>
          </PrefRow>
          <PrefRow label="Tagline">
            <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Slow coffee. Fast minds."/>
          </PrefRow>
          <PrefRow label="Brand story">
            <textarea className="input" rows={3} style={{ height: "auto", padding: "10px 12px", lineHeight: 1.5 }}
              value={story} onChange={(e) => setStory(e.target.value)}
              placeholder="3 sentences. Who you serve, why, and the unfair advantage."/>
          </PrefRow>
          <PrefRow label="Target audience">
            <input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Working professionals 28–45 in MENA cities..."/>
          </PrefRow>
        </PrefSection>

        <PrefSection title="Activity locations" hint="Where do you operate? Used for SEO, ad geo, and reporting splits.">
          {locations.map((l, i) => (
            <div key={l.id} className="panel" style={{
              padding: 12, marginBottom: 8, display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto", gap: 10, alignItems: "center",
            }}>
              <div style={{ minWidth: 0 }}>
                <input className="input" style={{ height: 34, marginBottom: 6, fontWeight: 600 }}
                  value={l.name} onChange={(e) => setLocations(locations.map(x => x.id === l.id ? {...x, name: e.target.value} : x))}/>
                <input className="input mono" style={{ height: 32, fontSize: 12 }}
                  value={l.address} placeholder="Street, city, country"
                  onChange={(e) => setLocations(locations.map(x => x.id === l.id ? {...x, address: e.target.value} : x))}/>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                {l.primary && <span className="mono" style={{ fontSize: 10, color: accent, fontWeight: 700 }}>PRIMARY</span>}
                <button className="btn btn-quiet btn-xs" onClick={() => removeLocation(l.id)} disabled={locations.length === 1}>Remove</button>
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={addLocation}>+ Add location</button>
        </PrefSection>

        <PrefSection title="Products & services" hint="Top items only. The GPT uses these to write copy and pull catalog data.">
          {products.map((p) => (
            <div key={p.id} className="panel" style={{
              padding: 12, marginBottom: 8, display: "grid",
              gridTemplateColumns: "minmax(0,1.2fr) 80px 100px auto", gap: 8, alignItems: "center",
            }}>
              <input className="input" style={{ height: 34, fontWeight: 600 }}
                value={p.name} onChange={(e) => setProducts(products.map(x => x.id === p.id ? {...x, name: e.target.value} : x))}/>
              <input className="input mono" style={{ height: 34, fontSize: 12 }}
                value={p.sku} placeholder="SKU"
                onChange={(e) => setProducts(products.map(x => x.id === p.id ? {...x, sku: e.target.value} : x))}/>
              <input className="input" style={{ height: 34, fontSize: 12 }}
                value={p.price} placeholder="Price"
                onChange={(e) => setProducts(products.map(x => x.id === p.id ? {...x, price: e.target.value} : x))}/>
              <button className="btn btn-quiet btn-xs" onClick={() => removeProduct(p.id)}>×</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={addProduct}>+ Add product / service</button>
        </PrefSection>

        <PrefSection title="Social profiles" hint="We monitor mentions and pull engagement metrics from these.">
          <SocialRow icon="IG" label="Instagram" value={socials.instagram} onChange={(v) => setSocials({...socials, instagram: v})} accent="#E1306C"/>
          <SocialRow icon="X" label="X (Twitter)" value={socials.x} onChange={(v) => setSocials({...socials, x: v})} accent="#1d1d1f"/>
          <SocialRow icon="LI" label="LinkedIn" value={socials.linkedin} onChange={(v) => setSocials({...socials, linkedin: v})} accent="#0a66c2"/>
          <SocialRow icon="FB" label="Facebook" value={socials.facebook} onChange={(v) => setSocials({...socials, facebook: v})} accent="#1877f2"/>
          <SocialRow icon="TT" label="TikTok" value={socials.tiktok} onChange={(v) => setSocials({...socials, tiktok: v})} accent="#000"/>
          <SocialRow icon="YT" label="YouTube" value={socials.youtube} onChange={(v) => setSocials({...socials, youtube: v})} accent="#ff0000"/>
        </PrefSection>

        <PrefSection title="CMS site & analytics" hint="Public site + analytics destination. These land in business_profile via /connect/profile.">
          <PrefRow label="CMS">
            <ChipGroup options={["WordPress", "Shopify", "Webflow", "Wix", "Custom", "None"]} value={cms} onChange={setCms} accent={accent}/>
          </PrefRow>
          <PrefRow label="Site URL">
            <input className="input mono" value={cmsUrl} onChange={(e) => setCmsUrl(e.target.value)} placeholder="https://..."/>
          </PrefRow>
          <PrefRow label="Analytics">
            <ChipGroup options={["GA4", "Plausible", "Mixpanel", "Amplitude", "None"]} value={analytics} onChange={setAnalytics} multi accent={accent}/>
          </PrefRow>
        </PrefSection>

        {/* CMS credential lives on a completely separate path — encrypted + DB-bound, never in metadata_json */}
        <div style={{ gridColumn: "1 / -1" }}>
          <CmsClaimBlock
            cms={cms} cmsKey={cmsKey} setCmsKey={setCmsKey}
            requestedScope={requestedScope} setRequestedScope={setRequestedScope}
            ownerMode={ownerMode} requiresApproval={claimRequiresApproval}
          />
        </div>
      </div>

      <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button className="btn btn-quiet btn-sm" onClick={onBack}><Icon.arrow width={14} height={14} stroke="currentColor" style={{ transform: "rotate(180deg)" }}/> Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>POST /connect/profile → metadata_json.business_profile</span>
            {cmsKey && (
              <span className="mono" style={{ fontSize: 11, color: "var(--coral)" }}>
                + POST /connect/api/cms/claims → credential_bindings (encrypted)
              </span>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => onSave(
            { bizType, industry, brandVoice, tagline, story, audience, locations, products, socials, cms, cmsUrl, analytics },
            cmsKey ? { cms, cmsKey, requestedScope } : null
          )}>
            Save & continue <Icon.arrow width={14} height={14} stroke="currentColor"/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// CMS CLAIM BLOCK — separate endpoint, encrypted, governed by requested_scope
// ============================================================================
function CmsClaimBlock({ cms, cmsKey, setCmsKey, requestedScope, setRequestedScope, ownerMode, requiresApproval }) {
  const [show, setShow] = useStateE(false);
  if (cms === "None") return null;

  const scopes = [
    { value: "read_only", label: "Read only", hint: "Pull posts, pages, analytics. Always auto-approved." },
    { value: "read_write", label: "Read & write", hint: "Publish drafts, update metadata. Owner approval if non-owner." },
    { value: "admin", label: "Admin", hint: "Plugins, users, theme. Always requires owner approval." },
  ];

  return (
    <div style={{
      position: "relative",
      padding: 18, borderRadius: 12,
      background: "linear-gradient(180deg, color-mix(in srgb, var(--coral) 5%, var(--panel)) 0%, var(--panel) 100%)",
      border: "1px solid color-mix(in srgb, var(--coral) 28%, var(--line-strong))",
    }}>
      <div style={{
        position: "absolute", top: -10, left: 16,
        display: "flex", alignItems: "center", gap: 6,
        padding: "3px 10px", background: "var(--coral)", color: "#fff",
        borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 10,
        fontWeight: 700, letterSpacing: "0.06em",
      }}>
        <Icon.shield width={12} height={12} stroke="currentColor"/>
        ENCRYPTED CREDENTIAL · SEPARATE PATH
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 20, marginTop: 6 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            {cms} API key / app password
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.55, marginBottom: 12 }}>
            Submitted to <span className="mono" style={{ color: "var(--coral)", fontWeight: 600 }}>/connect/api/cms/claims</span> —
            encrypted via <span className="mono">tokenEncryption.v2</span> and bound to a
            private <span className="mono">credential_bindings</span> row. Never serialized into
            <span className="mono"> metadata_json</span>; the GPT references it by binding ID only.
          </div>

          <label className="field-label">Key</label>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <input
              className="input mono"
              type={show ? "text" : "password"}
              value={cmsKey}
              onChange={(e) => setCmsKey(e.target.value)}
              placeholder={cms === "WordPress" ? "wp_xxxxxxxx (Application Password)" : "API key"}
              style={{ paddingRight: 64 }}
            />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="btn btn-quiet btn-xs"
              style={{ position: "absolute", right: 6, height: 26 }}
            >
              {show ? "Hide" : "Show"}
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            blocklist: <span style={{ color: "var(--ink-soft)" }}>password · secret · token · api_key · cmskey · …</span> dropped if mistakenly POSTed to /connect/profile
          </div>
        </div>

        <div>
          <label className="field-label">Requested scope</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scopes.map(s => {
              const sel = requestedScope === s.value;
              return (
                <button key={s.value}
                  onClick={() => setRequestedScope(s.value)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    background: sel ? "color-mix(in srgb, var(--coral) 10%, var(--panel))" : "var(--panel)",
                    border: `1px solid ${sel ? "var(--coral)" : "var(--line-strong)"}`,
                    borderRadius: 8, cursor: "pointer",
                    display: "grid", gridTemplateColumns: "16px 1fr", gap: 10, alignItems: "start",
                  }}>
                  <span style={{
                    width: 14, height: 14, borderRadius: "50%", marginTop: 2,
                    border: `2px solid ${sel ? "var(--coral)" : "var(--line-strong)"}`,
                    background: sel ? "var(--coral)" : "transparent",
                    boxShadow: sel ? "inset 0 0 0 3px var(--panel)" : "none",
                  }}/>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {s.label}
                      <span className="mono" style={{ fontSize: 10, color: "var(--muted)", marginLeft: 8, fontWeight: 500 }}>
                        requested_scope: "{s.value}"
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>{s.hint}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {requiresApproval && (
            <div style={{
              marginTop: 12, padding: "10px 12px",
              background: "color-mix(in srgb, var(--warn) 12%, var(--panel))",
              border: "1px solid color-mix(in srgb, var(--warn) 35%, var(--line))",
              borderRadius: 8,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "var(--warn)",
                marginTop: 5, flexShrink: 0,
                animation: "breath 2s ease-in-out infinite",
              }}/>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--ink)" }}>
                  Approval required
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2, lineHeight: 1.5 }}>
                  The claim will be encrypted and queued. The platform owner reviews <span className="mono">requested_scope: "{requestedScope}"</span> before the GPT can act on it. Read-only data still flows.
                </div>
              </div>
            </div>
          )}

          {ownerMode && cmsKey && (
            <div style={{
              marginTop: 12, padding: "10px 12px",
              background: "color-mix(in srgb, var(--coral) 10%, var(--panel))",
              border: "1px solid color-mix(in srgb, var(--coral) 35%, var(--line))",
              borderRadius: 8,
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <span style={{
                padding: "2px 7px", background: "var(--coral)", color: "#fff",
                borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
              }}>OWNER</span>
              <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
                Auto-approved · binding activates immediately at <span className="mono">status: "active"</span>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// shared atoms
// ============================================================================
function PrefSection({ title, hint, children }) {
  return (
    <div className="panel" style={{ padding: 18 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, letterSpacing: "-0.005em" }}>{title}</div>
        {hint && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function PrefRow({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label className="field-label">{label}</label>
      {children}
    </div>
  );
}

function ChipGroup({ options, value, onChange, multi, max, accent = "var(--blue)" }) {
  const isSelected = (v) => multi ? (Array.isArray(value) && value.includes(v)) : value === v;
  const toggle = (v) => {
    if (!multi) return onChange(v);
    const arr = Array.isArray(value) ? value : [];
    if (arr.includes(v)) onChange(arr.filter(x => x !== v));
    else if (!max || arr.length < max) onChange([...arr, v]);
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map((opt) => {
        const v = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? opt : opt.label;
        const sel = isSelected(v);
        return (
          <button key={v} onClick={() => toggle(v)} style={{
            padding: "6px 12px", borderRadius: 999, fontSize: 12.5,
            fontFamily: "var(--font-body)", fontWeight: 500,
            background: sel ? accent : "var(--panel)",
            color: sel ? "#fff" : "var(--ink-soft)",
            border: `1px solid ${sel ? accent : "var(--line-strong)"}`,
            cursor: "pointer", transition: "all 140ms ease",
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function SocialRow({ icon, label, value, onChange, accent }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <span style={{
        width: 32, height: 32, borderRadius: 6,
        background: `color-mix(in srgb, ${accent} 14%, var(--panel))`,
        color: accent, border: `1px solid color-mix(in srgb, ${accent} 30%, var(--line))`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
      }}>{icon}</span>
      <input className="input mono" style={{ height: 36, fontSize: 12.5 }}
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={`${label} handle or URL`}/>
    </div>
  );
}

Object.assign(window, { PreferencesStep, BusinessProfileStep, CmsClaimBlock, PrefSection, PrefRow, ChipGroup, SocialRow });
