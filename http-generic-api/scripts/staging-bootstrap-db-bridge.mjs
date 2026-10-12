#!/usr/bin/env node
import readline from "node:readline";
import { createConnection } from "mysql2/promise";

function write(payload) {
  process.stdout.write(`${JSON.stringify(payload, (_key, value) => (
    typeof value === "bigint" ? value.toString() : value
  ))}\n`);
}

function publicError(error) {
  return {
    code: String(error?.code || "staging_compose_db_bridge_mysql_error"),
    message: "Staging database bridge operation failed.",
    mysql_code: error?.code || null,
    mysql_state: error?.sqlState || null,
  };
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

let connection = null;

for await (const line of input) {
  if (!line.trim()) continue;

  let request;

  try {
    request = JSON.parse(line);
  } catch {
    write({
      id: null,
      ok: false,
      error: {
        code: "staging_compose_db_bridge_request_invalid",
        message: "Bridge request was not valid JSON.",
      },
    });
    continue;
  }

  const id = request.id;

  try {
    if (request.operation === "connect") {
      if (connection) {
        throw Object.assign(
          new Error("Bridge connection already exists."),
          { code: "staging_compose_db_bridge_already_connected" },
        );
      }

      const credentials = request.credentials || {};

      connection = await createConnection({
        host: credentials.host,
        port: Number(credentials.port || 3306),
        user: credentials.user,
        password: credentials.password,
        database: credentials.database,
        multipleStatements: true,
        connectTimeout: 15000,
      });

      write({ id, ok: true });
      continue;
    }

    if (!connection) {
      throw Object.assign(
        new Error("Bridge connection is not initialized."),
        { code: "staging_compose_db_bridge_not_connected" },
      );
    }

    if (request.operation === "query" || request.operation === "execute") {
      const params = Array.isArray(request.params) ? request.params : [];
      const [rows] = await connection[request.operation](
        String(request.sql || ""),
        params,
      );

      write({ id, ok: true, rows });
      continue;
    }

    if (request.operation === "close") {
      await connection.end();
      connection = null;
      write({ id, ok: true });
      input.close();
      break;
    }

    throw Object.assign(
      new Error("Unsupported bridge operation."),
      { code: "staging_compose_db_bridge_operation_invalid" },
    );
  } catch (error) {
    write({ id, ok: false, error: publicError(error) });
  }
}

if (connection) {
  try { await connection.end(); } catch {}
}
