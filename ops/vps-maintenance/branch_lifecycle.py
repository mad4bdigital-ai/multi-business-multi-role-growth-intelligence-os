#!/usr/bin/env python3
"""Publish a reviewed temporary checkout to GitHub, verify, then optionally remove.

No recursive deletion without an explicit --apply and exact remote receipt.
Never stages, commits, rewrites history, force-pushes, or changes GitHub defaults.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse

ALLOWED_ROOTS = (Path('/tmp'), Path('/var/tmp'))
BRANCH_PATTERN = re.compile(r'^archive/[a-zA-Z0-9][a-zA-Z0-9._/-]{2,100}$')
HEX = re.compile(r'^[a-f0-9]{40}$')


class GuardError(Exception):
    pass


def git(path: Path, *args: str, timeout: int = 35) -> str:
    try:
        p = subprocess.run(['git', '-C', str(path), *args], text=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'},
                           check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GuardError(f'git command unavailable or timed out: {args[0]}') from exc
    if p.returncode:
        raise GuardError(f'git command failed: {args[0]}')
    return p.stdout.strip()


def require_temp_root(path: Path) -> Path:
    if not path.is_absolute():
        raise GuardError('absolute checkout path required')
    if '..' in path.parts:
        raise GuardError('dot-dot path components forbidden')
    if path.parent not in ALLOWED_ROOTS or not path.name.startswith(('mad4b-', 'pr', 'skill-')):
        raise GuardError('only a named one-level temporary checkout is allowed')
    if path.is_symlink() or not path.is_dir():
        raise GuardError('checkout must be a real directory')
    if path.resolve() != path:
        raise GuardError('checkout resolves outside declared path')
    if path.is_mount() or any(part.is_symlink() for part in path.parents):
        raise GuardError('symlinked/mounted parent or root')
    if path.stat().st_uid != os.geteuid():
        raise GuardError('checkout owner differs from executing user')
    return path


def assert_no_nested_mounts(root: Path) -> None:
    try:
        mounts = Path('/proc/self/mountinfo').read_text().splitlines()
        points = [m.split(' - ', 1)[0].split()[4].replace('\\040', ' ') for m in mounts]
    except OSError as exc:
        raise GuardError('cannot enumerate mounted filesystems') from exc
    for value in points:
        p = Path(value)
        if p == root or root in p.parents:
            raise GuardError('checkout contains a mounted filesystem')
    base_device = root.stat().st_dev
    for path, dirs, _ in os.walk(root, followlinks=False):
        for d in dirs:
            child = Path(path)/d
            if child.is_symlink():
                continue
            if child.stat().st_dev != base_device:
                raise GuardError('checkout contains different filesystem')


def github_origin(url: str) -> str:
    """Allow standard GitHub SSH/HTTPS remotes of the enrolled owner only."""
    u = url.strip()
    if u.startswith('git@github.com:'):
        path = u.split(':', 1)[1]
    else:
        parsed = urlparse(u)
        if parsed.scheme != 'https' or parsed.hostname != 'github.com' or parsed.port is not None:
            raise GuardError('origin must be GitHub.com over HTTPS or SSH')
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise GuardError('origin contains embedded credentials or unexpected parameters')
        path = parsed.path.lstrip('/')
    if path.endswith('.git'):
        path = path[:-4]
    pieces = path.split('/')
    if len(pieces) != 2 or any(not re.fullmatch(r'[A-Za-z0-9_.-]+', p) for p in pieces):
        raise GuardError('GitHub repo path is invalid')
    if pieces[0] != 'mad4bdigital-ai':
        raise GuardError('GitHub owner not in approved project scope')
    return '/'.join(pieces)


def allowed_local_files(checkout: Path) -> None:
    status = git(checkout, 'status', '--porcelain=v1', '--untracked-files=all')
    if status:
        raise GuardError('uncommitted or untracked content: review, sanitize and commit first')
    ignored = git(checkout, 'ls-files', '--others', '--ignored', '--exclude-standard')
    if ignored:
        raise GuardError('ignored files present: review and remove or archive separately')
    tracked = git(checkout, 'ls-files', '--stage')
    if not tracked.strip():
        raise GuardError('not a usable tracked source checkout')
    if any(line.startswith('160000 ') for line in tracked.splitlines()):
        raise GuardError('git submodules need independent source verification')
    attrs = checkout / '.gitattributes'
    if attrs.is_file() and 'filter=lfs' in attrs.read_text(errors='replace'):
        raise GuardError('Git LFS assets need independent remote proof')


def no_extra_worktrees(checkout: Path) -> None:
    git_dir = Path(git(checkout, 'rev-parse', '--absolute-git-dir')).resolve()
    if git_dir != checkout / '.git':
        raise GuardError('linked worktree or external Git directory')
    records = git(checkout, 'worktree', 'list', '--porcelain').splitlines()
    entries = [line[len('worktree '):] for line in records if line.startswith('worktree ')]
    if entries != [str(checkout)]:
        raise GuardError('linked worktrees or unexpected worktree ownership')
    branches = git(checkout, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').splitlines()
    if len(branches) != 1:
        raise GuardError('multiple or zero local branch tips require separate GitHub proofs')
    sha = git(checkout, 'rev-parse', 'HEAD')
    if branches[0].split()[-1] != sha:
        raise GuardError('local branch contains a different commit from checkout HEAD')


def active_proc_handles(checkout: Path) -> None:
    """Process inspection; deletion additionally requires root privileges."""
    base = str(checkout)
    proc = Path('/proc')
    try:
        pids = [p for p in proc.iterdir() if p.name.isdigit()]
    except OSError as exc:
        raise GuardError('process inventory is not readable') from exc
    for process in pids:
        paths = [process/'cwd', process/'root']
        try:
            paths += list((process/'fd').iterdir())
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
        for fd in paths:
            try:
                target = os.readlink(fd)
            except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
                continue
            if target == base or target.startswith(base+'/'):
                raise GuardError(f'live process {process.name} uses checkout')


def branch_ref(value: str) -> str:
    if not BRANCH_PATTERN.fullmatch(value) or '..' in value or value.endswith(('/', '.lock')):
        raise GuardError('use a unique archive/<ticket>-<timestamp> branch, no unsafe ref')
    return 'refs/heads/'+value


def remote_tip(checkout: Path, branch: str) -> str | None:
    ref = branch_ref(branch)
    data = git(checkout, 'ls-remote', '--heads', 'origin', ref, timeout=30)
    lines = data.splitlines()
    if not lines:
        return None
    if len(lines) != 1:
        raise GuardError('ambiguous GitHub ref match')
    pair = lines[0].split()
    if len(pair) != 2 or pair[1] != ref or not HEX.fullmatch(pair[0]):
        raise GuardError('malformed GitHub response')
    return pair[0]


def inspect(checkout: Path, branch: str, require_remote=True):
    require_temp_root(checkout)
    branch_ref(branch)
    repo = github_origin(git(checkout, 'remote', 'get-url', 'origin'))
    if git(checkout, 'rev-parse', '--is-shallow-repository') == 'true':
        raise GuardError('shallow checkout: ancestry not guaranteed')
    no_extra_worktrees(checkout)
    allowed_local_files(checkout)
    sha = git(checkout, 'rev-parse', 'HEAD')
    if not HEX.fullmatch(sha):
        raise GuardError('invalid commit SHA')
    assert_no_nested_mounts(checkout)
    active_proc_handles(checkout)
    current = remote_tip(checkout, branch)
    if require_remote and current != sha:
        raise GuardError('GitHub archive ref absent or not equal to local HEAD')
    return {'checkout': str(checkout), 'repo': repo, 'archive_branch': branch,
            'local_sha': sha, 'github_sha': current, 'eligible_for_cleanup': current == sha,
            'policy': 'publish-verify-explicit-cleanup'}


def check_receipt_location(path: Path) -> None:
    if not path.is_absolute() or '..' in path.parts or path.is_symlink():
        raise GuardError('receipt path must be absolute, nonsymlinked and canonical')
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise GuardError('receipt directory must exist and be nonsymlinked')
    if path.parent.stat().st_uid != os.geteuid():
        raise GuardError('receipt directory owner mismatch')
    if path.parent.stat().st_mode & 0o077:
        raise GuardError('receipt directory must be private (0700)')


def store_receipt(path: Path, receipt: dict) -> None:
    check_receipt_location(path)
    fd, temp = tempfile.mkstemp(prefix='.git-receipt-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(receipt, stream, sort_keys=True, indent=2)
            stream.write('\n')
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def publish(checkout: Path, branch: str, receipt: Path, *, reviewed=False):
    if not reviewed:
        raise GuardError('publishing to GitHub requires explicit --reviewed after secret and code review')
    check_receipt_location(receipt)
    result = inspect(checkout, branch, require_remote=False)
    if result['github_sha'] is not None:
        if result['github_sha'] != result['local_sha']:
            raise GuardError('archive ref already points elsewhere; never force push')
    else:
        git(checkout, 'push', '--porcelain', 'origin',
            f"{result['local_sha']}:{branch_ref(branch)}", timeout=75)
    result = inspect(checkout, branch, require_remote=True)
    result['verified_at_epoch'] = int(time.time())
    store_receipt(receipt, result)
    return result


def require_root_deletion() -> None:
    if os.geteuid() != 0:
        raise GuardError('cleanup --apply requires root to inspect all process handles')


def cleanup(checkout: Path, branch: str, receipt: Path, apply: bool):
    check_receipt_location(receipt)
    result = inspect(checkout, branch, require_remote=True)
    try:
        saved = json.loads(receipt.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise GuardError('verified receipt missing or corrupt') from exc
    keys = ('checkout', 'repo', 'archive_branch', 'local_sha', 'github_sha')
    if any(saved.get(k) != result.get(k) for k in keys):
        raise GuardError('receipt mismatch; publish and verify current source first')
    if not apply:
        return {**result, 'deleted': False, 'reason': 'dry-run only; --apply needed'}
    require_root_deletion()
    inspect(checkout, branch, require_remote=True)
    shutil.rmtree(checkout)
    return {**result, 'deleted': True, 'reason': 'exact GitHub archived branch verified'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['verify', 'publish', 'cleanup'])
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--branch', required=True, help='archive/<ticket>-<timestamp>')
    parser.add_argument('--receipt', type=Path, help='receipt OUTSIDE checkout, required for publish/cleanup')
    parser.add_argument('--apply', action='store_true', help='cleanup only: explicit destructive action')
    parser.add_argument('--reviewed', action='store_true', help='publish only: confirm reviewed commits and secret scanning')
    args = parser.parse_args(argv)
    if args.apply and args.action != 'cleanup':
        parser.error('--apply applies only to cleanup')
    if args.reviewed and args.action != 'publish':
        parser.error('--reviewed applies only to publish')
    checkout = args.checkout
    try:
        if args.action == 'verify':
            result = inspect(checkout, args.branch, require_remote=False)
        else:
            if args.receipt is None or args.receipt.is_relative_to(checkout):
                raise GuardError('receipt must be provided outside checkout')
            if args.action == 'publish':
                result = publish(checkout, args.branch, args.receipt, reviewed=args.reviewed)
            else:
                result = cleanup(checkout, args.branch, args.receipt, args.apply)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except GuardError as exc:
        print(f'NO-GO: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
