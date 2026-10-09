#!/usr/bin/env python3
"""Adversarial validation of inert seed using only stdlib."""
import copy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from validate_seed import ROOT, validate

assert not validate(), validate()
manifest = json.loads((ROOT/"manifest.json").read_text(encoding="utf-8"))
contents = {p:(ROOT/p).read_bytes() for p in manifest["files"]}

def negative(label, rel, change, expected):
    with TemporaryDirectory() as td:
        root=Path(td)
        for path,payload in contents.items():
            out=root/path
            out.parent.mkdir(parents=True,exist_ok=True)
            out.write_bytes(payload)
        obj=json.loads((root/rel).read_text(encoding="utf-8"))
        change(obj)
        (root/rel).write_text(json.dumps(obj),encoding="utf-8")
        faults=validate(root)
        assert any(expected in x for x in faults),(label,faults)
        print("PASS denied:",label)

negative("production enabled","manifest.json",lambda x:x.update(production_authorized=True),"unsafe_manifest")
negative("credential in seed","manifest.json",lambda x:x.update(credentials_included=True),"unsafe_manifest")
negative("source locator leakage","source-connectors.json",lambda x:x["semantic_source_aliases"][0].update(source_id="a-secret-file-id"),"private_source_binding_embedded")
negative("implicit global priority","authority-rules.json",lambda x:x["context_authority"].update(no_global_source_priority=False),"unsafe_global_priority")
negative("claim permission confusion","authority-rules.json",lambda x:x["context_authority"].update(explicitly_distinct=[]),"context_execution_authority_blur")
negative("brand example claim","examples/empty-software-vendor.json",lambda x:x["fields"][0].update(candidate_value="A real brand",status="APPROVED"),"example_injects_business_facts")
negative("relation escalation","ontology-registry.json",lambda x:x["relations"][0].update(delegates_execution_authority=True),"relations_must_not_authorize")
negative("closed dimensions","ontology-registry.json",lambda x:x.update(custom_dimensions_allowed=False),"extension_locked")
negative("cyclic packs","profile-packs.json",lambda x:x["profile_packs"][0].update(extends_pack="software_vendor"),"profile_cycle")
negative("acceptance false pass","workflow.json",lambda x:x["acceptance"][0].update(status="PASS"),"acceptance_false_pass")
negative("secret value schema", "schemas/candidate-claim.schema.json", lambda x:x["properties"]["candidate"]["properties"]["sensitivity"]["enum"].append("secret"), "secret_candidate_value_schema")
print("BUSINESS_CONTEXT_SEED_ADVERSARIAL_TESTS: PASS_STATIC_ONLY")
