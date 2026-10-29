import copy
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import guardian


POLICY = {
    "schema_version": 1, "mode": "report_only", "minimum_age_days": 3,
    "max_entries_per_root": 20, "max_reported_candidates": 20,
    "size_probe_timeout_seconds": 2, "prohibited_prefixes": ["systemd-private-"],
    "protected_names": [".X11-unix"], "disk_warning_percent": 80,
    "swap_warning_percent": 90,
}


class GuardianTests(unittest.TestCase):
    def test_never_deletes_and_marks_git_checkout_for_review(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            checkout = root / "repo-checkout"
            checkout.mkdir()
            (checkout / ".git").mkdir()
            (checkout / "uncommitted-file").write_text("preserve")
            archive = root / "temporary-build"
            archive.mkdir()
            (archive / "artifact").write_text("test")
            active = root / "fresh"
            active.mkdir()
            protected = root / "systemd-private-abc"
            protected.mkdir()
            link = root / "symlink"
            link.symlink_to(checkout)
            old = time.time() - 5 * 86400
            for p in (checkout, archive, protected):
                os.utime(p, (old, old))
            p = copy.deepcopy(POLICY)
            p["temporary_roots"] = [str(root)]
            result = guardian.generate(p)
            by_name = {Path(x["path"]).name: x for x in result["largest_candidates"]}
            self.assertEqual(result["destructive_actions_executed"], 0)
            self.assertIn("repo-checkout", by_name)
            self.assertIn("temporary-build", by_name)
            self.assertEqual(by_name["repo-checkout"]["classification"],
                             "git_checkout_preserve_for_review")
            self.assertFalse(any(c["eligible_for_automatic_deletion"] for c in by_name.values()))
            for name in ("systemd-private-abc", "symlink", "fresh"):
                self.assertNotIn(name, by_name)
            self.assertTrue((checkout / "uncommitted-file").exists())

    def test_rejects_destructive_mode_and_root_scan(self):
        p = copy.deepcopy(POLICY)
        p["temporary_roots"] = ["/"]
        with self.assertRaises(ValueError):
            guardian.generate(p)
        p["temporary_roots"] = []
        p["mode"] = "apply"
        with self.assertRaises(ValueError):
            guardian.generate(p)

    def test_reports_capacity_without_attempting_swap_reclaim(self):
        p = copy.deepcopy(POLICY)
        p["temporary_roots"] = []
        result = guardian.generate(p)
        self.assertIn("memory_pressure", result)
        self.assertEqual(result["destructive_actions_executed"], 0)


if __name__ == "__main__":
    unittest.main()
