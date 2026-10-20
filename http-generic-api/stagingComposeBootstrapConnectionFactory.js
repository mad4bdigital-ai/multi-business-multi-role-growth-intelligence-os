import path from "node:path";
import { spawn } from "node:child_process";

const SAFE_SERVICE_RE = /^[A-Za-z0-9_.-]+$/u;

function bridgeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

export function buildStagingComposeBridgeArgs({
  apiRoot,
  composeFiles,
  composeEnvFile,
  service,
}) {
  if (!apiRoot) {
    throw bridgeError(
      "staging_compose_bridge_api_root_required",
      "Staging Compose bridge requires apiRoot.",
    );
  }

  if (!Array.isArray(composeFiles) || composeFiles.length === 0) {
    throw bridgeError(
      "staging_compose_bridge_compose_files_required",
      "Staging Compose bridge requires repository-owned Compose files.",
    );
  }

  if (!composeEnvFile) {
    throw bridgeError(
      "staging_compose_bridge_env_file_required",
      "Staging Compose bridge requires the Staging environment file.",
    );
  }

  if (!SAFE_SERVICE_RE.test(String(service || ""))) {
    throw bridgeError(
      "staging_compose_bridge_service_invalid",
      "Staging Compose bridge service is invalid.",
    );
  }

  return [
    "compose",
    "--env-file",
    path.resolve(apiRoot, composeEnvFile),
    ...composeFiles.flatMap((file) => ["-f", path.resolve(apiRoot, file)]),
    "exec",
    "-T",
    service,
    "node",
    "/app/scripts/staging-bootstrap-db-bridge.mjs",
  ];
}

function remoteBridgeError(payload) {
  return bridgeError(
    payload?.error?.code || "staging_compose_db_bridge_request_failed",
    "Staging Compose database bridge request failed.",
    {
      mysql_code: payload?.error?.mysql_code || null,
      mysql_state: payload?.error?.mysql_state || null,
    },
  );
}

export function createStagingComposeBootstrapConnectionFactory({
  apiRoot,
  composeFiles,
  composeEnvFile,
  service,
  spawnImpl = spawn,
  requestTimeoutMs = 30000,
} = {}) {
  const args = buildStagingComposeBridgeArgs({
    apiRoot,
    composeFiles,
    composeEnvFile,
    service,
  });

  return async function stagingComposeBootstrapConnectionFactory({
    credentials,
    database,
  }) {
    const child = spawnImpl("docker", args, {
      cwd: apiRoot,
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (!child?.stdin || !child?.stdout || !child?.stderr) {
      throw bridgeError(
        "staging_compose_db_bridge_spawn_invalid",
        "Docker Compose database bridge did not expose bounded stdio.",
      );
    }

    child.stdout.setEncoding?.("utf8");
    child.stderr.setEncoding?.("utf8");

    let nextId = 1;
    let stdoutBuffer = "";
    let exited = false;
    const pending = new Map();

    const rejectAll = (error) => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);

      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;

        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);

        if (!line) continue;

        let payload;
        try {
          payload = JSON.parse(line);
        } catch {
          rejectAll(
            bridgeError(
              "staging_compose_db_bridge_protocol_invalid",
              "Staging Compose database bridge emitted invalid protocol output.",
            ),
          );
          continue;
        }

        const entry = pending.get(payload.id);
        if (!entry) continue;

        pending.delete(payload.id);
        clearTimeout(entry.timer);

        if (payload.ok === true) entry.resolve(payload);
        else entry.reject(remoteBridgeError(payload));
      }
    });

    // Drain diagnostics but never expose them in the public error envelope.
    child.stderr.on("data", () => {});

    child.on("error", () => {
      exited = true;
      rejectAll(
        bridgeError(
          "staging_compose_db_bridge_spawn_failed",
          "Staging Compose database bridge could not be started.",
        ),
      );
    });

    child.on("exit", (code) => {
      exited = true;
      if (pending.size > 0) {
        rejectAll(
          bridgeError(
            "staging_compose_db_bridge_exited",
            "Staging Compose database bridge exited before completing a request.",
            { exit_code: Number.isInteger(code) ? code : null },
          ),
        );
      }
    });

    const request = (operation, body = {}) => {
      if (exited) {
        return Promise.reject(
          bridgeError(
            "staging_compose_db_bridge_not_running",
            "Staging Compose database bridge is not running.",
          ),
        );
      }

      const id = nextId++;

      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          try { child.kill(); } catch {}
          reject(
            bridgeError(
              "staging_compose_db_bridge_timeout",
              "Staging Compose database bridge request timed out.",
            ),
          );
        }, requestTimeoutMs);

        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ id, operation, ...body })}\n`);
      });
    };

    try {
      await request("connect", {
        credentials: {
          host: credentials.host,
          port: Number(credentials.port || 3306),
          user: credentials.user,
          password: credentials.password,
          database: database || credentials.database,
        },
      });
    } catch (error) {
      try { child.stdin.end(); } catch {}
      try { child.kill(); } catch {}
      throw error;
    }

    const invoke = async (operation, sql, params = []) => {
      const result = await request(operation, { sql, params });
      return [result.rows, []];
    };

    return {
      query(sql, params = []) {
        return invoke("query", sql, params);
      },

      execute(sql, params = []) {
        return invoke("execute", sql, params);
      },

      async end() {
        if (exited) return;
        try {
          await request("close");
        } finally {
          try { child.stdin.end(); } catch {}
        }
      },
    };
  };
}
