/* global React, ReactDOM, useTweaks, TweaksPanel, TweakSection, TweakRadio */
const { useState, useEffect } = React;

const GOOGLE_CLIENT_ID_CONFIG = window.__GOOGLE_CLIENT_ID__ || '';
const WORDPRESS_STAGING_ORIGIN = 'https://staging.egypttourgates.com';

function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const token = localStorage.getItem('mad4b_connect_token');
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return fetch(path, { ...opts, headers })
    .then(r => r.json().catch(() => ({})).then(data => ({ ok: r.ok, status: r.status, data })));
}

function normalizeMemberships(items = []) {
  const colors = ['coral', 'cyan', 'lime', 'blue'];
  return (Array.isArray(items) ? items : []).map((m, index) => {
    const name = m.name || m.display_name || m.tenant_id || 'Workspace';
    const role = m.role || 'member';
    return {
      tenant_id: m.tenant_id,
      name,
      role,
      role_label: m.role_label || role.charAt(0).toUpperCase() + role.slice(1),
      color: m.color || colors[index % colors.length],
      initial: m.initial || name[0]?.toUpperCase() || 'T',
      domain: m.domain || '',
      type: m.type || 'Company',
      segment: m.segment || 'Workspace',
    };
  });
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
  const [connectionLifecycle, setConnectionLifecycle] = useState([]);
  const [completed, setCompleted] = useState(new Set());
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [log, setLog] = useState([]);
  const [showLaunchToast, setShowLaunchToast] = useState(false);

  const pushLog = (entry) => setLog(l => [...l, { ...entry, t: Date.now() }]);

  const loadConnectionLifecycle = async () => {
    const { ok, status, data } = await apiFetch('/connect/api/connections/lifecycle');
    pushLog({ method: 'GET', path: '/connect/api/connections/lifecycle', status: status || (ok ? 200 : 500), ms: 0, body: ok ? { ok: true, counts: data?.counts } : { error: data?.error?.code } });
    if (!ok) {
      if (data?.error?.code === 'tenant_context_required') setStep('tenant');
      return [];
    }
    const items = Array.isArray(data?.items) ? data.items : [];
    setConnectionLifecycle(items);
    return items;
  };

  const applyStatusData = (data, knownMemberships = memberships) => {
    const u = data.user;
    if (!u) return false;
    const ownerFromTenant = data.tenant?.role === 'owner';
    setSession({ email: u.email, name: u.display_name || u.email, owner: ownerFromTenant, user_id: u.user_id });
    setAuthError('');
    if (data.tenant?.tenant_id) {
      const current = knownMemberships.find(m => m.tenant_id === data.tenant.tenant_id)
        || normalizeMemberships([{ tenant_id: data.tenant.tenant_id, name: data.tenant.display_name || data.tenant.tenant_id, role: data.tenant.role || 'member' }])[0];
      setTenant(current);
      setCompleted(new Set(['auth','tenant']));
      if (data.connection?.status === 'active') {
        // Activation is not the same as provider validation. Legacy cards keep the
        // active signal while the lifecycle panel below shows the authoritative state.
        setConnections(c => ({ ...c, cloudflare: 'connected', hostinger: 'connected' }));
      }
      if (data.devices?.length > 0) {
        setConnections(c => ({ ...c, device: 'installed_here' }));
        setDeviceId(data.devices[0].device_id);
      }
      return true;
    }
    setTenant(null);
    setCompleted(new Set(['auth']));
    return false;
  };

  const loadSession = async (contextRebound = false) => {
    const contextResult = await apiFetch('/connect/api/contexts');
    if (!contextResult.ok) {
      if (contextResult.status === 401) {
        localStorage.removeItem('mad4b_connect_token');
        setSession(null);
        setTenant(null);
        setMemberships([]);
        setStep('auth');
      }
      return;
    }

    const contextData = contextResult.data || {};
    const mems = normalizeMemberships(contextData.memberships || []);
    setMemberships(mems);
    if (contextData.user) {
      setSession({
        email: contextData.user.email,
        name: contextData.user.display_name || contextData.user.email,
        owner: false,
        user_id: contextData.user.user_id,
      });
    }

    if (contextData.context_required) {
      setTenant(null);
      setCompleted(new Set(['auth']));
      setStep('tenant');
      return;
    }

    // A newly created or legacy single-membership session may not yet carry a
    // tenant claim. Rebind it once so all following calls are context-explicit.
    if (!contextData.active_tenant_id && mems.length === 1 && !contextRebound) {
      const rebound = await apiFetch('/connect/api/active-context', {
        method: 'POST',
        body: JSON.stringify({ tenant_id: mems[0].tenant_id }),
      });
      if (rebound.ok && rebound.data?.token) {
        localStorage.setItem('mad4b_connect_token', rebound.data.token);
        return loadSession(true);
      }
    }

    const { ok, data } = await apiFetch('/connect/status');
    if (!ok) return;
    const hasTenant = applyStatusData(data, mems);
    if (hasTenant) await loadConnectionLifecycle();
    setStep(hasTenant ? 'hub' : 'tenant');
    setEvidenceOpen(true);
    setTimeout(() => setEvidenceOpen(false), 2400);
  };

  // Restore session on mount through the canonical identity→context ladder.
  useEffect(() => {
    const token = localStorage.getItem('mad4b_connect_token');
    if (!token) return;
    loadSession().catch(() => {});
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
      // Let GIS choose the locale from the signed-in Google Account or browser.
      if (container) window.google.accounts.id.renderButton(container, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
    };
    setup();
  }, [step]);

  const handleSignIn = async ({ provider, email, name, mode, password, tenant_display_name }) => {
    setAuthError('');
    if (provider === 'google') return; // handled by GSI callback
    const path = mode === 'signup' ? '/auth/register' : '/auth/login';
    const body = mode === 'signup'
      ? { display_name: name || email.split('@')[0], tenant_display_name, email, password }
      : { email, password };
    const { ok, data } = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
    pushLog({ method: 'POST', path, status: ok ? 200 : 401, ms: 184, body: ok ? { ok: true, user_id: data.user_id } : { error: data?.error?.message } });
    if (!ok) { setAuthError(data?.error?.message || 'Authentication failed'); return; }
    localStorage.setItem('mad4b_connect_token', data.token);
    await loadSession();
  };

  const handlePickTenant = async (m) => {
    setAuthError('');
    const { ok, status, data } = await apiFetch('/connect/api/active-context', {
      method: 'POST',
      body: JSON.stringify({ tenant_id: m.tenant_id }),
    });
    pushLog({ method: 'POST', path: '/connect/api/active-context', status: status || (ok ? 200 : 500), ms: 0, body: ok ? { ok: true, tenant_id: m.tenant_id, context_revalidated: true } : { error: data?.error?.code } });
    if (!ok || !data?.token) {
      setAuthError(data?.error?.message || 'Could not switch workspace context.');
      return;
    }
    localStorage.setItem('mad4b_connect_token', data.token);
    await loadSession(true);
  };

  const handleCreateWorkspace = async () => {
    const displayName = `${session?.name || 'My'} workspace`;
    const { ok, status, data } = await apiFetch('/connect/workspace', { method: 'POST', body: JSON.stringify({ display_name: displayName }) });
    pushLog({ method: 'POST', path: '/connect/workspace', status: status || (ok ? 201 : 500), ms: 118, body: ok ? { ok: true, tenant: data.tenant } : { error: data?.error?.message } });
    if (!ok) { setAuthError(data?.error?.message || 'Could not create workspace'); return; }
    await loadSession();
  };

  const handleSaveCredentials = async () => {
    const { ok, data } = await apiFetch('/connect/activate', { method: 'POST', body: JSON.stringify({ mode: 'managed', cloudflare_mode: 'managed', google_auth_mode: 'managed' }) });
    pushLog({ method: 'POST', path: '/connect/activate', status: ok ? 200 : 500, ms: 142, body: ok ? { ok: true, validation: 'pending_readback' } : { error: data?.error?.message } });
    if (ok) {
      // Do not translate activation acceptance into provider validation.
      setConnections(c => ({ ...c, cloudflare: 'in_progress', hostinger: 'in_progress' }));
      setCompleted(prev => new Set([...prev, 'credentials']));
      await loadConnectionLifecycle();
      setStep('preferences');
    }
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
  // lands in metadata_json. WordPress Staging additionally receives a credentialless
  // MCP federation connection bound to #7958/#6 and validated through fixed metadata URLs.
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

    const normalizedCmsUrl = String(profile?.cmsUrl || '').replace(/\/$/, '');
    if (tenant && normalizedCmsUrl === WORDPRESS_STAGING_ORIGIN) {
      const prepared = await apiFetch('/connect/api/wordpress-mcp/prepare', {
        method: 'POST',
        body: JSON.stringify({ site_url: normalizedCmsUrl }),
      });
      pushLog({
        method: 'POST', path: '/connect/api/wordpress-mcp/prepare', status: prepared.status || (prepared.ok ? 201 : 500), ms: 0,
        body: prepared.ok ? { ok: true, connection_id: prepared.data?.connection_id, lifecycle_state: prepared.data?.lifecycle_state } : { error: prepared.data?.error?.code },
      });
      if (prepared.ok && prepared.data?.connection_id) {
        const validated = await apiFetch('/connect/api/wordpress-mcp/validate', {
          method: 'POST',
          body: JSON.stringify({ connection_id: prepared.data.connection_id }),
        });
        pushLog({
          method: 'POST', path: '/connect/api/wordpress-mcp/validate', status: validated.status || (validated.ok ? 200 : 500), ms: 0,
          body: { ok: validated.ok, validation_status: validated.data?.validation_status, blockers: validated.data?.blockers || [] },
        });
      }
    }

    await loadConnectionLifecycle();
    setCompleted(prev => new Set([...prev, 'business']));
    setStep('hub');
  };

  const handleDeviceComplete = async () => {
    if (!tenant) return;
    const { ok, data } = await apiFetch('/connect/device-install', { method: 'POST', body: JSON.stringify({ device_id: deviceId }) });
    pushLog({ method: 'POST', path: '/connect/device-install', status: ok ? 201 : 500, ms: 312, body: ok ? data : { error: data?.error?.message } });
    if (!ok) {
      setConnections(c => ({ ...c, device: 'needs_attention' }));
      return;
    }
    setConnections(c => ({ ...c, device: 'installed_here' }));
    setCompleted(prev => new Set([...prev, 'device']));
    await loadConnectionLifecycle();
  };

  const handleDisconnectConnection = async (connectionId) => {
    const response = await apiFetch(`/connect/api/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    pushLog({ method: 'DELETE', path: `/connect/api/connections/${connectionId}`, status: response.status || (response.ok ? 204 : 500), ms: 0, body: response.ok ? { ok: true, status: 'revoked' } : { error: response.data?.error?.code } });
    if (response.ok) await loadConnectionLifecycle();
  };

  const handleValidateLifecycleConnection = async (item) => {
    if (item?.federation_profile !== 'wordpress_staging_mcp_rs256_v1') return;
    const result = await apiFetch('/connect/api/wordpress-mcp/validate', {
      method: 'POST',
      body: JSON.stringify({ connection_id: item.connection_id }),
    });
    pushLog({ method: 'POST', path: '/connect/api/wordpress-mcp/validate', status: result.status || (result.ok ? 200 : 500), ms: 0, body: { ok: result.ok, validation_status: result.data?.validation_status, blockers: result.data?.blockers || [] } });
    await loadConnectionLifecycle();
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
    setConnectionLifecycle([]);
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
          {step === 'tenant' && session && !tenant && memberships.length === 0 && <CreateWorkspacePanel session={session} onCreate={handleCreateWorkspace}/>} 
          {step === 'tenant' && !(session && !tenant && memberships.length === 0) && <TenantPicker memberships={memberships} onPick={handlePickTenant} onCreate={handleCreateWorkspace}/>}
          {['hub','credentials','preferences','business','device','launch'].includes(step) && session && tenant && (
            <div className="hub-grid" style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 32, paddingTop: 8 }}>
              <ActivationRail currentStep={step} completed={completed} session={session} tenant={tenant} deviceId={deviceId}/>
              <section>
                {step === 'hub' && <>
                  <ConnectionLifecyclePanel items={connectionLifecycle} onRefresh={loadConnectionLifecycle} onDisconnect={handleDisconnectConnection} onValidate={handleValidateLifecycleConnection}/>
                  <ActivationHub session={session} tenant={tenant} connections={connections} setConnections={setConnections} onLaunch={handleLaunch} pushLog={pushLog}/>
                </>}
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
            Growth Intelligence Platform · Connection & Recovery Center
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

function ConnectionLifecyclePanel({ items = [], onRefresh, onDisconnect, onValidate }) {
  const labels = {
    active_pending_validation: 'VALIDATION_PENDING',
    validated_ready: 'READY',
    in_use: 'IN_USE',
    token_expiring: 'TOKEN_EXPIRING',
    reauth_required: 'REAUTH_REQUIRED',
    managed_ready: 'MANAGED_READY',
    needs_attention: 'NEEDS_ATTENTION',
    revoked: 'REVOKED',
  };
  return (
    <div className="panel" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <span className="label-eyebrow">Connection lifecycle</span>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 5 }}>
            Connected is not treated as ready until validation/readback proves it.
          </div>
        </div>
        <button className="btn btn-secondary" onClick={onRefresh} style={{ height: 34, padding: '0 12px' }}>Refresh</button>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {items.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No tenant connection records yet.</div>}
        {items.map(item => (
          <div key={`${item.source_kind}:${item.connection_id}`} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 13, display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <strong style={{ fontSize: 13.5 }}>{item.display_label || item.app_key}</strong>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--muted)', marginTop: 3 }}>{item.source_kind} · {item.connection_id}</div>
              </div>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700 }}>{labels[item.lifecycle_state] || String(item.lifecycle_state || 'UNKNOWN').toUpperCase()}</span>
            </div>
            {item.federation_profile && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Federation: {item.federation_profile} · subject binding {item.subject_binding_verified ? 'verified' : 'pending'}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {item.federation_profile === 'wordpress_staging_mcp_rs256_v1' && item.lifecycle_state !== 'revoked' && (
                <button className="btn btn-secondary" onClick={() => onValidate(item)} style={{ height: 32, padding: '0 11px' }}>Validate</button>
              )}
              {item.source_kind === 'user_app_connection' && item.lifecycle_state !== 'revoked' && (
                <button className="btn btn-secondary" onClick={() => onDisconnect(item.connection_id)} style={{ height: 32, padding: '0 11px' }}>Disconnect</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateWorkspacePanel({ session, onCreate }) {
  return (
    <div className="panel" style={{ maxWidth: 720, margin: '24px auto 0', padding: 30, textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
      <span className="label-eyebrow" style={{ color: 'var(--coral)' }}>/connect · workspace required</span>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 38, lineHeight: 1.08, letterSpacing: '-0.02em', margin: '10px 0 12px' }}>
        Create a workspace to continue activation.
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55, maxWidth: 560 }}>
        You are signed in as <strong>{session?.email}</strong>, but this account is not attached to a workspace yet.
        Create one now so activation, device setup, support escalation, and GPT tools have a tenant context.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={onCreate} style={{ height: 44 }}>
          Create workspace
          <Icon.arrow width={16} height={16} stroke="currentColor"/>
        </button>
      </div>
      <span style={{ position: 'absolute', top: -28, right: -22, width: 84, height: 84, background: 'var(--lime)', opacity: 0.22, borderRadius: 8, transform: 'rotate(15deg)' }} aria-hidden/>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);