/**
 * Transport governance regression tests.
 * Run: node test-transport-governance.mjs
 */

import { resolveBrand } from "./registryResolution.js";
import { requireTransportIfDelegated } from "./registryTransportGovernance.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

section("resolveBrand honors configurable transport");

{
  const brand = resolveBrand(
    [
      {
        brand_name: "Configurable Transport Brand",
        normalized_brand_name: "configurable transport brand",
        target_key: "brand_1",
        transport_enabled: "TRUE",
        transport_action_key: "custom_transport"
      }
    ],
    { target_key: "brand_1" },
    {
      allowedTransportKey: "custom_transport",
      boolFromSheet(value) {
        return String(value || "").trim().toUpperCase() === "TRUE";
      },
      jsonParseSafe(_value, fallback) {
        return fallback;
      }
    }
  );

  assert(
    "brand resolves when transport key matches configured allowed transport",
    brand?.target_key === "brand_1",
    JSON.stringify(brand)
  );
}

{
  let error = null;
  try {
    resolveBrand(
      [
        {
          brand_name: "Wrong Transport Brand",
          normalized_brand_name: "wrong transport brand",
          target_key: "brand_2",
          transport_enabled: "TRUE",
          transport_action_key: "custom_transport"
        }
      ],
      { target_key: "brand_2" },
      {
        allowedTransportKey: "http_generic_api",
        boolFromSheet(value) {
          return String(value || "").trim().toUpperCase() === "TRUE";
        },
        jsonParseSafe(_value, fallback) {
          return fallback;
        }
      }
    );
  } catch (err) {
    error = err;
  }

  assert(
    "brand resolution still rejects unsupported transport keys",
    error?.code === "unsupported_transport",
    JSON.stringify(error)
  );
}

section("requireTransportIfDelegated honors configurable transport");

{
  let error = null;
  try {
    requireTransportIfDelegated(
      [
        {
          policy_group: "Execution Capability Governance",
          policy_key: "Require Transport For Delegated Actions",
          policy_value: "TRUE",
          active: "TRUE"
        },
        {
          policy_group: "HTTP Execution Governance",
          policy_key: "Allowed Transport",
          policy_value: "custom_transport",
          active: "TRUE"
        }
      ],
      {
        action_key: "custom_transport",
        primary_executor: "custom_executor"
      },
      {
        endpoint_key: "delegated_endpoint",
        execution_mode: "http_delegated",
        transport_required: "TRUE",
        transport_action_key: "custom_transport"
      },
      {
        boolFromSheet(value) {
          return String(value || "").trim().toUpperCase() === "TRUE";
        }
      }
    );
  } catch (err) {
    error = err;
  }

  assert("configured transport executor is accepted", error === null, JSON.stringify(error));
}

{
  let error = null;
  try {
    requireTransportIfDelegated(
      [
        {
          policy_group: "Execution Capability Governance",
          policy_key: "Require Transport For Delegated Actions",
          policy_value: "TRUE",
          active: "TRUE"
        },
        {
          policy_group: "HTTP Execution Governance",
          policy_key: "Allowed Transport",
          policy_value: "custom_transport",
          active: "TRUE"
        }
      ],
      {
        action_key: "other_action",
        primary_executor: "custom_executor"
      },
      {
        endpoint_key: "delegated_endpoint",
        execution_mode: "http_delegated",
        transport_required: "TRUE",
        transport_action_key: "custom_transport"
      },
      {
        boolFromSheet(value) {
          return String(value || "").trim().toUpperCase() === "TRUE";
        }
      }
    );
  } catch (err) {
    error = err;
  }

  assert(
    "non-transport executor is rejected when no http backend executor is present",
    error?.code === "transport_executor_mismatch",
    JSON.stringify(error)
  );
}

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("ALL TRANSPORT GOVERNANCE TESTS PASS");
  process.exit(0);
}

console.error(`${failed} TEST(S) FAILED`);
process.exit(1);
