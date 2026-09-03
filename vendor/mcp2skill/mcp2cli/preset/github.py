"""Git SSH operations for preset publishing."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import click


class GitError(Exception):
    pass


def push_branch(
    ssh_url: str,
    branch: str,
    files: list[tuple[str, bytes]],
    commit_msg: str,
) -> bool:
    """Clone repo via SSH, write files on a new branch, then push.

    Args:
        ssh_url: SSH URL of the repo (e.g. git@github.com:owner/repo.git).
        branch: Branch name to create (e.g. preset/mcp-atlassian-1.3.0).
        files: List of (repo_relative_path, file_bytes) to write.
        commit_msg: Git commit message.

    Returns:
        True on success, False on failure.
    """
    with tempfile.TemporaryDirectory(prefix="mcp2cli-push-") as tmpdir:
        # Clone
        click.echo(f"  Cloning {ssh_url}...")
        result = subprocess.run(
            ["git", "clone", "--depth=1", ssh_url, tmpdir],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            click.echo(f"  Error: git clone failed:\n{result.stderr.strip()}", err=True)
            return False

        # Create branch
        result = subprocess.run(
            ["git", "checkout", "-b", branch],
            cwd=tmpdir, capture_output=True, text=True,
        )
        if result.returncode != 0:
            click.echo(
                f"  Error: could not create branch '{branch}':\n{result.stderr.strip()}",
                err=True,
            )
            return False

        # Write files
        click.echo(f"  Writing {len(files)} files...")
        for rel_path, content in files:
            target = Path(tmpdir) / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)

        # Stage
        subprocess.run(
            ["git", "add", "-A"],
            cwd=tmpdir, check=True, capture_output=True,
        )

        # Commit
        result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=tmpdir, capture_output=True, text=True,
        )
        if result.returncode != 0:
            click.echo(f"  Error: git commit failed:\n{result.stderr.strip()}", err=True)
            return False

        # Push
        click.echo(f"  Pushing branch '{branch}'...")
        result = subprocess.run(
            ["git", "push", "origin", branch],
            cwd=tmpdir, capture_output=True, text=True,
        )
        if result.returncode != 0:
            click.echo(f"  Error: git push failed:\n{result.stderr.strip()}", err=True)
            return False

    return True
