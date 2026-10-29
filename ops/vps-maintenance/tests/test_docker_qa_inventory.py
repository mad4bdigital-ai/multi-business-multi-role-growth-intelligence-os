import datetime as dt
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from docker_qa_inventory import describe, inventory, parse_utc

NOW = dt.datetime(2026, 10, 29, 15, tzinfo=dt.timezone.utc)


def labels(expiry="2026-10-25T12:00:00Z"):
    return {"ops.lifecycle": "ephemeral", "ops.environment": "qa",
            "ops.owner": "qa-team", "ops.expires_at": expiry}


def sample(name="qa-temp", labels=None, mounts=None, status="running"):
    return {"Id": "a"*64, "Name": "/"+name,
            "Config": {"Labels": labels or {}, "Env": ["SECRET=DO_NOT_REPORT"]},
            "HostConfig": {"RestartPolicy": {"Name": "no"}, "PortBindings": {}},
            "State": {"Status": status}, "Mounts": mounts or []}


class ContainerLifecycleTests(unittest.TestCase):
    def test_expired_is_manual_not_delete(self):
        x = describe(sample(labels=labels()), NOW)
        self.assertEqual(x["lifecycle"], "expired_qa_manual_review")
        self.assertFalse(x["cleanup_authorized"])

    def test_preserves_data_managed_and_critical(self):
        cases = [
            sample("coolify-db", labels()), sample("qa-postgres", labels()),
            sample(labels=labels(), mounts=[{"Type": "volume"}]),
            sample(labels=labels(), mounts=[{"Type": "bind"}]),
            sample(labels={**labels(), "coolify.managed": "true"})
        ]
        for x in cases:
            self.assertTrue(describe(x, NOW)["lifecycle"].startswith("protected"))

    def test_legacy_qa_is_only_possible(self):
        self.assertEqual(describe(sample("mad4b-tenant-qa02-php"), NOW)["lifecycle"],
                         "possible_qa_manual_review")
        self.assertEqual(describe(sample("unidentified"), NOW)["lifecycle"], "unclassified_preserve")

    def test_bad_labels(self):
        self.assertIsNone(parse_utc("2026-10-29"))
        self.assertIsNone(parse_utc("2026-99-29T01:02:03Z"))
        self.assertEqual(describe(sample(labels=labels("nope")), NOW)["lifecycle"],
                         "incomplete_or_invalid_qa_labels")

    def test_future_expiry(self):
        self.assertEqual(describe(sample(labels=labels("2026-11-02T12:00:00Z")), NOW)["lifecycle"],
                         "labelled_qa_not_expired")

    def test_aggregate_excludes_secrets_and_never_mutates(self):
        result = inventory([sample(labels=labels()), sample("coolify-db")], NOW)
        self.assertEqual(result["running"], 2)
        self.assertEqual(result["total"], 2)
        self.assertEqual(result["operations_performed"], [])
        self.assertFalse(result["automatic_stop"])
        self.assertFalse(result["automatic_removal"])
        self.assertNotIn("SECRET", str(result))
