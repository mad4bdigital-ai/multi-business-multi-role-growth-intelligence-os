import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const service = readFileSync("supportTicketExternalLiveSendService.js", "utf8");

for (const expected of [
  "decryptCredentials",
  "readPlatformSecretValue",
  "platform_secrets",
  "HOSTINGER_SMTP_URL",
  "resolveSmtpConfig",
  "platform_secrets:HOSTINGER_SMTP_URL",
  "smtp_secret_source",
  "secret_value_included: false",
  "secrets_included: false",
]) {
  assert(service.includes(expected), `live send service must include ${expected}`);
}

assert(service.includes("process.env.SMTP_URL || process.env.HOSTINGER_SMTP_URL"), "env SMTP fallback must remain supported");
assert(!service.includes("console.log(platformRaw"), "platform secret values must not be logged");
assert(!service.includes("return { config: parseSmtpUrlFromRaw(platformRaw), source: platformRaw"), "secret source must not include secret value");
assert(service.includes("await sendSmtpMail({ config: (await resolveSmtpConfig(options)).config"), "live SMTP send must use resolved runtime/platform secret config");
assert(service.includes("authenticateSmtp"), "SMTP live send must support governed authentication helper");
assert(service.includes("AUTH LOGIN"), "SMTP live send must fall back to AUTH LOGIN when AUTH PLAIN is rejected");
assert(service.includes("smtp_stage"), "SMTP command failures must include safe stage metadata");

console.log("hostinger smtp platform secret fallback tests passed");
