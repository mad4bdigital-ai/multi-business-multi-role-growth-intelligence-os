"""Contract tests for GitHub-first temporary checkout lifecycle.

Uses disposable local bare Git repos. Production code accepts GitHub only;
the origin parser is mocked solely to exercise the Git operations offline.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import branch_lifecycle as lifecycle


def cmd(*args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout.strip()


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.workspace = tempfile.TemporaryDirectory(prefix='lifecycle-test-')
        self.checkout = Path(tempfile.mkdtemp(prefix='mad4b-test-', dir='/tmp'))
        self.origin = Path(self.workspace.name) / 'origin.git'
        cmd('git', 'init', '--bare', '-q', str(self.origin))
        cmd('git', 'init', '-q', '-b', 'feature/test', str(self.checkout))
        cmd('git', '-C', str(self.checkout), 'config', 'user.name', 'Automation Test')
        cmd('git', '-C', str(self.checkout), 'config', 'user.email', 'ci@example.invalid')
        (self.checkout / 'readme.txt').write_text('safe tracked content\n')
        cmd('git', '-C', str(self.checkout), 'add', 'readme.txt')
        cmd('git', '-C', str(self.checkout), 'commit', '-qm', 'Create a tracked commit')
        cmd('git', '-C', str(self.checkout), 'remote', 'add', 'origin', str(self.origin))
        self.branch = 'archive/qa-test-20261029'
        self.receipt = Path(self.workspace.name) / 'receipt.json'
        self.fake_origin = mock.patch.object(lifecycle, 'github_origin', return_value='mad4bdigital-ai/demo')
        self.fake_origin.start()

    def tearDown(self):
        self.fake_origin.stop()
        if self.checkout.exists():
            import shutil
            shutil.rmtree(self.checkout)
        self.workspace.cleanup()

    def test_publish_verify_and_explicit_cleanup(self):
        result = lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)
        self.assertTrue(result['eligible_for_cleanup'])
        self.assertEqual(result['local_sha'], result['github_sha'])
        self.assertTrue(self.receipt.exists())
        self.assertEqual(self.receipt.stat().st_mode & 0o777, 0o600)
        dry = lifecycle.cleanup(self.checkout, self.branch, self.receipt, apply=False)
        self.assertFalse(dry['deleted'])
        self.assertTrue(self.checkout.exists())
        with mock.patch.object(lifecycle, 'require_root_deletion'):
            applied = lifecycle.cleanup(self.checkout, self.branch, self.receipt, apply=True)
        self.assertTrue(applied['deleted'])
        self.assertFalse(self.checkout.exists())
        self.assertTrue(self.receipt.exists())

    def test_dirty_changes_are_never_pushed_or_removed(self):
        (self.checkout / 'readme.txt').write_text('unsaved edits')
        with self.assertRaisesRegex(lifecycle.GuardError, 'uncommitted'):
            lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)
        self.assertIsNone(lifecycle.remote_tip(self.checkout, self.branch))
        self.assertTrue(self.checkout.exists())

    def test_ignored_local_evidence_blocks_publishing(self):
        (self.checkout / '.gitignore').write_text('evidence.json\n')
        cmd('git', '-C', str(self.checkout), 'add', '.gitignore')
        cmd('git', '-C', str(self.checkout), 'commit', '-qm', 'Ignore generated evidence')
        (self.checkout / 'evidence.json').write_text('unique and not on GitHub')
        with self.assertRaisesRegex(lifecycle.GuardError, 'ignored files'):
            lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)
        self.assertTrue((self.checkout / 'evidence.json').exists())

    def test_existing_conflicting_archive_branch_never_force_pushed(self):
        lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)
        (self.checkout / 'readme.txt').write_text('new safe content')
        cmd('git', '-C', str(self.checkout), 'commit', '-qam', 'New commit')
        with self.assertRaisesRegex(lifecycle.GuardError, 'never force push'):
            lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)
        self.assertTrue(self.checkout.exists())

    def test_receipt_mismatch_blocks_cleanup(self):
        lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)
        record = json.loads(self.receipt.read_text())
        record['local_sha'] = '0' * 40
        self.receipt.write_text(json.dumps(record))
        with self.assertRaisesRegex(lifecycle.GuardError, 'receipt mismatch'):
            lifecycle.cleanup(self.checkout, self.branch, self.receipt, apply=True)
        self.assertTrue(self.checkout.exists())

    def test_multiple_branches_blocks(self):
        cmd('git', '-C', str(self.checkout), 'branch', 'feature/another')
        with self.assertRaisesRegex(lifecycle.GuardError, 'multiple or zero local branch'):
            lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)

    def test_rejects_external_git_directory(self):
        other = Path(self.workspace.name) / 'other'
        cmd('git', '-C', str(self.checkout), 'worktree', 'add', '-q', '-b', 'feature/other', str(other))
        with self.assertRaisesRegex(lifecycle.GuardError, 'linked worktrees'):
            lifecycle.publish(self.checkout, self.branch, self.receipt, reviewed=True)

    def test_publish_requires_explicit_review(self):
        with self.assertRaisesRegex(lifecycle.GuardError, 'explicit --reviewed'):
            lifecycle.publish(self.checkout, self.branch, self.receipt)

    def test_invalid_remote_and_ref(self):
        self.fake_origin.stop()
        try:
            for url in ('https://github.evil.invalid/x/y.git', 'https://pass:token@github.com/x/y.git',
                        'file:///tmp/any', 'https://github.com/x/y/z.git',
                        'https://github.com/untrusted-other-owner/test.git'):
                with self.assertRaises(lifecycle.GuardError):
                    lifecycle.github_origin(url)
            for name in ('main', 'archive/a', 'archive/../test', 'archive/x.lock', 'archive/foo@bar'):
                with self.assertRaises(lifecycle.GuardError):
                    lifecycle.branch_ref(name)
            self.assertEqual(lifecycle.github_origin('git@github.com:mad4bdigital-ai/test.git'),
                             'mad4bdigital-ai/test')
        finally:
            self.fake_origin.start()

    def test_rejects_non_temp_target(self):
        with self.assertRaisesRegex(lifecycle.GuardError, 'only a named'):
            lifecycle.require_temp_root(Path('/opt/someproject'))
        with self.assertRaises(lifecycle.GuardError):
            lifecycle.require_temp_root(Path('/tmp/mad4b-test/../etc'))


if __name__ == '__main__':
    unittest.main()
