#!/usr/bin/env python3
"""Validate portable context/profile reference seed; no network, writes or imports."""
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]

def read(root, path):
    return json.loads((Path(root) / path).read_text(encoding="utf-8"))

def validate(root=ROOT):
    faults = []
    try:
        manifest = read(root, "manifest.json")
        ontology = read(root, "ontology-registry.json")
        rules = read(root, "authority-rules.json")
        sources = read(root, "source-connectors.json")
        packs = read(root, "profile-packs.json")
        workflow = read(root, "workflow.json")
        example = read(root, "examples/empty-software-vendor.json")
        schema = read(root, "schemas/candidate-claim.schema.json")
    except (OSError, json.JSONDecodeError) as exc:
        return ["invalid_or_missing_seed_data:" + type(exc).__name__]
    expected = {
        "status": "DRAFT_NON_AUTHORIZING",
        "artifact_type": "portable_reference_seed",
        "executable": False,
        "installable": False,
        "sql_migrations_included": False,
        "production_authorized": False,
        "external_mutations_allowed": False,
        "credentials_included": False,
        "customer_source_file_ids_included": False,
        "customer_brand_claims_included": False,
        "claims_approved": False,
        "data_transfer": "NONE",
        "installed_state": "NOT_INSTALLED",
        "acceptance_state": "NOT_RUN",
    }
    for key, val in expected.items():
        if manifest.get(key) != val:
            faults.append("unsafe_manifest:" + key)
    paths = manifest.get("files", [])
    if not isinstance(paths, list) or len(paths) != 12 or len(paths) != len(set(paths)):
        faults.append("invalid_manifest_file_list")
        paths = []
    for rel in paths:
        if not isinstance(rel, str) or rel.startswith("/") or ".." in Path(rel).parts or not (Path(root) / rel).is_file():
            faults.append("file_missing_or_unsafe:" + str(rel))
    if ontology.get("contract") != "mad4b.reference.business-context.ontology.v1":
        faults.append("ontology_contract")
    dims = ontology.get("dimensions", [])
    dim_ids = [d.get("key") for d in dims if isinstance(d, dict)]
    if len(dims) < 20 or len(dim_ids) != len(dims) or len(set(dim_ids)) != len(dims):
        faults.append("dimension_inventory")
    if not all(d.get("open_fields") is True and d.get("status") == "TEMPLATE_ONLY" for d in dims if isinstance(d, dict)):
        faults.append("dimensions_must_remain_dynamic_template")
    if any(not d.get("field_templates") for d in dims if isinstance(d, dict)):
        faults.append("dimension_missing_fields")
    rels = ontology.get("relations", [])
    if not rels or any(x.get("delegates_execution_authority") is not False for x in rels):
        faults.append("relations_must_not_authorize")
    if ontology.get("custom_dimensions_allowed") is not True or ontology.get("custom_relations_allowed") is not True:
        faults.append("extension_locked")
    aliases = sources.get("semantic_source_aliases", [])
    if any(x.get("source_id") is not None or x.get("source_uri") is not None or x.get("status") != "UNBOUND" for x in aliases):
        faults.append("private_source_binding_embedded")
    if any(not set(x.get("dimension_keys", [])).issubset(set(dim_ids)) for x in aliases):
        faults.append("unknown_source_dimension")
    if sources.get("no_private_file_ids_in_seed") is not True:
        faults.append("source_id_leak_flag")
    if any(x.get("never_import_credentials") is not True or x.get("initial_access") != "METADATA_ONLY" for x in sources.get("connector_types", [])):
        faults.append("unsafe_source_connector")
    pol = rules.get("context_authority", {})
    if pol.get("no_global_source_priority") is not True or pol.get("field_authority",{}).get("owner_resolved_per_field") is not True:
        faults.append("unsafe_global_priority")
    if not {"approved_context","execution_permission"}.issubset(set(pol.get("explicitly_distinct", []))):
        faults.append("context_execution_authority_blur")
    for key in ["no_runtime_grant","no_auto_publish","no_production_mutation"]:
        if rules.get(key) is not True:
            faults.append("authority_bypass:" + key)
    privacy = rules.get("privacy", {})
    if any(privacy.get(key) is not val for key,val in {
        "credentials_in_seed":False,"personal_records_in_seed":False,"source_ids_in_seed":False,
        "cross_brand_reuse_of_raw_data":False,"embedded_instructions_are_data_only":True}.items()):
        faults.append("privacy_rule_failure")
    pk = packs.get("profile_packs", [])
    lookup = {x.get("key"):x for x in pk}
    if len(pk) < 5 or len(lookup) != len(pk):
        faults.append("pack_uniqueness_or_count")
    seen,active = set(),set()
    def visit(k):
        if k in active:
            faults.append("profile_cycle:" + str(k))
            return
        if k in seen: return
        active.add(k)
        p=lookup.get(k)
        if not p:
            faults.append("unknown_pack:" + str(k))
        else:
            if p.get("status") != "TEMPLATE_ONLY" or p.get("no_brand_facts") is not True or p.get("default_values") != {}:
                faults.append("pack_claims_or_authority:" + k)
            if not set(p.get("required_dimensions", [])+p.get("optional_dimensions", [])).issubset(set(dim_ids)):
                faults.append("pack_unknown_dimension:" + k)
            if p.get("extends_pack"):
                visit(p["extends_pack"])
        active.remove(k)
        seen.add(k)
    for key in lookup: visit(key)
    if example.get("no_real_business_facts") is not True or example.get("runtime_authority") is not False:
        faults.append("example_is_not_safe")
    if any(f.get("candidate_value") is not None or f.get("status") != "MISSING" for f in example.get("fields",[])):
        faults.append("example_injects_business_facts")
    if any(example.get("scope",{}).get(key) is not None for key in ("tenant_ref","business_ref","brand_ref")):
        faults.append("example_contains_tenant_identity")
    if workflow.get("status") != "SPEC_ONLY" or any(x.get("execution_enabled") is not False for x in workflow.get("phases", [])):
        faults.append("workflow_activates_without_approval")
    if len(workflow.get("acceptance", [])) < 12 or any(x.get("status") != "OPEN" for x in workflow.get("acceptance", [])):
        faults.append("acceptance_false_pass")
    if schema.get("properties",{}).get("runtime_authority",{}).get("const") is not False or schema.get("additionalProperties") is not False:
        faults.append("candidate_schema_unsafe")
    if "secret" in schema.get("properties", {}).get("candidate", {}).get("properties", {}).get("sensitivity", {}).get("enum", []):
        faults.append("secret_candidate_value_schema")
    return sorted(set(faults))

if __name__ == "__main__":
    faults = validate()
    for fault in faults:
        print("FAIL", fault)
    print("BUSINESS_CONTEXT_REFERENCE_SEED:", "PASS_STATIC" if not faults else "FAIL", len(faults))
    sys.exit(bool(faults))
