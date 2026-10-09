import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {
  verifyBoundDeviceGenerationChallenge,isTrustedDeviceGenerationReceipt
} from "./deviceGenerationChallengeVerifier.js";
import {classifyAdminRecoveryReadback} from "./adminLocalConnectorTarget.js";

const {publicKey,privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
const expected={
  user_id:"user-a",tenant_id:"tenant-a",device_id:"device-001",
  config_id:"config-001",generation_id:"generation-001"
};
const now=Date.parse("2026-10-09T08:00:00Z");
const challenge={
  id:"challenge-001",nonce:"0123456789abcdefghijklmnopqrstuv",
  issued_at_ms:now-30000,expires_at_ms:now+30000
};
const signed=()=>sign("sha256",Buffer.from([
  "mad4b.local-connector.generation-possession.v1",
  ...["user_id","tenant_id","device_id","config_id","generation_id"].map(x=>expected[x]),
  challenge.id,challenge.nonce,String(challenge.issued_at_ms),String(challenge.expires_at_ms)
].join("\n")), {key:privateKey,dsaEncoding:"der"}).toString("base64");
const args=(change={})=>({
  expected,claimed:{...expected},challenge,signature_der_base64:signed(),
  lookupRegisteredGeneration:async scope=>({
    ...scope,public_key_pem:publicKey.export({type:"spki",format:"pem"}),
    status:"active",is_enabled:true,revoked_at:null,archived_at:null
  }),
  now,consumeNonce:async()=>true,...change
});

test("ECDSA possession requires exact current generation and atomic nonce consumption",async()=>{
  let calls=0;const used=new Set();
  const opts=args({consumeNonce:async({challenge_id,nonce,expected_scope})=>{
    calls++;
    assert.deepEqual(expected_scope,expected);
    const key=challenge_id+":"+nonce;if(used.has(key))return false;
    used.add(key);return true;
  }});
  const receipt=await verifyBoundDeviceGenerationChallenge(opts);
  assert.equal(isTrustedDeviceGenerationReceipt(receipt,expected),true);
  assert.equal(isTrustedDeviceGenerationReceipt({...receipt},expected),false);
  assert.equal(receipt.hardware_nonexportability_verified,false);
  assert.equal(receipt.execution_allowed,false);
  assert.equal(receipt.recovered,false);
  assert.equal(calls,1);
  await assert.rejects(verifyBoundDeviceGenerationChallenge(opts),
    e=>e.code==="device_generation_challenge_replayed_or_uncommitted");
});

test("tenant, user, device, config and generation mismatch fail before nonce consumption",async()=>{
  for(const field of Object.keys(expected)){
    let consumed=false;
    await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
      claimed:{...expected,[field]:"other-scope"},
      consumeNonce:async()=>{consumed=true;return true;}
    })),e=>e.code==="device_generation_identity_mismatch");
    assert.equal(consumed,false,field);
  }
});

test("invalid signature, expired challenge, and missing nonce store fail closed",async()=>{
  await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
    signature_der_base64:sign("sha256",Buffer.from("different-challenge"),
      {key:privateKey,dsaEncoding:"der"}).toString("base64")
  })),e=>e.code==="device_generation_signature_invalid");
  await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
    now:challenge.expires_at_ms
  })),e=>e.code==="device_generation_challenge_expired_or_invalid");
  await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
    consumeNonce:null
  })),e=>e.code==="device_generation_nonce_store_unavailable");
});

test("caller-provided true or possession receipt cannot claim nonexportable recovery",async()=>{
  const receipt=await verifyBoundDeviceGenerationChallenge(args());
  const state={
    deviceState:"ACTIVE",publicStatus:"pass",authenticatedStatus:"pass",
    observedDeviceId:"device-001",expectedDeviceId:"device-001",
    observedConfigId:"config-001",expectedConfigId:"config-001"
  };
  const spoof=classifyAdminRecoveryReadback({...state,deviceGenerationAttested:true});
  assert.equal(spoof.recovered,false);
  assert.equal(spoof.device_generation_attested,false);
  const proof=classifyAdminRecoveryReadback({...state,
    deviceGenerationReceipt:receipt,expectedGenerationScope:expected
  });
  assert.equal(proof.device_generation_possession_verified,true);
  assert.equal(proof.device_generation_attested,false);
  assert.equal(proof.recovered,false);
});


test("attacker-provided EC public key never substitutes the exact registered key",async()=>{
  const attacker=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  let consumed=false;
  const forged=sign("sha256",Buffer.from([
    "mad4b.local-connector.generation-possession.v1",
    ...["user_id","tenant_id","device_id","config_id","generation_id"].map(x=>expected[x]),
    challenge.id,challenge.nonce,String(challenge.issued_at_ms),
    String(challenge.expires_at_ms)
  ].join("\n")), {key:attacker.privateKey,dsaEncoding:"der"}).toString("base64");
  await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
    signature_der_base64:forged,
    public_key_pem:attacker.publicKey.export({type:"spki",format:"pem"}),
    consumeNonce:async()=>{consumed=true;return true;}
  })),e=>e.code==="device_generation_signature_invalid");
  assert.equal(consumed,false);
});
test("inactive, revoked or scope-mismatched registered key fails before challenge consume",async()=>{
  for(const reg of [
    {status:"revoked"},{is_enabled:false},{archived_at:"2026-10-09"},
    {revoked_at:"2026-10-09"},{device_id:"another-device"},{generation_id:"stale-generation"}
  ]){
    let consumed=false;
    await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
      lookupRegisteredGeneration:async()=>({
        ...expected,status:"active",is_enabled:true,revoked_at:null,archived_at:null,
        public_key_pem:publicKey.export({type:"spki",format:"pem"}),...reg
      }),
      consumeNonce:async()=>{consumed=true;return true;}
    })),e=>e.code==="device_generation_registered_key_not_trusted");
    assert.equal(consumed,false);
  }
  await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
    lookupRegisteredGeneration:null
  })),e=>e.code==="device_generation_registered_key_lookup_unavailable");
});
test("noncanonical signature encoding cannot pass even if decoded bytes might be valid",async()=>{
  await assert.rejects(verifyBoundDeviceGenerationChallenge(args({
    signature_der_base64:signed().replace(/=+$/,"")
  })),e=>e.code==="device_generation_signature_invalid");
});
