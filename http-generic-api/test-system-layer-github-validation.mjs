/**
 * Focused regression tests for activation GitHub validation target safety.
 *
 * Run: node test-system-layer-github-validation.mjs
 */

import assert from "node:assert/strict";

process.env.OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID = "1Q14wcuaz6G6MEDEh9CiQtwE03kpatQbf";
delete process.env.GITHUB_REPO;

const { activationGithubValidate } = await import("./routes/systemLayerRoutes.js");

{
  let called = false;
  const result = await activationGithubValidate(
    { github_owner: "mad4bdigital-ai", github_repo: "1Q14wcuaz6G6MEDEh9CiQtwE03kpatQbf" },
    {},
    {
      executionFacade: {
        execute: async () => {
          called = true;
          return { status: 200, body: {} };
        },
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "activation_github_artifact_binding_rejected");
  assert.equal(result.details?.env_key, "OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID");
  assert.equal(called, false);
}

{
  let capturedRequest = null;
  const result = await activationGithubValidate(
    {},
    {
      github_parent_action_key: "github_api_mcp",
      github_endpoint_key: "getRepositoryContent",
      github_owner: "mad4bdigital-ai",
      github_repo: "multi-business-multi-role-growth-intelligence-os",
      github_branch: "main",
    },
    {
      executionFacade: {
        execute: async (request) => {
          capturedRequest = request;
          return {
            status: 200,
            body: {
              full_name: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
              default_branch: "main",
              private: true,
            },
          };
        },
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.attempted_binding.endpoint_key, "github_get_repository");
  assert.equal(result.attempted_binding.configured_endpoint_key, "getRepositoryContent");
  assert.equal(capturedRequest.credential_scope, "platform");
  assert.deepEqual(capturedRequest.path_params, {
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
  });
}

{
  let called = false;
  const result = await activationGithubValidate(
    {},
    {},
    {
      executionFacade: {
        execute: async () => {
          called = true;
          return { status: 200, body: {} };
        },
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "activation_github_binding_missing");
  assert.equal(called, false);
}

{
  const result = await activationGithubValidate(
    {},
    {
      github_parent_action_key: "github_api_mcp",
      github_endpoint_key: "github_get_repository",
      github_owner: "mad4bdigital-ai",
      github_repo: "multi-business-multi-role-growth-intelligence-os",
      github_branch: "main",
    },
    {
      executionFacade: {
        execute: async () => ({
          status: 500,
          body: {
            ok: false,
            error: {
              code: "github_app_auth_invalid_private_key",
              message: "GitHub App private key could not be parsed.",
              status: 500,
              details: {
                cause_code: "ERR_OSSL_PEM_NO_START_LINE",
                cause_message: "error detail without key material",
                expected_prefixes: ["-----BEGIN RSA PRIVATE KEY-----"],
                key_shape: {
                  raw_length: 9,
                  normalized_length: 9,
                  starts_with_pem_header: false,
                  looks_like_pem: false,
                },
              },
            },
          },
        }),
      },
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, "github_app_auth_invalid_private_key");
  assert.equal(result.details?.cause_code, "ERR_OSSL_PEM_NO_START_LINE");
  assert.equal(result.details?.key_shape?.starts_with_pem_header, false);
  assert.equal(result.details?.cause_message, undefined, "provider result omits low-level message text");
}

console.log("[PASS] system layer GitHub activation validation target safety");
