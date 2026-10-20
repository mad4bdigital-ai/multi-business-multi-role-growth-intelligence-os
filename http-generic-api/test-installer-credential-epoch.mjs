import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveInstallerCredentialEpoch, compareInstallerCredentialEpoch,
  currentInstallerCredentialEpoch, assertCurrentInstallerCredentialEpoch
} from "./installerCredentialEpoch.js";

const credentials=()=>({
  config_id:"config-12345678-1234", user_id:"user-1", tenant_id:"tenant-1",
  device_id:"device-1", connector_secret:"example-random-connector-secret-1",
  cf_token:"example-random-cloudflare-token-1",
});
function pool(rows=[credentials()]) {
  const calls=[];return{calls,async query(sql,params){
    calls.push({sql,params});
    return [rows.filter(r=>r.config_id===params[0]&&r.user_id===params[1]&&
      r.tenant_id===params[2]&&r.device_id===params[3])];
  }};
}
test("credential epoch is stable and opaque, with no raw secret in token claim",()=>{
  const cfg=credentials();
  const hash=deriveInstallerCredentialEpoch(cfg);
  assert.match(hash,/^[0-9a-f]{64}$/);
  assert(!hash.includes(cfg.connector_secret));
  assert.equal(deriveInstallerCredentialEpoch(cfg),hash);
  assert(compareInstallerCredentialEpoch(hash,hash));
  const otherDevice={...cfg,device_id:"other-device"};
  assert.notEqual(deriveInstallerCredentialEpoch(otherDevice),hash,
    "Canonical device identity is part of the epoch fence");
  const rotatedSecret={...cfg,connector_secret:"another-device-secret"};
  assert.notEqual(deriveInstallerCredentialEpoch(rotatedSecret),hash,
    "An enrolled connector secret rotation invalidates existing epochs");
});
test("token issued before connector or tunnel token rotation fails", async()=>{
  const cfg=credentials(),old=deriveInstallerCredentialEpoch(cfg);
  const p=pool([cfg]);
  await assertCurrentInstallerCredentialEpoch({...cfg,credential_epoch:old},{pool:p});
  cfg.connector_secret="example-random-connector-secret-ROTATED";
  await assert.rejects(assertCurrentInstallerCredentialEpoch({...cfg,credential_epoch:old},{pool:p}),
    e=>e.code==="installer_credential_epoch_changed");
  cfg.connector_secret=credentials().connector_secret;
  cfg.cf_token="example-random-cloudflare-token-ROTATED";
  await assert.rejects(assertCurrentInstallerCredentialEpoch({...cfg,credential_epoch:old},{pool:p}),
    e=>e.code==="installer_credential_epoch_changed");
});
test("unsigned legacy credential epoch and duplicate identity fail closed",async()=>{
  const cfg=credentials();
  await assert.rejects(assertCurrentInstallerCredentialEpoch(cfg,{pool:pool([cfg])}),
    e=>e.code==="installer_credential_epoch_changed");
  await assert.rejects(currentInstallerCredentialEpoch({...cfg,pool:pool([cfg,cfg])}),
    e=>e.code==="installer_device_identity_changed");
});
test("epoch query always uses exact scoped identity and active lifecycle",async()=>{
  const cfg=credentials(),p=pool([cfg]);
  await currentInstallerCredentialEpoch({...cfg,pool:p});
  assert(p.calls.length===1);
  assert(p.calls[0].sql.includes("lifecycle_state = 'active'"));
  assert(p.calls[0].sql.includes("revoked_at IS NULL AND archived_at IS NULL"));
  assert.deepEqual(p.calls[0].params,[cfg.config_id,cfg.user_id,cfg.tenant_id,cfg.device_id]);
});
