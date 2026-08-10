import assert from "node:assert/strict";
import {
  dispatchWordpressBlogPublish,
  diagnoseWordpressPublishAuthority,
  isWordpressBlogPublishWorkflow,
  __test__,
} from "./wordpressBlogPublishOrchestrator.js";

function makePool({ brands = [], connections = [], cmsSites = [], cmsGrants = [], workspaceGrants = [], envelopes = [], insertedIntake = [], envelopeUpdates = [] } = {}) {
  return {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, " ");
      if (compact.includes("FROM `brands`")) {
        const [targetKey, normalizedBrandName, brandName, brandDomain] = params;
        return [brands.filter((row) => (
          row.target_key === targetKey ||
          row.normalized_brand_name === normalizedBrandName ||
          row.brand_name === brandName ||
          row.brand_domain === brandDomain
        )).slice(0, 1)];
      }
      if (compact.includes("FROM `cms_sites`")) {
        const [targetKey, domain] = params;
        return [cmsSites.filter((row) => row.canonical_target_key === targetKey || row.normalized_domain === domain).slice(0, 1)];
      }
      if (compact.includes("FROM `cms_site_access_grants`")) {
        const [siteId, tenantId, userId] = params;
        return [cmsGrants.filter((row) => (
          row.site_id === siteId &&
          row.tenant_id === tenantId &&
          row.status === "active" &&
          (!row.user_id || row.user_id === userId)
        )).slice(0, 1)];
      }
      if (compact.includes("FROM v_workspace_resource_grant_effective")) {
        const [tenantId, userId, siteId, workspaceRef] = params;
        return [workspaceGrants.filter((row) => (
          row.tenant_id === tenantId &&
          row.grantee_user_id === userId &&
          row.grant_status === "active" &&
          ((row.resource_type === "site" && row.resource_ref === siteId) || (row.resource_type === "workspace" && row.resource_ref === workspaceRef))
        ))];
      }
      if (compact.includes("FROM capability_resolution_envelope_ledger")) {
        const [envelopeId] = params;
        return [envelopes.filter((row) => row.envelope_id === envelopeId).slice(0, 1)];
      }
      if (compact.includes("UPDATE capability_resolution_envelope_ledger")) {
        envelopeUpdates.push({ sql: compact, params });
        return [{ affectedRows: 1, changedRows: 1 }];
      }
      if (compact.includes("FROM `credential_bindings`")) return [[]];
      if (compact.includes("FROM `user_app_connections`")) {
        const [connectionId] = params;
        return [connections.filter((row) => row.connection_id === connectionId).slice(0, 1)];
      }
      if (compact.includes("FROM `actions`")) return [[]];
      if (compact.includes("FROM `tenant_secrets`")) return [[]];
      if (compact.includes("FROM `platform_secrets`")) return [[]];
      if (compact.includes("INSERT INTO credential_intake_sessions")) {
        insertedIntake.push({ sql: compact, params });
        return [{ affectedRows: 1, insertId: insertedIntake.length }];
      }
      return [[]];
    },
  };
}

function readyEnvelope(overrides = {}) {
  return {
    envelope_id: "env-ready-wordpress",
    tenant_id: "tenant-1",
    user_id: "user-1",
    app_key: "wordpress_rest",
    capability_key: "wordpress_create_post",
    operation_intent: "write",
    envelope_status: "ready_for_dispatch",
    decision: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 1,
    approval_required: 0,
    quota_required: 0,
    audit_required: 1,
    readback_required: 1,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    secrets_included: 0,
    ...overrides,
  };
}

const brand = {
  brand_name: "Almallah Group",
  normalized_brand_name: "almallah group",
  brand_domain: "tourism.almallahgroup-mg.com",
  target_key: "almallah_wp",
  base_url: "https://tourism.almallahgroup-mg.com/wp-json",
  default_wp_api_base: "https://tourism.almallahgroup-mg.com/wp-json/wp/v2",
  default_post_type_slug: "posts",
  write_allowed: "TRUE",
  status: "Active",
};

assert.equal(isWordpressBlogPublishWorkflow("wordpress_blog_publish_or_recover_credentials_workflow"), true);
assert.equal(isWordpressBlogPublishWorkflow("wf_wordpress_content_ops"), false);
assert.equal(__test__.normalizeWpJsonBase("https://example.com/wp-json"), "https://example.com/wp-json/wp/v2");
assert.equal(__test__.normalizeWpJsonBase("https://example.com/wp-json/wp/v2"), "https://example.com/wp-json/wp/v2");

{
  const insertedIntake = [];
  const pool = makePool({ brands: [brand], insertedIntake });
  const result = await dispatchWordpressBlogPublish(
    {
      plan_id: "plan-missing-credential",
      tenant_id: "tenant-1",
      user_id: "user-1",
      brand_key: "Almallah Group",
      target_key: "almallah_wp",
      workflow_key: "wordpress_blog_publish_or_recover_credentials_workflow",
      title: "7 أسباب تجعل رحلة النيل في مصر تجربة لا تُنسى",
      content: "<p>محتوى المقال التجريبي.</p>",
    },
    { pool, env: {}, decryptCredentials: JSON.parse }
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "credential_intake_required");
  assert.equal(result.target_key, "almallah_wp");
  assert.equal(result.intake.app_key, "wordpress_rest");
  assert.match(result.intake.intake_url, /^https:\/\/auth\.mad4b\.com\/credential-intake\//);
  assert.equal(insertedIntake.length, 1);
  assert.equal(insertedIntake[0].params[4], "wordpress_rest");
  assert.equal(insertedIntake[0].params[5], "basic_auth");
}

{
  const pool = makePool({
    brands: [brand],
    cmsSites: [{ site_id: "site-1", canonical_target_key: "almallah_wp", normalized_domain: "tourism.almallahgroup-mg.com" }],
    connections: [{
      connection_id: "conn-wp",
      user_id: "user-1",
      tenant_id: "tenant-1",
      app_key: "wordpress_rest",
      auth_type: "basic_auth",
      encrypted_credentials: JSON.stringify({ username: "gpt", application_password: "wp-app-password" }),
      account_label: "gpt",
      status: "active",
    }],
  });
  const result = await dispatchWordpressBlogPublish(
    {
      plan_id: "plan-site-grant-missing",
      tenant_id: "tenant-1",
      user_id: "user-1",
      brand_key: "Almallah Group",
      target_key: "almallah_wp",
      workflow_key: "wordpress_blog_publish_or_recover_credentials_workflow",
      steps_json: JSON.stringify([{ body: { connection_id: "conn-wp" } }]),
      title: "Nile Cruise Egypt",
      content: "<p>Draft post content.</p>",
      status: "draft",
    },
    { pool, fetch: async () => { throw new Error("fetch must not be called without grant"); }, decryptCredentials: JSON.parse, env: {} }
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.error.code, "cms_site_access_grant_required");
  assert.equal(result.site_id, "site-1");
  assert.equal(result.grant_required, true);
}

{
  const calls = [];
  const envelopeUpdates = [];
  const pool = makePool({
    brands: [brand],
    cmsSites: [{ site_id: "site-1", canonical_target_key: "almallah_wp", normalized_domain: "tourism.almallahgroup-mg.com" }],
    cmsGrants: [{ grant_id: "grant-1", site_id: "site-1", tenant_id: "tenant-1", user_id: "user-1", scope: "personal", status: "active", draft_allowed: 1, publish_allowed: 0 }],
    workspaceGrants: [{ grant_id: "wrg-1", tenant_id: "tenant-1", grantee_user_id: "user-1", resource_type: "site", resource_ref: "site-1", permission: "edit", grant_status: "active" }],
    envelopes: [readyEnvelope()],
    envelopeUpdates,
    connections: [{
      connection_id: "conn-wp",
      user_id: "user-1",
      tenant_id: "tenant-1",
      app_key: "wordpress_rest",
      auth_type: "basic_auth",
      encrypted_credentials: JSON.stringify({ username: "gpt", application_password: "wp-app-password" }),
      account_label: "gpt",
      status: "active",
    }],
  });
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(url, "https://tourism.almallahgroup-mg.com/wp-json/wp/v2/posts");
    assert.equal(options.method, "POST");
    assert.match(options.headers.Authorization, /^Basic /);
    const body = JSON.parse(options.body);
    assert.equal(body.title, "Nile Cruise Egypt");
    assert.equal(body.status, "draft");
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify({ id: 123, link: "https://tourism.almallahgroup-mg.com/nile-cruise-egypt/", status: "draft", type: "post" });
      },
    };
  };
  const result = await dispatchWordpressBlogPublish(
    {
      plan_id: "plan-resolved-credential",
      tenant_id: "tenant-1",
      user_id: "user-1",
      brand_key: "Almallah Group",
      target_key: "almallah_wp",
      workflow_key: "wordpress_blog_publish_or_recover_credentials_workflow",
      steps_json: JSON.stringify([{ body: { connection_id: "conn-wp", capability_envelope_id: "env-ready-wordpress" } }]),
      title: "Nile Cruise Egypt",
      content: "<p>Draft post content.</p>",
      status: "draft",
    },
    { pool, lifecycleWriterPool: pool, fetch, decryptCredentials: JSON.parse, env: {} }
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.credential_status, "resolved");
  assert.equal(result.post_id, 123);
  assert.equal(result.link, "https://tourism.almallahgroup-mg.com/nile-cruise-egypt/");
  assert.equal(result.readback_status, "created_response_contains_id");
  assert.equal(calls.length, 1);
  assert.equal(envelopeUpdates.length, 1, "WordPress execution must use the explicitly injected lifecycle writer for envelope reference mutation");
}

{
  const pool = makePool({
    brands: [brand],
    cmsSites: [{ site_id: "site-1", canonical_target_key: "almallah_wp", normalized_domain: "tourism.almallahgroup-mg.com" }],
    connections: [{
      connection_id: "conn-wp",
      user_id: "user-1",
      tenant_id: "tenant-1",
      app_key: "wordpress_rest",
      auth_type: "basic_auth",
      encrypted_credentials: JSON.stringify({ username: "gpt", application_password: "wp-app-password" }),
      account_label: "gpt",
      status: "active",
    }],
  });
  const result = await diagnoseWordpressPublishAuthority(
    {
      tenant_id: "tenant-1",
      user_id: "user-1",
      brand_key: "Almallah Group",
      target_key: "almallah_wp",
      connection_id: "conn-wp",
      title: "Nile Cruise Egypt",
      content: "<p>Draft post content.</p>",
      status: "publish",
    },
    { pool, fetch: async () => { throw new Error("diagnostic must not call WordPress"); }, decryptCredentials: JSON.parse, env: {} }
  );
  assert.equal(result.ok, false);
  assert.equal(result.decision, "blocked");
  assert.equal(result.error.code, "cms_site_access_grant_required");
  assert.equal(result.executes_publish, false);
  assert.equal(result.applies_wordpress_post, false);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool({
    brands: [brand],
    cmsSites: [{ site_id: "site-1", canonical_target_key: "almallah_wp", normalized_domain: "tourism.almallahgroup-mg.com" }],
    cmsGrants: [{ grant_id: "grant-2", site_id: "site-1", tenant_id: "tenant-1", user_id: "user-1", scope: "personal", status: "active", draft_allowed: 1, publish_allowed: 1 }],
    workspaceGrants: [{ grant_id: "wrg-2", tenant_id: "tenant-1", grantee_user_id: "user-1", resource_type: "workspace", resource_ref: "tenant-1", permission: "operate", grant_status: "active" }],
    connections: [{
      connection_id: "conn-wp",
      user_id: "user-1",
      tenant_id: "tenant-1",
      app_key: "wordpress_rest",
      auth_type: "basic_auth",
      encrypted_credentials: JSON.stringify({ username: "gpt", application_password: "wp-app-password" }),
      account_label: "gpt",
      status: "active",
    }],
  });
  const result = await diagnoseWordpressPublishAuthority(
    {
      tenant_id: "tenant-1",
      user_id: "user-1",
      brand_key: "Almallah Group",
      target_key: "almallah_wp",
      connection_id: "conn-wp",
      title: "Nile Cruise Egypt",
      content: "<p>Publish post content.</p>",
      status: "publish",
    },
    { pool, fetch: async () => { throw new Error("diagnostic must not call WordPress"); }, decryptCredentials: JSON.parse, env: {} }
  );
  assert.equal(result.ok, true);
  assert.equal(result.decision, "allowed");
  assert.equal(result.grant_id, "grant-2");
  assert.equal(result.authority_checks.active_grant, true);
  assert.equal(result.executes_publish, false);
  assert.equal(result.secrets_included, false);
}

{
  const pool = makePool({
    brands: [brand],
    envelopes: [readyEnvelope({ envelope_id: "env-upstream-error" })],
    connections: [{
      connection_id: "conn-wp",
      user_id: "user-1",
      tenant_id: "tenant-1",
      app_key: "wordpress_rest",
      auth_type: "basic_auth",
      encrypted_credentials: JSON.stringify({ username: "gpt", application_password: "wp-app-password" }),
      account_label: "gpt",
      status: "active",
    }],
  });
  const fetch = async () => ({
    ok: false,
    status: 401,
    async text() {
      return JSON.stringify({ code: "incorrect_password", message: "The provided password is an invalid application password." });
    },
  });
  await assert.rejects(
    () => dispatchWordpressBlogPublish(
      {
        plan_id: "plan-upstream-error",
        tenant_id: "tenant-1",
        user_id: "user-1",
        brand_key: "Almallah Group",
        target_key: "almallah_wp",
        workflow_key: "wordpress_blog_publish_or_recover_credentials_workflow",
        steps_json: JSON.stringify([{ body: { connection_id: "conn-wp", capability_envelope_id: "env-upstream-error" } }]),
        title: "Nile Cruise Egypt",
        content: "<p>Draft post content.</p>",
        status: "draft",
      },
      { pool, lifecycleWriterPool: pool, fetch, decryptCredentials: JSON.parse, env: {} }
    ),
    /HTTP 401\. code=incorrect_password message=The provided password is an invalid application password\./
  );
}

console.log("wordpress blog publish orchestrator tests passed");