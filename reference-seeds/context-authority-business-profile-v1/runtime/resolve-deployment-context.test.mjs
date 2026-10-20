import assert from 'node:assert/strict';
import {test} from 'node:test';
import {listDeploymentModes,resolveDeploymentContext} from './resolve-deployment-context.mjs';
const base={tenant_ref:'t1',brand_ref:'b1'};
const callback=()=>true;
const binding={configured:true,origin_match:true,environment_match:true,deployment_binding_match:true,authority_ready:true,brand_bound:true};
const wp={host_kind:'wordpress_plugin',mode:'wordpress_dedicated',selection:'automatic',
  scope:{tenant_ref:'wp-site:12345678-1234-4123-8123-123456789abc',brand_ref:'abcabcabcabcabcabcabcabcabcabcab',
    site_uuid:'12345678-1234-4123-8123-123456789abc',blog_id:7,network_id:1,environment:'staging'},
  wordpress_binding:binding};
test('all four variants are supported',()=>assert.equal(listDeploymentModes().length,4));
test('verified platform shared remains a first-class default',()=>{
 const a=resolveDeploymentContext({host:{host_kind:'platform',mode:'shared_multi_tenant',selection:'automatic',scope:base},verifyHostBinding:callback});
 assert.equal(a.state,'BOUND_FOR_REVIEW_ONLY');assert.equal(a.mode,'shared_multi_tenant');assert.equal(a.publication_authorized,false);
});
test('both dedicated platform modes remain supported',()=>{
 for(const mode of ['dedicated_isolated','dedicated_autonomous']){
  const a=resolveDeploymentContext({host:{host_kind:'platform',mode,selection:'explicit',scope:{...base,deployment_ref:'d1'}},verifyHostBinding:callback});
  assert.equal(a.mode,mode);assert.equal(a.execution_authorized,false);
 }
});
test('wordpress dedicated derives scope from trusted host',()=>{
 const a=resolveDeploymentContext({host:wp,verifyHostBinding:callback});
 assert.equal(a.mode,'wordpress_dedicated');assert.equal(a.scope.blog_id,7);assert.equal(a.scope.brand_ref,wp.scope.brand_ref);
 assert.equal(a.publication_authorized,false);
});
test('request cannot change tenant or brand',()=>{
 assert.equal(resolveDeploymentContext({host:wp,assertedScope:{tenant_ref:'other'},verifyHostBinding:callback}).reason,'ASSERTED_SCOPE_MISMATCH');
 assert.equal(resolveDeploymentContext({host:wp,assertedScope:{brand_ref:'other'},verifyHostBinding:callback}).reason,'ASSERTED_SCOPE_MISMATCH');
});
test('request cannot switch WordPress to shared',()=>{
 assert.equal(resolveDeploymentContext({host:{...wp,mode:'shared_multi_tenant'},verifyHostBinding:callback}).reason,'WP_MODE_OVERRIDE_DENIED');
});
test('wordpress scope denies wrong site/blog/network identity',()=>{
 assert.equal(resolveDeploymentContext({host:{...wp,scope:{...wp.scope,blog_id:0}},verifyHostBinding:callback}).reason,'MULTISITE_CONTEXT_INVALID');
 assert.equal(resolveDeploymentContext({host:wp,assertedScope:{network_id:2},verifyHostBinding:callback}).reason,'ASSERTED_SCOPE_MISMATCH');
});
test('missing enrollment or clone binding fails closed',()=>{
 assert.equal(resolveDeploymentContext({host:{...wp,wordpress_binding:{...binding,origin_match:false}},verifyHostBinding:callback}).reason,'WP_SITE_PROFILE_NOT_READY');
 assert.equal(resolveDeploymentContext({host:{...wp,wordpress_binding:{...binding,deployment_binding_match:false}},verifyHostBinding:callback}).reason,'WP_SITE_PROFILE_NOT_READY');
});
test('unverified host cannot mark bound',()=>{
 assert.equal(resolveDeploymentContext({host:wp,verifyHostBinding:()=>false}).reason,'HOST_BINDING_UNVERIFIED');
 assert.equal(resolveDeploymentContext({host:wp}).reason,'TRUSTED_HOST_BINDING_REQUIRED');
});
test('untrusted mode or auto-default disagreement refused',()=>{
 assert.equal(resolveDeploymentContext({host:{...wp,mode:'unknown'},verifyHostBinding:callback}).reason,'UNSUPPORTED_MODE');
 assert.equal(resolveDeploymentContext({host:{host_kind:'platform',mode:'dedicated_isolated',selection:'automatic',scope:{...base,deployment_ref:'d'}},verifyHostBinding:callback}).reason,'DEFAULT_MODE_DISAGREEMENT');
});

test('WordPress local scope stays review-only, unknown environment rejected',()=>{const local={...wp,scope:{...wp.scope,environment:'local'}};const result=resolveDeploymentContext({host:local,verifyHostBinding:callback});assert.equal(result.scope.environment,'local');assert.equal(result.execution_authorized,false);assert.equal(result.publication_authorized,false);assert.equal(resolveDeploymentContext({host:{...wp,scope:{...wp.scope,environment:'bad'}},verifyHostBinding:callback}).reason,'WP_ENVIRONMENT_UNRECOGNIZED')});
