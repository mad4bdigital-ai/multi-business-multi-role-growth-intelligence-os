import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

const [service, presentation, routes, routeIndex, openapi, migration, invocationMigration] = await Promise.all([
  read("activationGuidanceService.js"),
  read("activationGuidancePresentation.js"),
  read("routes/activationGuidanceRoutes.js"),
  read("routes/index.js"),
  read("openapi.yaml"),
  read("migrations/308_sprint69_activation_guidance_intelligence.sql"),
  read("migrations/309_sprint69_activation_guidance_invocation_registry.sql"),
]);

assert.match(routeIndex, /buildActivationGuidanceRoutes/, "activation guidance routes must be mounted");
assert.match(routes, /\/tenant\/activation\/guidance/, "tenant activation guidance endpoint must exist");
assert.match(routes, /\/admin\/activation\/guidance/, "admin activation guidance endpoint must exist");
assert.match(routes, /requireTenantUserJwt/, "tenant endpoint must be user-JWT scoped");
assert.match(routes, /requireAdminPrincipal/, "admin endpoint must require admin principal");
assert.match(routes, /requestedLocale: req\.query\.locale \|\| req\.query\.language/, "routes must accept explicit locale preference");
assert.match(routes, /acceptLanguage: req\.headers\["accept-language"\]/, "routes must accept client language preference");

assert.match(service, /activation_guidance_intelligence/, "service must declare activation guidance layer");
assert.match(service, /guidance_flow: presentation\.guidance_flow/, "service must expose ordered guidance stages");
assert.match(service, /guidance_paths: presentation\.guidance_paths/, "service must expose tagged guidance paths");
assert.match(service, /command_palette: presentation\.command_palette/, "service must expose command palette");
assert.match(service, /presentation\.localized_activation_brief/, "primary brief must use language-aware presentation");
assert.match(service, /presentation\.localized_recommended_actions/, "primary actions must use language-aware presentation");
assert.match(service, /activation\.guidance\.render_in_user_preferred_language/, "instruction pack must require user-language rendering");
assert.match(service, /activation\.guidance\.keep_invocation_signals_language_neutral/, "instruction pack must preserve stable machine signals");
assert.match(service, /connected/, "service must include readiness dimensions");
assert.match(service, /skill_granted/, "service must include skill readiness semantics");
assert.match(service, /smoke_certified/, "service must include smoke certification readiness semantics");
assert.match(service, /can_execute/, "service must include execution readiness semantics");
assert.match(service, /SENSITIVE_KEY_PATTERN/, "service must strip sensitive keys");
assert.match(service, /secrets_included: false/, "service must explicitly declare no secrets");

assert.match(presentation, /resolveGuidanceLanguagePreference/, "presentation must resolve stored, explicit, header, or conversation language preferences");
assert.match(presentation, /loadGuidanceInvocationRegistry/, "presentation must load dynamic invocation descriptors from the DB registry");
assert.match(presentation, /activation_guidance_invocation_registry/, "presentation must query the invocation registry");
assert.match(presentation, /source: "code_fallback"/, "presentation must retain a safe code fallback when the registry is unavailable");
assert.match(presentation, /registry_source/, "invocation contract must report whether DB registry or fallback was used");
assert.match(presentation, /actor_profiles/, "presentation must read actor profile language preferences when present");
assert.match(presentation, /activation_user_dashboard_preferences/, "presentation must read dashboard language preferences when present");
assert.match(presentation, /assistant_detects_user_language/, "presentation must fall back to conversation language detection");
assert.match(presentation, /@activation\/status/, "activation stage must expose an invocation tag");
assert.match(presentation, /@workspace\/overview/, "workspace path must expose an invocation tag");
assert.match(presentation, /@brand\/readiness/, "brand path must expose an invocation tag");
assert.match(presentation, /\/commands/, "command palette must expose slash aliases");
assert.match(presentation, /Invocation signals select a guidance path; they do not bypass readiness, authorization, approval, or runtime validation/, "tags must not bypass governance");
assert.match(presentation, /stable_machine_signal: true/, "invocation signals must be stable machine-readable values");
assert.match(presentation, /tags_are_language_neutral: true/, "tags must remain language neutral");
assert.match(presentation, /localized_recommended_actions/, "presentation must return localized actions");
assert.match(presentation, /localized_activation_brief/, "presentation must return localized brief");
assert.match(presentation, /best_next_action: bestAction/, "presentation summary must use the localized best next action");
assert.doesNotMatch(presentation, /best_next_action: activationBrief\?\.best_next_action/, "presentation summary must not return the raw unlocalized action");

assert.match(openapi, /operationId: getTenantActivationGuidance/, "OpenAPI must document tenant guidance endpoint");
assert.match(openapi, /operationId: getAdminActivationGuidance/, "OpenAPI must document admin guidance endpoint");
assert.match(openapi, /name: Accept-Language/, "OpenAPI must document Accept-Language support");
assert.match(openapi, /language_context:/, "OpenAPI must document language context");
assert.match(openapi, /invocation_contract:/, "OpenAPI must document invocation contract");
assert.match(openapi, /guidance_flow:/, "OpenAPI must document ordered guidance flow");
assert.match(openapi, /command_palette:/, "OpenAPI must document command palette");
assert.match(openapi, /ActivationGuidanceResponse/, "OpenAPI must include activation guidance schema");

assert.match(migration, /tenant_activation_guidance_read_api/, "migration must seed tenant guidance tool");
assert.match(migration, /admin_activation_guidance_read_api/, "migration must seed admin guidance tool");
assert.match(migration, /tenant_activation_guidance/, "migration must seed tenant operational tile");
assert.match(migration, /admin_activation_guidance/, "migration must seed admin operational tile");
assert.match(migration, /proactive_guidance/, "registry seed must mark guidance as proactive");
assert.match(invocationMigration, /activation_guidance_invocation_registry/, "invocation registry migration must create the dynamic path registry");
assert.match(invocationMigration, /@activation\/status/, "invocation registry must seed activation tags");
assert.match(invocationMigration, /@workspace\/overview/, "invocation registry must seed workspace tags");
assert.match(invocationMigration, /@brand\/readiness/, "invocation registry must seed brand tags");
assert.match(invocationMigration, /slash_alias/, "invocation registry must seed slash aliases");
assert.match(invocationMigration, /intent_key/, "invocation registry must seed intent keys");
assert.match(invocationMigration, /requires_confirmation/, "invocation registry must preserve confirmation semantics");
assert.doesNotMatch(invocationMigration, /authorization\s*=|password\s*=|private_key|raw_token/i, "invocation registry must not include credentials or secret material");
assert.doesNotMatch(migration, /POST \/tenant\/activation\/guidance/, "tenant guidance must not be mutating");
assert.doesNotMatch(migration, /connector_secret|raw_token|private_key|password\s*=/i, "migration must not seed raw secret material");

console.log("activation guidance intelligence flow contract tests passed");
