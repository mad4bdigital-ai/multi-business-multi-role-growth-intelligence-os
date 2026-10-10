#!/usr/bin/env python3
"""Offline negative controls for the content fabric only."""
from pathlib import Path
from tempfile import TemporaryDirectory
import json
from validate_content_fabric import ROOT,FILES,validate

assert validate()==[], validate()
source={p:(ROOT/p).read_text(encoding="utf-8") for p in FILES.values()}
def denial(label,path,mutate,needle):
    with TemporaryDirectory() as dir:
        root=Path(dir)
        for name,body in source.items():
            out=root/name; out.parent.mkdir(parents=True,exist_ok=True);out.write_text(body,encoding="utf-8")
        obj=json.loads((root/path).read_text(encoding="utf-8"))
        mutate(obj)
        (root/path).write_text(json.dumps(obj),encoding="utf-8")
        found=validate(root)
        assert any(needle in f for f in found),(label,found)
        print("PASS negative",label)
denial("enable strategy authority",FILES["strategy"],lambda v:v.update(configuration_grants_authority=True),"content_strategy_authority_bypass")
denial("duplicate style",FILES["styles"],lambda v:v["archetypes"].append(v["archetypes"][0]),"editorial_archetype_inventory")
denial("fabricated testimonial allowed",FILES["styles"],lambda v:v["copy_safety"].update(fabricated_testimonials=True),"editorial_fact_and_ethics")
denial("loosen base policy",FILES["personal"],lambda v:v["precedence"][0].update(can_relax=True),"personalization_precedence")
denial("import lead contacts",FILES["personal"],lambda v:v["input_policy"].update(lead_contact_data_disallowed_in_seed=False),"personalization_privacy_or_execution")
denial("auto publication",FILES["blueprint"],lambda v:v["templates"][0].update(publication_enabled=True),"content_blueprint_content_or_authority")
denial("detach proof",FILES["blueprint"],lambda v:v["single_idea_multi_output"].update(claims_must_remain_linked=False),"content_blueprint_untracked_reuse")
denial("disable placeholder flag",FILES["planning"],lambda v:v["quality_flags"].pop(3),"calendar_required_detection")
denial("allow direct import",FILES["planning"],lambda v:v["source_import"].update(import_mode="APPROVED"),"calendar_import_authority")
denial("bypass timezone",FILES["planning"],lambda v:v["schedule_rules"].update(timezone_mandatory=False),"calendar_schedule_bypass")
print("CONTENT_FABRIC_ADVERSARIAL_TESTS: PASS_STATIC_ONLY")
