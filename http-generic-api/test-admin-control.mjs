import { handleEnvControl, handleWindowsAppControl, parseArgs, requireAdminPrincipal } from "./routes/adminCliRoutes.js";

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

const originalSecret = process.env.ADMIN_CONTROL_TEST_SECRET;
const originalPlain = process.env.ADMIN_CONTROL_TEST_PLAIN;

try {
  console.log("\n== admin control helpers");

  assert("parseArgs preserves array entries", JSON.stringify(parseArgs(["a", "b c"])) === JSON.stringify(["a", "b c"]));
  assert("parseArgs splits simple strings", JSON.stringify(parseArgs("repo list")) === JSON.stringify(["repo", "list"]));
  assert("parseArgs rejects empty input", parseArgs("").length === 0);

  handleEnvControl({ action: "set", name: "ADMIN_CONTROL_TEST_SECRET", value: "super-secret" });
  handleEnvControl({ action: "set", name: "ADMIN_CONTROL_TEST_PLAIN", value: "plain-value" });

  const maskedSecret = handleEnvControl({ action: "get", name: "ADMIN_CONTROL_TEST_SECRET" });
  const revealedSecret = handleEnvControl({ action: "get", name: "ADMIN_CONTROL_TEST_SECRET", reveal_values: true });
  const plain = handleEnvControl({ action: "get", name: "ADMIN_CONTROL_TEST_PLAIN" });
  const listed = handleEnvControl({ action: "list" });

  assert("env get masks sensitive variable names", maskedSecret.value === "[masked]", JSON.stringify(maskedSecret));
  assert("env get can reveal sensitive values when requested", revealedSecret.value === "super-secret", JSON.stringify(revealedSecret));
  assert("env get returns non-sensitive values", plain.value === "plain-value", JSON.stringify(plain));
  assert("env list includes keys", listed.keys.includes("ADMIN_CONTROL_TEST_SECRET"));

  const unset = handleEnvControl({ action: "unset", name: "ADMIN_CONTROL_TEST_PLAIN" });
  assert("env unset reports existing variable", unset.existed === true, JSON.stringify(unset));

  {
    try {
      handleWindowsAppControl({}, { env: {}, platform: "win32" });
      assert("windows app control disabled by default", false);
    } catch (error) {
      assert("windows app control disabled by default", error.code === "local_windows_app_control_disabled", error.message);
    }
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({
        notepad: { display_name: "Notepad", command: "notepad.exe", args: [] }
      })
    };
    const listed = handleWindowsAppControl({ action: "list" }, { env, platform: "win32" });
    assert("windows app list returns allowlisted app", listed.apps.length === 1 && listed.apps[0].alias === "notepad", JSON.stringify(listed));
    assert("windows app list does not expose command", !JSON.stringify(listed).includes("notepad.exe"), JSON.stringify(listed));
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      K_SERVICE: "http-generic-api",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({ notepad: "notepad.exe" })
    };
    try {
      handleWindowsAppControl({ action: "list" }, { env, platform: "win32" });
      assert("windows app control blocks gcloud runtime", false);
    } catch (error) {
      assert("windows app control blocks gcloud runtime", error.code === "local_windows_app_control_gcloud_blocked", error.message);
    }
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({ notepad: "notepad.exe" })
    };
    try {
      handleWindowsAppControl({ action: "launch", app_alias: "cmd" }, { env, platform: "win32" });
      assert("windows app launch requires allowlisted alias", false);
    } catch (error) {
      assert("windows app launch requires allowlisted alias", error.code === "windows_app_not_allowlisted", error.message);
    }
  }

  {
    const env = {
      LOCAL_WINDOWS_APP_CONTROL_ENABLED: "true",
      LOCAL_WINDOWS_APP_ALLOWLIST: JSON.stringify({
        notepad: { display_name: "Notepad", command: "notepad.exe", args: [] }
      })
    };
    const spawned = [];
    const result = handleWindowsAppControl(
      { action: "launch", app_alias: "notepad" },
      {
        env,
        platform: "win32",
        spawn(command, args, options) {
          spawned.push({ command, args, options });
          return { pid: 1234, unref() {} };
        }
      }
    );
    assert("windows app launch uses allowlisted command", spawned[0]?.command === "notepad.exe", JSON.stringify(spawned));
    assert("windows app launch does not use shell", spawned[0]?.options?.shell === false, JSON.stringify(spawned));
    assert("windows app launch returns alias", result.launched === true && result.app_alias === "notepad", JSON.stringify(result));
  }

  {
    let responseStatus = null;
    let responseBody = null;
    let nextCalled = false;

    requireAdminPrincipal(
      { auth: { mode: "user_jwt", is_admin: false } },
      {
        status(status) {
          responseStatus = status;
          return this;
        },
        json(body) {
          responseBody = body;
          return this;
        }
      },
      () => {
        nextCalled = true;
      }
    );

    assert("admin guard rejects user JWT principal", nextCalled === false);
    assert("admin guard returns admin-only code", responseStatus === 403 && responseBody?.error?.code === "admin_backend_api_key_required", JSON.stringify(responseBody));
  }

  {
    let nextCalled = false;
    requireAdminPrincipal(
      { auth: { mode: "backend_api_key", is_admin: true } },
      {},
      () => {
        nextCalled = true;
      }
    );
    assert("admin guard accepts backend admin principal", nextCalled === true);
  }
} finally {
  if (originalSecret === undefined) {
    delete process.env.ADMIN_CONTROL_TEST_SECRET;
  } else {
    process.env.ADMIN_CONTROL_TEST_SECRET = originalSecret;
  }

  if (originalPlain === undefined) {
    delete process.env.ADMIN_CONTROL_TEST_PLAIN;
  } else {
    process.env.ADMIN_CONTROL_TEST_PLAIN = originalPlain;
  }
}

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("ALL ADMIN CONTROL TESTS PASS");
