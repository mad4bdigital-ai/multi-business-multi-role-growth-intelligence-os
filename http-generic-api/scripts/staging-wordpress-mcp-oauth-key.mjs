import {
  createPrivateKey,
  generateKeyPairSync,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  envFlag,
  resolveRemoteMcpEnvironment,
} from "../remoteMcpOAuthProfile.js";
import {
  WORDPRESS_STAGING_MCP_PRIVATE_KEY_FILE,
  resolveWordpressStagingMcpPrivateKeyFile,
} from "../wordpressStagingMcpOAuthProfile.js";

function validatePrivateKeyPem(pem) {
  const key = createPrivateKey({ key: String(pem || ""), format: "pem" });
  if (key.asymmetricKeyType !== "rsa") throw new Error("WordPress staging OAuth private key must be RSA.");
  const modulusLength = Number(key.asymmetricKeyDetails?.modulusLength || 0);
  if (modulusLength && modulusLength < 2048) throw new Error("WordPress staging OAuth RSA key must be at least 2048 bits.");
  return key;
}

function assertRuntimePath(filePath, env) {
  const expectedDefault = resolve(WORDPRESS_STAGING_MCP_PRIVATE_KEY_FILE);
  const actual = resolve(filePath);
  const testOverride = envFlag(env.REMOTE_MCP_WORDPRESS_RS256_ALLOW_TEST_KEY_PATH);
  if (!testOverride && actual !== expectedDefault && !actual.startsWith(`${resolve("/app/data/oauth")}/`)) {
    throw new Error("WordPress staging OAuth private key file must remain under /app/data/oauth.");
  }
  return actual;
}

export function ensureWordpressStagingMcpOAuthKey(env = process.env) {
  const enabled = envFlag(env.REMOTE_MCP_WORDPRESS_STAGING_OAUTH_ENABLED);
  if (!enabled) return { status: "disabled", generated: false, secrets_included: false };

  const environment = resolveRemoteMcpEnvironment(env);
  if (environment !== "staging") {
    throw new Error("WordPress staging OAuth signing-key bootstrap is forbidden outside Staging.");
  }

  const filePath = assertRuntimePath(resolveWordpressStagingMcpPrivateKeyFile(env), env);
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });

  if (existsSync(filePath)) {
    validatePrivateKeyPem(readFileSync(filePath, "utf8"));
    try { chmodSync(filePath, 0o600); } catch {}
    return { status: "ready_existing", generated: false, path: filePath, secrets_included: false };
  }

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicExponent: 0x10001,
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  validatePrivateKeyPem(pem);

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    writeFileSync(tempPath, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
    // Publish without replacement. linkSync is atomic on the same filesystem and
    // fails with EEXIST if another bootstrap already won the canonical path.
    linkSync(tempPath, filePath);
    rmSync(tempPath, { force: true });
    try { chmodSync(filePath, 0o600); } catch {}
    return { status: "generated", generated: true, path: filePath, secrets_included: false };
  } catch (error) {
    try { rmSync(tempPath, { force: true }); } catch {}
    if (error?.code === "EEXIST" || existsSync(filePath)) {
      validatePrivateKeyPem(readFileSync(filePath, "utf8"));
      try { chmodSync(filePath, 0o600); } catch {}
      return { status: "ready_race_winner", generated: false, path: filePath, secrets_included: false };
    }
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = ensureWordpressStagingMcpOAuthKey(process.env);
  console.log(JSON.stringify({
    contract: "mad4b.wordpress-staging-mcp-oauth-key-bootstrap.v1",
    status: result.status,
    generated: result.generated,
    key_path_configured: Boolean(result.path),
    secrets_included: false,
  }));
}
