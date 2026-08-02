import mysql from "mysql2/promise";

let pool = null;

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
  let conn = null;
  try {
    conn = await getPool().getConnection();
    await conn.ping();
  } finally {
    conn?.release();
  }
}
