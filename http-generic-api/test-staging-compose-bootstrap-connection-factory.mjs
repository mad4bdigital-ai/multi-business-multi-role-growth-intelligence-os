import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  buildStagingComposeBridgeArgs,
  createStagingComposeBootstrapConnectionFactory,
} from "./stagingComposeBootstrapConnectionFactory.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function fakeSpawnFactory(calls, received) {
  return (command, args, options) => {
    calls.push({ command, args, options });

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    let buffer = "";

    const respond = (payload) => {
      child.stdout.write(`${JSON.stringify(payload)}\n`);
    };

    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        buffer += String(chunk);

        for (;;) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) break;

          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);

          if (!line.trim()) continue;

          const request = JSON.parse(line);
          received.push(request);

          if (request.operation === "connect") {
            respond({ id: request.id, ok: true });
          } else if (request.operation === "query") {
            respond({
              id: request.id,
              ok: true,
              rows: [{ query_ok: 1 }],
            });
          } else if (request.operation === "execute") {
            respond({
              id: request.id,
              ok: true,
              rows: { affectedRows: 0 },
            });
          } else if (request.operation === "close") {
            respond({ id: request.id, ok: true });
            setImmediate(() => child.emit("exit", 0));
          }
        }

        callback();
      },
    });

    child.kill = () => child.emit("exit", 1);

    return child;
  };
}

test("Compose bridge keeps DB credentials out of docker argv", async () => {
  const calls = [];
  const received = [];
  const secret = "do-not-place-in-argv";

  const factory = createStagingComposeBootstrapConnectionFactory({
    apiRoot: HERE,
    composeFiles: [
      "docker-compose.yml",
      "docker-compose.staging.yml",
    ],
    composeEnvFile: ".env.staging",
    service: "app",
    spawnImpl: fakeSpawnFactory(calls, received),
    requestTimeoutMs: 1000,
  });

  const connection = await factory({
    database: "runtime_dev",
    credentials: {
      host: "runtime-db",
      port: 3306,
      user: "runtime_user",
      password: secret,
      database: "runtime_dev",
    },
  });

  const [rows] = await connection.query("SELECT 1");
  assert.deepEqual(rows, [{ query_ok: 1 }]);

  const [result] = await connection.execute(
    "UPDATE x SET y = ?",
    [1],
  );
  assert.deepEqual(result, { affectedRows: 0 });

  await connection.end();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "docker");
  assert.ok(calls[0].args.includes("exec"));
  assert.ok(calls[0].args.includes("app"));
  assert.ok(
    calls[0].args.includes(
      "/app/scripts/staging-bootstrap-db-bridge.mjs",
    ),
  );

  assert.equal(
    JSON.stringify(calls[0].args).includes(secret),
    false,
  );

  const connectRequest = received.find(
    (entry) => entry.operation === "connect",
  );

  assert.equal(connectRequest.credentials.password, secret);
});

test("invalid Compose service names fail closed", () => {
  assert.throws(
    () => buildStagingComposeBridgeArgs({
      apiRoot: HERE,
      composeFiles: ["docker-compose.yml"],
      composeEnvFile: ".env.staging",
      service: "app;whoami",
    }),
    (error) =>
      error?.code === "staging_compose_bridge_service_invalid",
  );
});

test("Host Breakglass wires the bridge without removing Windows guard", () => {
  const source = fs.readFileSync(
    path.join(HERE, "scripts", "host-breakglass-local.mjs"),
    "utf8",
  );

  const overlay = JSON.parse(
    fs.readFileSync(
      path.join(
        HERE,
        "config",
        "host-breakglass-staging-contract.json",
      ),
      "utf8",
    ),
  );

  assert.equal(overlay.database_bridge_service, "app");

  assert.match(
    source,
    /createStagingComposeBootstrapConnectionFactory/u,
  );

  assert.match(
    source,
    /connectionFactory,\s*executionTicketVerifier/u,
  );

  assert.match(
    source,
    /verifyPreservedRolesAfterSelectiveRebuild\(initialResult,\s*env,\s*connectionFactory\)/u,
  );

  assert.match(
    source,
    /process\.platform !== overlay\.required_platform/u,
  );
});
