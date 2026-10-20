import {test} from 'node:test'; import assert from 'node:assert/strict';
import {MODES,assessDeploymentDependencies,assessWordPressAdapterCompatibility} from './deployment-dependency-evaluator.mjs';
const s={tenant_ref:'wp-site:12345678-1234-4123-8123-123456789abc',brand_ref:'abcdefabcdefabcdefabcdefabcdefab',site_uuid:'12345678-1234-4123-8123-123456789abc',blog_id:3,network_id:1,environment:'staging'};
const adapter={contract:'mad4b.deployment-mode-resolution.v1',common_contract:'mad4b.context-deployment-mode.v1',adapter_version:'1.1.0',
 active_mode:'wordpress_dedicated',status:'RESOLVED_FOR_REVIEW_ONLY',portable_state:'BOUND_FOR_REVIEW_ONLY',
 scope:s,dependency_revision:{site_profile:4,brand_profile:2},missing_dependencies:[],host_binding_requires_independent_acceptance:true,
 execution_authorized:false,publication_authorized:false,production_authorized:false};
const verified=(keys)=>Object.fromEntries(keys.map(x=>[x,'VERIFIED']));
const obs={identity:verified(['site_profile','bound_deployment_identity','brand_context_profile','wordpress_blog_network_identity']),
 trust:verified(['wordpress_host_binding']),
 discovery:verified(['wordpress_abilities_api','wp_read_policy','mcp_adapter']),
 optional:{google_drive:'UNKNOWN'}};
test('four platform and plugin modes stay first-class',()=>assert.deepEqual(MODES,['shared_multi_tenant','dedicated_isolated','dedicated_autonomous','wordpress_dedicated']));
test('missing identity blocks, no silent fallback',()=>{const a=assessDeploymentDependencies({mode:'wordpress_dedicated'});assert.equal(a.state,'BLOCKED');assert(a.missing_identity.includes('bound_deployment_identity'));assert.equal(a.execution_authorized,false)});
test('optional Google Drive cannot block resolved identity',()=>{const a=assessDeploymentDependencies({mode:'wordpress_dedicated',observed:obs});assert.equal(a.state,'READY_FOR_REVIEW_ONLY');assert.equal(a.optional.find(x=>x.capability==='google_drive').status,'CAPABILITY_UNAVAILABLE_OR_UNVERIFIED')});
test('missing MCP transport blocks discovery, not identity',()=>{const o={...obs,discovery:{...obs.discovery,mcp_adapter:'MISSING'}};assert.equal(assessDeploymentDependencies({mode:'wordpress_dedicated',observed:o}).state,'DISCOVERY_BLOCKED_ONLY')});
test('platform does not depend on WordPress package',()=>{const o={identity:verified(['platform_tenant_registry','brand_registry','tenant_scope_policy']),trust:verified(['platform_host_binding'])};const a=assessDeploymentDependencies({mode:'shared_multi_tenant',observed:o});assert.equal(a.state,'READY_FOR_REVIEW_ONLY')});
test('autonomous mode requires separate verifier and replay service',()=>{const o={identity:verified(['sovereign_deployment_identity','tenant_identity','brand_registry']),trust:verified(['independent_local_verifier'])};const a=assessDeploymentDependencies({mode:'dedicated_autonomous',observed:o});assert.equal(a.state,'BLOCKED');assert(a.missing_trust.includes('durable_local_replay_store'))});
test('compatible WordPress receipt does not authorize writes',()=>{const a=assessWordPressAdapterCompatibility({adapter,expectedScope:s});assert.equal(a.state,'COMPATIBLE_REVIEW_ONLY');assert.equal(a.publication_authorized,false);assert.equal(a.needs_independent_host_attestation,true)});
test('adapter version and contract drift denied',()=>{assert.equal(assessWordPressAdapterCompatibility({adapter:{...adapter,adapter_version:'2.0.0'},expectedScope:s}).reason,'VERSION_UNSUPPORTED');assert.equal(assessWordPressAdapterCompatibility({adapter:{...adapter,common_contract:'other'},expectedScope:s}).reason,'CONTRACT_MISMATCH')});
test('scoped brand, blog, site, environment must all agree',()=>{for(const k of ['brand_ref','blog_id','site_uuid','environment']){const a=assessWordPressAdapterCompatibility({adapter,expectedScope:{...s,[k]:'wrong'}});assert.equal(a.reason,'SCOPE_MISMATCH')}});
test('missing revision or reported dependency fails closed',()=>{assert.equal(assessWordPressAdapterCompatibility({adapter:{...adapter,dependency_revision:{site_profile:0,brand_profile:2}},expectedScope:s}).reason,'SOURCE_REVISION_MISSING');assert.equal(assessWordPressAdapterCompatibility({adapter:{...adapter,missing_dependencies:['missing']},expectedScope:s}).reason,'REQUIRED_DEPENDENCIES_MISSING')});
test('claims of runtime write authority blocked',()=>{assert.equal(assessWordPressAdapterCompatibility({adapter:{...adapter,publication_authorized:true},expectedScope:s}).reason,'UNEXPECTED_WRITE_AUTHORITY')});
test('unproven host attestation cannot pass contract check',()=>{assert.equal(assessWordPressAdapterCompatibility({adapter:{...adapter,host_binding_requires_independent_acceptance:false},expectedScope:s}).reason,'HOST_INDEPENDENT_PROOF_NOT_DECLARED')});
