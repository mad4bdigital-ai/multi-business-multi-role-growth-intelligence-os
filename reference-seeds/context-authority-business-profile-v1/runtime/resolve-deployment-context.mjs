/** Host-pluggable identity resolver; NEVER an authorization grant.
 *
 * The trusted host must provide both a validated identity record and an
 * independently implemented verifyHostBinding callback. A caller-supplied
 * callback is not, by itself, a cryptographic trust anchor.
 */
const MODES=Object.freeze(['shared_multi_tenant','dedicated_isolated','dedicated_autonomous','wordpress_dedicated']);
const EXPECTED_DEFAULTS=Object.freeze({platform:'shared_multi_tenant',wordpress_plugin:'wordpress_dedicated'});
const SAFE_KEY=/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
function deny(reason){return {state:'BLOCKED',reason,scope:null,execution_authorized:false,publication_authorized:false,release_authorized:false};}
function valid(s){return typeof s==='string'&&SAFE_KEY.test(s);}
export function listDeploymentModes(){return [...MODES];}
export function resolveDeploymentContext({host,assertedScope={},verifyHostBinding}={}){
  if(!host||typeof host!=='object'||!verifyHostBinding||typeof verifyHostBinding!=='function')return deny('TRUSTED_HOST_BINDING_REQUIRED');
  if(!['platform','wordpress_plugin'].includes(host.host_kind))return deny('UNSUPPORTED_HOST_KIND');
  if(!MODES.includes(host.mode))return deny('UNSUPPORTED_MODE');
  if(host.host_kind==='wordpress_plugin'&&host.mode!=='wordpress_dedicated')return deny('WP_MODE_OVERRIDE_DENIED');
  if(host.host_kind==='platform'&&host.mode==='wordpress_dedicated')return deny('WP_CONTEXT_HOST_REQUIRED');
  if(host.selection==='automatic'&&host.mode!==EXPECTED_DEFAULTS[host.host_kind])return deny('DEFAULT_MODE_DISAGREEMENT');
  if(!host.scope||typeof host.scope!=='object'||Array.isArray(host.scope))return deny('SCOPE_MISSING');
  const scoped=host.scope;
  const required=['tenant_ref','brand_ref'];
  if(host.mode==='wordpress_dedicated')required.push('site_uuid','blog_id','network_id','environment');
  if(host.mode==='dedicated_isolated'||host.mode==='dedicated_autonomous')required.push('deployment_ref');
  if(required.some(k=>!valid(String(scoped[k]??''))))return deny('REQUIRED_IDENTITY_MISSING');
  if(host.mode==='wordpress_dedicated'){
    const siteUuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if(!siteUuid.test(scoped.site_uuid)||scoped.tenant_ref!=='wp-site:'+scoped.site_uuid.toLowerCase())return deny('WP_SITE_IDENTITY_INVALID');
    if(!['local','development','staging','production'].includes(scoped.environment))return deny('WP_ENVIRONMENT_UNRECOGNIZED');
    if(!Number.isSafeInteger(scoped.blog_id)||scoped.blog_id<1||!Number.isSafeInteger(scoped.network_id)||scoped.network_id<1)return deny('MULTISITE_CONTEXT_INVALID');
    const flags=host.wordpress_binding;
    if(!flags||['configured','origin_match','environment_match','deployment_binding_match','authority_ready','brand_bound'].some(k=>flags[k]!==true))return deny('WP_SITE_PROFILE_NOT_READY');
  }
  if(typeof assertedScope!=='object'||!assertedScope||Array.isArray(assertedScope))return deny('REQUEST_SCOPE_INVALID');
  for(const [key,value] of Object.entries(assertedScope)){
    if(!Object.hasOwn(scoped,key)||typeof value==='object'||String(scoped[key])!==String(value))return deny('ASSERTED_SCOPE_MISMATCH');
  }
  let proof=false;
  try{proof=verifyHostBinding(host)===true;}catch{proof=false;}
  if(!proof)return deny('HOST_BINDING_UNVERIFIED');
  const clean=Object.fromEntries(required.map(k=>[k,scoped[k]]));
  if(host.mode==='shared_multi_tenant'&&scoped.site_uuid!==undefined)clean.site_uuid=scoped.site_uuid;
  return {state:'BOUND_FOR_REVIEW_ONLY',mode:host.mode,scope:clean,
    verification_boundary:'HOST_PROVIDED_INDEPENDENT_BINDING_CALLBACK',
    binding_callback_is_not_standalone_cryptographic_proof:true,
    execution_authorized:false,publication_authorized:false,release_authorized:false};
}
