import mysql from "mysql2/promise";

let pool = null;
let runtimePersistencePool = null;

function missingDatabaseEnvironment(prefix) {
  return [`${prefix}_HOST`, `${prefix}_NAME`, `${prefix}_USER`, `${prefix}_PASSWORD`].filter((key) => !process.env[key]);
}

function createPool({ prefix, connectionLimitKey, connectTimeoutKey, missingCode }) {
  const missing = missingDatabaseEnvironment(prefix);
  if (missing.length) {
    const err = new Error(`Missing required ${prefix} environment variables: ${missing.join(", ")}`);
    err.code = missingCode;
    throw err;
  }
  return mysql.createPool({
    host: process.env[`${prefix}_HOST`],
    port: Number(process.env[`${prefix}_PORT`]) || 3306,
    database: process.env[`${prefix}_NAME`],
    user: process.env[`${prefix}_USER`],
    password: process.env[`${prefix}_PASSWORD`],
    waitForConnections: true,
    connectionLimit: Number(process.env[connectionLimitKey]) || 5,
    queueLimit: 0,
    connectTimeout: Number(process.env[connectTimeoutKey]) || 10000,
    timezone: "Z",
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });
}

export function getPool() {
  if (!pool) {
    pool = createPool({
      prefix: "DB",
      connectionLimitKey: "DB_CONNECTION_LIMIT",
      connectTimeoutKey: "DB_CONNECT_TIMEOUT_MS",
      missingCode: "DB_CONFIG_MISSING",
    });
  }
  return pool;
}

export function getRuntimePersistencePool() {
  if (!runtimePersistencePool) {
    runtimePersistencePool = createPool({
      prefix: "RUNTIME_PERSISTENCE_DB",
      connectionLimitKey: "RUNTIME_PERSISTENCE_DB_CONNECTION_LIMIT",
      connectTimeoutKey: "RUNTIME_PERSISTENCE_DB_CONNECT_TIMEOUT_MS",
      missingCode: "RUNTIME_PERSISTENCE_DB_CONFIG_MISSING",
    });
  }
  return runtimePersistencePool;
}

export async function testConnection() {
  const conn = await getPool().getConnection();
  await conn.ping();
  conn.release();
}

export async function testRuntimePersistenceConnection() {
  const conn = await getRuntimePersistencePool().getConnection();
  await conn.ping();
  conn.release();
}
