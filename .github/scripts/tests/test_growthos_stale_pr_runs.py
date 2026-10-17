import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

script = pathlib.Path(__file__).resolve().parents[1] / "growthos_stale_pr_runs.py"
spec = importlib.util.spec_from_file_location("growthos_stale_pr_runs", script)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def check(run_id, sha, pr=8581, event="pull_request", status="queued", branch="feature"):
    return {
        "id": run_id, "head_sha": sha, "event": event,
        "status": status, "head_branch": branch,
        "pull_requests": [{"number": pr}],
    }


class CiRunHygieneContract(unittest.TestCase):
    def test_only_old_exact_pr_ci(self):
        self.assertTrue(module.is_superseded(check(7, "old"), 8581, "new", "feature"))
        for sample in [
            check(8, "new"), check(9, "old", pr=8582),
            check(10, "old", event="workflow_dispatch"),
            check(11, "old", event="pull_request_target"),
            check(12, "old", status="completed"),
            check(13, "old", branch="other"),
        ]:
            self.assertFalse(module.is_superseded(sample, 8581, "new", "feature"))

    def test_unattributed_workflow_runs_remain_untouched(self):
        run = check(14, "old")
        run["pull_requests"] = []
        self.assertFalse(module.is_superseded(run, 8581, "new", "feature"))

    def test_live_head_change_rejected(self):
        pr = {"state": "open", "base": {"ref": "main"},
              "head": {"sha": "different", "ref": "feature",
                       "repo": {"full_name": "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os"}}}
        with patch.object(module, "api", return_value=pr):
            with self.assertRaisesRegex(RuntimeError, "PR_HEAD_MOVED"):
                module.current_pr("mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os", 8581, "expected", "TOKEN")

    def test_exact_list_scoping_and_deduplication(self):
        def fake_api(method, repo, path, token):
            if "status=queued" in path:
                return {"workflow_runs": [check(17, "old"), check(17, "old"), check(18, "new"), check(19, "old", pr=8582)]}
            return {"workflow_runs": []}
        with patch.object(module, "api", side_effect=fake_api):
            runs = module.list_stale("mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
                                     8581, "new", "feature", "TOKEN")
        self.assertEqual([x["id"] for x in runs], [17])


if __name__ == "__main__":
    unittest.main()
