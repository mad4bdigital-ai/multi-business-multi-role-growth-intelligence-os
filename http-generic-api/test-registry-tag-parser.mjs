import assert from "node:assert/strict";
import { normalizeRegistryTags } from "./registryTagParser.js";

assert.deepEqual(normalizeRegistryTags(["admin", " state_changing ", "admin", null]), ["admin", "state_changing"]);
assert.deepEqual(normalizeRegistryTags('["admin","state_changing","typed_confirmation"]'), ["admin", "state_changing", "typed_confirmation"]);
assert.deepEqual(normalizeRegistryTags("admin, state_changing, typed_confirmation, admin"), ["admin", "state_changing", "typed_confirmation"]);
assert.deepEqual(normalizeRegistryTags(""), []);
assert.deepEqual(normalizeRegistryTags(null), []);
assert.deepEqual(normalizeRegistryTags("[not-json],admin"), ["[not-json]", "admin"]);

console.log("registry tag parser tests passed");
