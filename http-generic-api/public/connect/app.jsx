/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakRadio */
const { useState, useEffect } = React;

const GOOGLE_CLIENT_ID_CONFIG = window.__GOOGLE_CLIENT_ID__ || '';

function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = localStorage.getItem('mad4b_connect_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(path, { ...opts, headers })
    .then(r => r.json().catch(() => ({})).then(data => ({ ok: r.ok, status: r.status, data })));
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.theme);
    root.setAttribute('data-type', t.type);
    root.setAttribute('data-accent', t.accent);
    root.setAttribute('data-density', t.density);
  }, [t]);

  const [step, setStep] = useState('auth');
  const [session, setSession] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [authError, setAuthError] = useState('');
  const [deviceId, setDeviceId] = useState('nagy-mbp-m4');
  const [connections, setConnections] = useState({ cloudflare: 'not_connected', hostinger: 'not_connected', device: 'not_connected', launch: 'not_connected' });
  const [completed, setCompleted] = useState(new Set());
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [log, setLog] = useState([]);
  const [showLaunchToast, setShowLaunchToast] = useState(false);

  const pushLog = (entry) => setLog(l => [...l, { ...entry, t: Date.now() }]);

  const applyStatusData = (data) => {
    const u = data.user;
    if (!u) return false;
    const ownerFromTenant = data.tenant?.role === 'owner';
    setSession({ email: u.email, name: u.display_name || u.email, owner: ownerFromTenant, user_id: u.user_id });
    setAuthError('');
    if (data.tenant?.tenant_id) {
      const color = ['coral','cyan','lime','blue'][Math.floor(Math.random()*4)];
      const m = [{ tenant_id: data.tenant.tenant_id, name: data.tenant.display_name || data.tenant.tenant_id, role: data.tenant.role || 'member', role_label: (data.tenant.role||'member').charAt(0).toUpperCase()+(data.tenant.role||'member').slice(1), color, initial: (data.tenant.display_name||'T')[0].toUpperCase(), domain: '', type: 'Company', segment: 'Corporate' }];
      setMemberships(m);
      setTenant(m[0]);
      setCompleted(new Set(['auth','tenant']));
      if (data.connection?.status === 'active') {
        setConnections(c => ({ ...c, cloudflare: 'connected', hostinger: 'connected' }));
      }
      if (data.devices?.length > 0) {
        setConnections(c => ({ ...c, device: 'installed_here' }));
        setDeviceId(data.devices[0].device_id);
      }
      return true;
    }
    setCompleted(new Set(['auth']));
    return false;
  };

  // Restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('mad4b_connect_token');
    if (!token) return;
    apiFetch('/connect/status').then(({ ok, data }) => {
      if (!ok) { localStorage.removeItem('mad4b_connect_token'); return; }
      const hasTenant = applyStatusData(data);
      setStep(hasTenant ? 'hub' : 'tenant');
    }).catch(() => {});
  }, []);

  // Google OAuth setup
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID_CONFIG || step !== 'auth') return;
    let tries = 0;
    const setup = () => {
      if (!window.google?.accounts?.id) { if (tries++ < 20) setTimeout(setup, 300); return; }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID_CONFIG,
        callback: async (response) => {
          const { ok, data } = await apiFetch('/auth/google', { method: 'POST', body: JSON.stringify({ id_token: response.credential }) });
          pushLog({ method: 'POST', path: '/auth/google/callback', status: ok ? 200 : 401, ms: 184, body: ok ? { ok: true } : data });
          if (!ok) { setAuthError(data?.error?.message || 'Google sign-in failed'); return; }
          localStorage.setItem('mad4b_connect_token', data.token);
          await loadSession();
        },
      });
      const container = document.getElementById('gsi-btn-container');
      if (container) window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', width: 320, text: 'signin_with', locale: 'en' });
    };
    setup();
  }, [step]);

  const loadSession = async () => {
    const { ok, data } = await apiFetch('/connect/status');
    if (!ok) return;
    const hasTenant = applyStatusData(data);
    const mems = data.memberships_count > 1 ? SAMPLE_MEMBERSHIPS : [];
    if (mems.length > 1 && !hasTenant) { setMemberships(mems); setStep('tenant'); }
    else setStep('hub');
    setEvidenceOpen(true);
    setTimeout(() => setEvidenceOpen(false), 2400);
  };

  const handleSignIn = async ({ provider, email, name, mode, password }) => {
    setAuthError('');
    if (provider === 'google') return; // handled by GSI callback
    const path = mode === 'signup' ? '/auth/register' : '/auth/login';
    const body = mode === 'signup' ? { display_name: name || email.split('@')[0], email, password } : { email, password };
    const { ok, data } = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    pushLog({ method: 'POST', path, status: ok ? 200 : 401, ms: 184, body: ok ? { ok: true, user_id: data.user_id } : { error: data?.error?.message } });
    if (!ok) { setAuthError(data?.error?.message || 'Authentication failed'); return; }
    localStorage.setItem('mad4b_connect_token', data.token);
    await loadSession();
  };

  const handlePickTenant = (m) => {
    setTenant(m);
    // Drive owner-mode UI (CMS claim auto-approval, owner badge) from the
    // selected membership's role rather than email pattern.
    setSession(s => s ? { ...s, owner: m.role === 'owner' } : s);
    pushLog({ method: 'POST', path: '/auth/select-tenant', status: 200, ms: 92, body: { ok: true, tenant_id: m.tenant_id, role: m.role } });
    setCompleted(prev => new Set([...prev, 'tenant']));
    setStep('hub');
  };

  const handleSaveCredentials = async () => {
    const { ok, data } = await apiFetch('/connect/activate', { method: 'POST', body: JSON.stringify({ mode: 'managed', cloudflare_mode: 'managed', google_auth_mode: 'managed' }) });
    pushLog({ method: 'POST', path: '/connect/activate', status: ok ? 200 : 500, ms: 142, body: ok ? { ok: true } : { error: data?.error?.message } });
    if (ok) { setConnections(c => ({ ...c, cloudflare: 'connected', hostinger: 'connected' })); setCompleted(prev => new Set([...prev, 'credentials'])); setStep('preferences'); }
  };

  const handleSavePreferences = async (prefs) => {
    if (tenant) {
      const { ok, status, data } = await apiFetch('/connect/preferences', { method: 'POST', body: JSON.stringify({ tenant_id: tenant.tenant_id, ...prefs }) });
      pushLog({
        method: 'POST', path: '/connect/preferences', status: status || (ok ? 201 : 500), ms: 88,
        body: {
          ok,
          tenant_id: data?.tenant_id || tenant.tenant_id,
          dropped_fields: data?.dropped_fields || [],
          stored: { onboarding_preferences: prefs },
        },
      });
    }
    setCompleted(prev => new Set([...prev, 'preferences']));
    setStep('business');
  };

  // profile is the business-profile form payload; cmsCredential (optional) is
  // routed to the encrypted /connect/api/cms/claims path so the cmsKey never
  // lands in metadata_json. Server returns dropped_fields[] from the allowlist
  // sanitizer; we surface that in the evidence drawer.
  const handleSaveBusiness = async (profile, cmsCredential) => {
    if (tenant) {
      const { ok, status, data } = await apiFetch('/connect/profile', { method: 'POST', body: JSON.stringify({ tenant_id: tenant.tenant_id, ...profile }) });
      pushLog({
        method: 'POST', path: '/connect/profile', status: status || (ok ? 201 : 500), ms: 134,
        body: {
          ok,
          tenant_id: data?.tenant_id || tenant.tenant_id,
          dropped_fields: data?.dropped_fields || [],
          stored: { business_profile: profile },
        },
      });
    }

    if (cmsCredential && cmsCredential.cmsKey && tenant) {
      const claimBody = {
        site_url: profile.cmsUrl || '',
        username: session?.email || '',
        application_password: cmsCredential.cmsKey,
        requested_scope: cmsCredential.requestedScope || 'read_only',
      };
      const { ok: claimOk, status: claimStatus, data: claimData } = await apiFetch('/connect/api/cms/claims', { method: 'POST', body: JSON.stringify(claimBody) });
      pushLog({
        method: 'POST', path: '/connect/api/cms/claims', status: claimStatus || (claimOk ? 201 : 500), ms: 156,
        body: claimOk ? {
          ok: true,
          claim_id: claimData?.claim_id,
          connection_id: claimData?.connection_id,
          matched_brand_key: claimData?.matched_brand_key,
          match_confidence: claimData?.match_confidence,
          approval_required: claimData?.approval_required === true,
          next_action: claimData?.next_action,
          // server NEVER reflects the application_password back
        } : { ok: false, error: claimData?.error },
      });
    }

    setCompleted(prev => new Set([...prev, 'business']));
    setStep('hub');
  };

  const handleDeviceComplete = async () => {
    if (tenant) {
      const { ok, data } = await apiFetch('/connect/device-install', { method: 'POST', body: JSON.stringify({ device_id: deviceId }) });
      pushLog({ method: 'POST', path: '/connect/device-install', status: ok ? 201 : 500, ms: 312, body: ok ? data : { error: data?.error?.message } });
    }
    setConnections(c => ({ ...c, device: 'installed_here' }));
    setCompleted(prev => new Set([...prev, 'device']));
  };

  const handleLaunch = () => { setStep('launch'); };

  const handleOpenGpt = () => {
    pushLog({ method: 'GET', path: '/connect/launch', status: 302, ms: 12, body: { redirect: 'https://chatgpt.com/g/g-mad4b-growth-intel' } });
    setShowLaunchToast(true);
    setTimeout(() => setShowLaunchToast(false), 3500);
  };

  const handleSignOut = () => {
    localStorage.removeItem('mad4b_connect_token');
    setSession(null); setTenant(null); setMemberships([]); setCompleted(new Set());
    setConnections({ cloudflare: 'not_connected', hostinger: 'not_connected', device: 'not_connected', launch: 'not_connected' });
    setStep('auth');
  };

  const gptReady = connections.cloudflare === 'connected' && connections.hostinger === 'connected' && connections.device === 'installed_here';
  const onMesh = step === 'auth';

  // Auth is now a gate — returning to the sign-in screen requires explicit
  // Sign out from the top bar. The step jumper never shows 'auth' and goto()
  // refuses to navigate to it.
  const goto = (key) => {
    if (!session || !tenant) return;
    if (key === 'auth') return;
    setStep(key);
  };

  return (
    <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden' }}>
      <MeshBackdrop active={onMesh}/>
      <div style={{ position: 'relative', zIndex: 2 }}>
        <TopBar session={session} tenant={tenant} gptReady={gptReady} onSwitchTenant={() => setStep('tenant')} onLaunchGpt={handleLaunch} onSignOut={handleSignOut} onOpenEvidence={() => setEvidenceOpen(true)}/>
        {session && tenant && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: '12px 0 0', flexWrap: 'wrap' }}>
            {STEPS.filter(s => s.key !== 'credentials').map(s => (
              <button key={s.key} onClick={() => goto(s.key)} style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', background: step === s.key ? 'var(--ink)' : 'transparent', color: step === s.key ? 'var(--panel)' : 'var(--muted)', border: `1px solid ${step === s.key ? 'var(--ink)' : 'var(--line)'}`, cursor: 'pointer' }}>
                {s.num} · {s.label}
              </button>
            ))}
          </div>
        )}
        <main style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 28px 80px' }}>
          {step === 'auth' && <div style={{ paddingTop: 24 }}><AuthStep onSignIn={handleSignIn} error={authError}/></div>}
          {step === 'tenant' && <TenantPicker memberships={memberships} onPick={handlePickTenant} onCreate={() => setStep('auth')}/>}
          {['hub','credentials','preferences','business','device','launch'].includes(step) && session && tenant && (
            <div className="hub-grid" style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 32, paddingTop: 8 }}>
              <ActivationRail currentStep={step} completed={completed} session={session} tenant={tenant} deviceId={deviceId}/>
              <section>
                {step === 'hub' && <ActivationHub session={session} tenant={tenant} connections={connections} setConnections={setConnections} onLaunch={handleLaunch} pushLog={pushLog}/>}
                {step === 'credentials' && <CredentialVault connections={connections} onSave={handleSaveCredentials} onBack={() => setStep('hub')}/>}
                {step === 'preferences' && <PreferencesStep tenant={tenant} onSave={handleSavePreferences} onBack={() => setStep('credentials')}/>}
                {step === 'business' && <BusinessProfileStep tenant={tenant} onSave={handleSaveBusiness} onBack={() => setStep('preferences')}/>}
                {step === 'device' && <DeviceInstall tenant={tenant} deviceId={deviceId} setDeviceId={setDeviceId} onComplete={handleDeviceComplete} onBack={() => setStep('hub')} completed={connections.device === 'installed_here'}/>}
                {step === 'launch' && <GptLaunch session={session} tenant={tenant} deviceId={deviceId} connections={connections} onLaunch={handleOpenGpt} onBack={() => setStep('hub')} userToken={localStorage.getItem('mad4b_connect_token')}/>}
              </section>
            </div>
          )}
        </main>
        <footer style={{ textAlign: 'center', padding: '20px 28px', fontSize: 11.5, color: 'var(--muted)', borderTop: '1px solid var(--line)', marginTop: 12, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, letterSpacing: 0, color: 'var(--ink)' }}>
            Growth Intelligence Platform
          </div>
          <div style={{ marginTop: 6 }}>
            <a className="wavy-link" href="/privacy-policy">Privacy Policy</a>
            <span aria-hidden="true"> · </span>
            <a className="wavy-link" href="/terms-of-use">Terms of Use</a>
          </div>
          <div style={{ marginTop: 6 }}>
            governed-registry execution system · Human-Managed Platform · created by Essam Nagy
          </div>
        </footer>
      </div>
      <EvidenceDrawer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} log={log} style={t.evidence}/>
      {showLaunchToast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--ink)', color: 'var(--panel)', padding: '12px 18px', borderRadius: 10, zIndex: 80, display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, boxShadow: 'var(--shadow-3)', animation: 'fade-up 280ms ease' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--lime)' }}/>
          Redirecting to your Growth Intelligence GPT in a new tab.
        </div>
      )}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Surface">
          <TweakRadio label="Theme" value={t.theme} onChange={(v) => setTweak('theme', v)}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}/>
          <TweakRadio label="Density" value={t.density} onChange={(v) => setTweak('density', v)}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}/>
        </TweakSection>
        <TweakSection title="Type pairing">
          <TweakRadio label="Stack" value={t.type} onChange={(v) => setTweak('type', v)} options={[{ value: 'manrope-inter', label: 'Manrope+Inter' }, { value: 'geist', label: 'Geist' }, { value: 'instrument', label: 'Instrument' }]}/>
        </TweakSection>
        <TweakSection title="Energy accents">
          <TweakRadio label="Set" value={t.accent} onChange={(v) => setTweak('accent', v)} options={[{ value: 'default', label: 'Spark' }, { value: 'cool', label: 'Cool' }, { value: 'hot', label: 'Hot' }, { value: 'mono', label: 'Mono' }]}/>
        </TweakSection>
        <TweakSection title="Evidence console">
          <TweakRadio label="Style" value={t.evidence} onChange={(v) => setTweak('evidence', v)}
            options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}/>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
