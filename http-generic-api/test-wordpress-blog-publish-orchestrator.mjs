import assert from "node:assert/strict";
import {
  dispatchWordpressBlogPublish,
  isWordpressBlogPublishWorkflow,
  __test__,
} from "./wordpressBlogPublishOrchestrator.js";

function makePool({ brands = [], connections = [], insertedIntake = [] } = {}) {
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
  const calls = [];
  const pool = makePool({
    brands: [brand],
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
      steps_json: JSON.stringify([{ body: { connection_id: "conn-wp" } }]),
      title: "Nile Cruise Egypt",
      content: "<p>Draft post content.</p>",
      status: "draft",
    },
    { pool, fetch, decryptCredentials: JSON.parse, env: {} }
  );
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.credential_status, "resolved");
  assert.equal(result.post_id, 123);
  assert.equal(result.link, "https://tourism.almallahgroup-mg.com/nile-cruise-egypt/");
  assert.equal(result.readback_status, "created_response_contains_id");
  assert.equal(calls.length, 1);
}

{
  const pool = makePool({
    brands: [brand],
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
        steps_json: JSON.stringify([{ body: { connection_id: "conn-wp" } }]),
        title: "Nile Cruise Egypt",
        content: "<p>Draft post content.</p>",
        status: "draft",
      },
      { pool, fetch, decryptCredentials: JSON.parse, env: {} }
    ),
    /HTTP 401\. code=incorrect_password message=The provided password is an invalid application password\./
  );
}

console.log("wordpress blog publish orchestrator tests passed");
