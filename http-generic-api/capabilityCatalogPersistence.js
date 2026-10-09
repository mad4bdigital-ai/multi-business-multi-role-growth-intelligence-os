import { createHash } from "node:crypto";

const SHA=/^[a-f0-9]{64}$/;
const ID=/^[a-z0-9][a-z0-9._-]{1,79}$/;
const SAFE_NONCE=/^[A-Za-z0-9_-]{16,96}$/;
const invalid=code=>{throw Object.assign(new Error(code),{code})};

/** MySQL/MariaDB with a global UNIQUE index; all replicas MUST share it. */
export function createMysqlCatalogNonceStore({ execute, clock=()=>Math.floor(Date.now()/1000) }={}) {
  if(typeof execute!=="function"||typeof clock!=="function")
    invalid("NONCE_LEDGER_NOT_CONFIGURED");
  return Object.freeze({
    async consumeNonce({issuer,kid,nonce,site_id,tenant_id,environment,
      origin_sha256,runtime_generation,expires_at}={}) {
      if(!ID.test(issuer??"")||!ID.test(kid??"")||
        !SAFE_NONCE.test(nonce??"")||!ID.test(site_id??"")||
        !ID.test(tenant_id??"")||!["staging","production","development","local"].includes(environment)||
        !SHA.test(origin_sha256??"")||!SHA.test(runtime_generation??"")||
        !Number.isSafeInteger(expires_at)||expires_at<clock()||expires_at>clock()+300)
        return false;
      const scope=[issuer,kid,nonce,tenant_id,site_id,environment,
        origin_sha256,runtime_generation].join("\u001f");
      const digest=createHash("sha256").update(scope,"utf8").digest("hex");
      try {
        const [result]=await execute(
          "INSERT INTO platform_capability_catalog_consumed_nonces (scope_sha256, expires_epoch) VALUES (?, ?)",
          [digest,expires_at]
        );
        return result?.affectedRows===1;
      }catch(_) {return false;} // Duplicate or unavailable ledger: fail closed
    }
  });
}

/**
 * Server-admin metadata lookup. Private material is never returned by the
 * database or resolved from caller fields. keyHandleReader is a trusted
 * deployment-owned Secret Manager/KMS accessor.
 */
export function createMysqlCatalogKeyReader({execute,keyHandleReader}={}) {
  if(typeof execute!=="function"||typeof keyHandleReader!=="function")
    invalid("CATALOG_KEY_STORAGE_NOT_CONFIGURED");
  return async ({site,purpose}={})=>{
    if(purpose!=="capability.catalog.attestation" || !site || !ID.test(site.tenant_id??"")||
      !ID.test(site.site_id??"")) invalid("KEY_QUERY_SCOPE_INVALID");
    const [rows]=await execute(
      "SELECT kid, issuer, key_ref, public_key_pem, not_before_epoch, not_after_epoch, status, revoked FROM platform_capability_catalog_keys WHERE tenant_id=? AND site_id=? AND environment=? AND purpose=? AND status='active' AND revoked=0 ORDER BY not_before_epoch DESC, kid LIMIT 2",
      [site.tenant_id,site.site_id,site.environment,purpose]
    );
    if(!Array.isArray(rows)||rows.length!==1)invalid("KEY_ROTATION_AMBIGUOUS_OR_UNAVAILABLE");
    const k=rows[0];
    const signer=await keyHandleReader({
      trusted_key_ref:k.key_ref, purpose, site, kid:k.kid
    });
    if(!signer||typeof signer.sign!=="function")invalid("KEY_HANDLE_UNAVAILABLE");
    return {
      kid:k.kid,issuer:k.issuer,purpose,status:k.status,site:{...site},
      public_key_pem:k.public_key_pem,not_before:k.not_before_epoch,
      not_after:k.not_after_epoch,revoked:k.revoked===1,
      sign:signer.sign
    };
  };
}
