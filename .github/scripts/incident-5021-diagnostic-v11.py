from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

V10_PATH = Path("/tmp/incident-5021-diagnostic-v10.py")
ORIGINAL_BUILDER_COMMIT = "1b587906cfa137ce0b2f20b6efd2404c159f32fd"
REPORT_PATH = "incident-5021-builder-diagnostic-v11.json"

spec = spec_from_file_location("incident_5021_diagnostic_v10", V10_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("unable to load V10 diagnostic module")
module = module_from_spec(spec)
spec.loader.exec_module(module)

original_extract = module.extract_v6_source


def extract_pinned_source() -> str:
    source = original_extract()
    old = 'f"origin/{builder_branch}:{workflow_path}"'
    new = f'f"{ORIGINAL_BUILDER_COMMIT}:{{workflow_path}}"'
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"inner builder source expression mismatch: {count}")
    return source.replace(old, new, 1)


module.extract_v6_source = extract_pinned_source
module.REPORT_PATH = REPORT_PATH
raise SystemExit(module.main())
