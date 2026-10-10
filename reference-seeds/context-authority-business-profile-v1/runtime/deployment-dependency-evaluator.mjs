/** Portable, declarative dependency classification. No I/O and no authority grants.
 * Trusted hosts must independently verify any observed status.
 */
import policy from '../deployment-dependency-graph.json' with {type:'json'};
export const MODES=Object.freeze(Object.keys(policy.modes));
const exact = value => value==='VERIFIED';
const missing = (keys,found) => keys.filter(key=>!exact(found?.[key]));
const deny = (state,reason,meta={}) => ({state,reason,...meta,execution_authorized:false,publication_authorized:false,release_authorized:false});
export function assessDeploymentDependencies({mode,observed={}}={}){
  if(!MODES.includes(mode))return deny('BLOCKED','UNSUPPORTED_MODE');
  const spec=policy.modes[mode],ident=missing(spec.required_identity||[],observed.identity),trust=missing(spec.required_trust||[],observed.trust);
  const discovery=missing(spec.required_discovery||[],observed.discovery);
  const optional=(spec.optional||[]).map(key=>({capability:key,status:exact(observed.optional?.[key])?'OBSERVED_VERIFIED_BY_HOST':'CAPABILITY_UNAVAILABLE_OR_UNVERIFIED'}));
  const state=ident.length||trust.length?'BLOCKED':discovery.length?'DISCOVERY_BLOCKED_ONLY':'READY_FOR_REVIEW_ONLY';
  return deny(state,state==='BLOCKED'?'IDENTITY_OR_TRUST_DEPENDENCY_MISSING':state==='DISCOVERY_BLOCKED_ONLY'?'MCP_DISCOVERY_DEPENDENCY_MISSING':'DEPENDENCIES_REPORTED', {
    mode,missing_identity:ident,missing_trust:trust,missing_discovery:discovery,optional,
    externally_verified:false,source:'HOST_DECLARED_CONTRACT_STATUS',
    available_for_release:false
  });
}
function tuple(v){if(typeof v!=='string')return null;const match=v.match(/^(\d+)\.(\d+)\.(\d+)$/);return match?match.slice(1).map(Number):null;}
export function assessWordPressAdapterCompatibility({adapter,expectedScope}={}){
  if(!adapter||typeof adapter!=='object')return deny('BLOCKED','ADAPTER_MISSING');
  const required=policy.plugin_adapter;
  if(adapter.contract!==required.contract||adapter.common_contract!==policy.mode_contract)return deny('BLOCKED','CONTRACT_MISMATCH');
  const ver=tuple(adapter.adapter_version);
  if(!ver||ver[0]!==required.supported_major||ver[1]<required.min_minor)return deny('BLOCKED','VERSION_UNSUPPORTED');
  if(adapter.active_mode!=='wordpress_dedicated'||adapter.status!==required.required_plugin_state||adapter.portable_state!==required.required_portable_state)return deny('BLOCKED','ADAPTER_NOT_BOUND');
  if(!adapter.scope||!expectedScope||typeof expectedScope!=='object')return deny('BLOCKED','SCOPE_MISSING');
  for(const k of required.identity_fields){
    const actual=adapter.scope[k],expected=expectedScope[k];
    if(actual===undefined||expected===undefined||String(actual)!==String(expected))return deny('BLOCKED','SCOPE_MISMATCH');
  }
  if(!adapter.dependency_revision||!(adapter.dependency_revision.site_profile>0)||!(adapter.dependency_revision.brand_profile>0))return deny('BLOCKED','SOURCE_REVISION_MISSING');
  if(!Array.isArray(adapter.missing_dependencies)||adapter.missing_dependencies.length)return deny('BLOCKED','REQUIRED_DEPENDENCIES_MISSING');
  if(adapter.execution_authorized!==false||adapter.publication_authorized!==false||adapter.production_authorized!==false)return deny('BLOCKED','UNEXPECTED_WRITE_AUTHORITY');
  if(adapter.host_binding_requires_independent_acceptance!==true)return deny('BLOCKED','HOST_INDEPENDENT_PROOF_NOT_DECLARED');
  return deny('COMPATIBLE_REVIEW_ONLY','ADAPTER_CONTRACT_COMPATIBLE',{
    mode:'wordpress_dedicated',scope:Object.fromEntries(required.identity_fields.map(k=>[k,adapter.scope[k]])),
    needs_independent_host_attestation:true,needs_live_staging_acceptance:true,
    source_revision:adapter.dependency_revision,role_authority_verified:false
  });
}
