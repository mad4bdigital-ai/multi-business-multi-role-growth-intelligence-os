import mysql from "mysql2/promise";

let pool = null;
let runtimePersistencePool = null;

const RUNTIME_PERSISTENCE_DB_ENV = Object.freeze({
  host: "RUNTIME_PERSISTENCE_DB_HOST",
  port: "RUNTIME_PERSISTENCE_DB_PORT",
  database: "RUNTIME_PERSISTENCE_DB_NAME",
  user: "RUNTIME_PERSISTENCE_DB_USER",
  password: "RUNTIME_PERSISTENCE_DB_PASSWORD",
  connectionLimit: "RUNTIME_PERSISTENCE_DB_CONNECTION_LIMIT",
  connectTimeout: "RUNTIME_PERSISTENCE_DB_CONNECT_TIMEOUT_MS",
});

export function getRuntimePersistencePool(env = process.env) {
  const required = [RUNTIME_PERSISTENCE_DB_ENV.host, RUNTIME_PERSISTENCE_DB_ENV.database, RUNTIME_PERSISTENCE_DB_ENV.user, RUNTIME_PERSISTENCE_DB_ENV.password];
  if (required.some((key) => !env?.[key])) return null;
  if (!runtimePersistencePool) {
    runtimePersistencePool = mysql.createPool({
      host: env[RUNTIME_PERSISTENCE_DB_ENV.host],
      port: Number(env[RUNTIME_PERSISTENCE_DB_ENV.port]) || 3306,
      database: env[RUNTIME_PERSISTENCE_DB_ENV.database],
      user: env[RUNTIME_PERSISTENCE_DB_ENV.user],
      password: env[RUNTIME_PERSISTENCE_DB_ENV.password],
      waitForConnections: true,
      connectionLimit: Number(env[RUNTIME_PERSISTENCE_DB_ENV.connectionLimit]) || 2,
      queueLimit: 0,
      connectTimeout: Number(env[RUNTIME_PERSISTENCE_DB_ENV.connectTimeout]) || 10000,
      timezone: "Z",
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return runtimePersistencePool;
}

export function getPool() {
  const missing = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"].filter((key) => !process.env[key]);
  if (missing.length) {
    const err = new Error(`Missing required DB environment variables: ${missing.join(", ")}`);
    err.code = "DB_CONFIG_MISSING";
    throw err;
  }

  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 5,
      queueLimit: 0,
      connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 10000,
      timezone: "Z",
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }
  return pool;
}

export async function testConnection() {
  const conn = await getPool().getConnection();
  await conn.ping();
  conn.release();
}
