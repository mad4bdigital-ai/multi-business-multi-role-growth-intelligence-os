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
original_build = module.build_driver_source


def extract_pinned_source() -> str:
    source = original_extract()
    old = 'f"origin/{builder_branch}:{workflow_path}"'
    new = f'f"{ORIGINAL_BUILDER_COMMIT}:{{workflow_path}}"'
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"inner builder source expression mismatch: {count}")
    return source.replace(old, new, 1)


def build_with_open_draft_race_fixture() -> str:
    source = original_build()
    marker = "    tests = []\n    if patch.returncode == 0:\n"
    if source.count(marker) != 1:
        raise RuntimeError(f"diagnostic test marker mismatch: {source.count(marker)}")
    injection = '''    if patch.returncode == 0:
        race_path = Path("http-generic-api/test-github-repository-lifecycle.mjs")
        race_test = race_path.read_text()
        race_anchor = '{ status: 200, payload: { number: 4386, draft: true, base:'
        race_value = '{ status: 200, payload: { number: 4386, state: "open", draft: true, base:'
        race_count = race_test.count(race_anchor)
        if race_count != 1:
            raise RuntimeError(f"Draft race fixture anchor mismatch: {race_count}")
        race_path.write_text(race_test.replace(race_anchor, race_value, 1))

'''
    return source.replace(marker, injection + marker, 1)


module.extract_v6_source = extract_pinned_source
module.build_driver_source = build_with_open_draft_race_fixture
module.REPORT_PATH = REPORT_PATH
raise SystemExit(module.main())
