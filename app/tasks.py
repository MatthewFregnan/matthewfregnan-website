"""Building, previewing and publishing the site (runs npm and git)."""
from __future__ import annotations

import functools
import http.server
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

from PySide6.QtCore import QProcess, QProcessEnvironment, QTimer, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QApplication, QDialog, QDialogButtonBox, QLabel, QLineEdit, QPlainTextEdit, QVBoxLayout,
)

import core


def tool_paths() -> str:
    """Apps launched from Finder/Explorer don't get the shell PATH, so add the usual node/git places."""
    extra = ["/opt/homebrew/bin", "/usr/local/bin", str(Path.home() / ".volta/bin")]
    nvm = Path.home() / ".nvm/versions/node"
    if nvm.is_dir():
        extra += [str(d / "bin") for d in sorted(nvm.iterdir(), reverse=True)]
    return os.pathsep.join([*extra, os.environ.get("PATH", "")])


def tool_env() -> QProcessEnvironment:
    env = QProcessEnvironment.systemEnvironment()
    env.insert("PATH", tool_paths())
    return env


def npm() -> str:
    return "npm.cmd" if sys.platform == "win32" else "npm"


def git(repo: core.Repo, *args: str) -> subprocess.CompletedProcess:
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    return subprocess.run(["git", *args], cwd=repo.root, capture_output=True, text=True, encoding="utf-8",
                          env={**os.environ, "PATH": tool_paths()}, creationflags=flags, timeout=20)


# --------------------------------------------------------------------------- what's unpublished

def unpublished_changes(repo: core.Repo) -> list[str]:
    """Plain-English list of what differs from the last commit, e.g. 'Added “KIA Shipyard”'."""
    try:
        head = git(repo, "show", "HEAD:data/projects.json")
        status = git(repo, "status", "--porcelain", "--", "data", "images")
    except (OSError, subprocess.SubprocessError):
        return []
    if status.returncode != 0 or not status.stdout.strip():
        return []
    old = json.loads(head.stdout)["projects"] if head.returncode == 0 else []
    new = repo.load()["projects"]
    key = lambda p: (p.get("category"), p.get("id"))
    strip = lambda p: {k: v for k, v in p.items() if k != "updated"}
    old_by, new_by = {key(p): p for p in old}, {key(p): p for p in new}
    out = [f"Added “{p.get('title')}”" for k, p in new_by.items() if k not in old_by]
    out += [f"Removed “{p.get('title')}”" for k, p in old_by.items() if k not in new_by]
    out += [f"Changed “{p.get('title')}”" for k, p in new_by.items() if k in old_by and strip(p) != strip(old_by[k])]
    same = [k for k in new_by if k in old_by]
    if [k for k in (key(p) for p in old) if k in new_by] != [k for k in (key(p) for p in new) if k in old_by] and same:
        out.append("Reordered projects")
    if not out:
        out.append("Updated images")
    return out


def commit_message(changes: list[str]) -> str:
    if len(changes) == 1:
        return changes[0].replace("“", "").replace("”", "")
    return f"Update portfolio ({len(changes)} changes)"


def sync_from_github(repo: core.Repo) -> str:
    """At launch, quietly pull edits made in the web admin, if nothing local would be disturbed."""
    try:
        if git(repo, "status", "--porcelain", "--", "data", "images").stdout.strip():
            return "You have unpublished changes, so edits made on the web weren't downloaded yet."
        if git(repo, "fetch", "--quiet").returncode != 0:
            return ""
        behind = git(repo, "rev-list", "--count", "HEAD..@{u}").stdout.strip()
        if behind in ("", "0"):
            return ""
        r = git(repo, "pull", "--ff-only", "--quiet")
        return "Downloaded the latest changes from the website." if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


# --------------------------------------------------------------------------- running commands

class TaskDialog(QDialog):
    """Runs a list of commands one after another and shows their output."""

    def __init__(self, parent, title: str, cwd: Path, steps: list[tuple[str, list[str]]], on_success=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        self.resize(640, 400)
        self.steps, self.on_success = list(steps), on_success
        self.log = QPlainTextEdit(readOnly=True)
        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        lay = QVBoxLayout(self)
        lay.addWidget(self.log)
        lay.addWidget(buttons)
        self.proc = QProcess(self)
        self.proc.setProcessEnvironment(tool_env())
        self.proc.setWorkingDirectory(str(cwd))
        self.proc.setProcessChannelMode(QProcess.MergedChannels)
        self.proc.readyReadStandardOutput.connect(
            lambda: self.log.appendPlainText(bytes(self.proc.readAllStandardOutput()).decode(errors="replace").rstrip()))
        self.proc.finished.connect(self._finished)
        self.proc.errorOccurred.connect(self._error)
        QTimer.singleShot(0, self._next)

    def _next(self):
        if not self.steps:
            self.log.appendPlainText("\n✓ Done")
            if self.on_success:
                self.on_success()
            return
        label, cmd = self.steps.pop(0)
        self.log.appendPlainText(f"\n▶ {label}")
        self.proc.start(cmd[0], cmd[1:])

    def _finished(self, code, _status):
        if code == 0:
            self._next()
        else:
            self.log.appendPlainText(f"\n✗ Stopped: the last step failed (exit code {code}).")

    def _error(self, err):
        if err == QProcess.FailedToStart:
            self.log.appendPlainText(f"\n✗ Couldn't start '{self.proc.program()}'. Is it installed?")

    def reject(self):
        if self.proc.state() != QProcess.NotRunning:
            self.proc.kill()
        super().reject()


class Previewer:
    """Builds the site with npm and serves dist/ on a private local port."""

    def __init__(self, repo: core.Repo):
        self.repo = repo
        self.server: http.server.ThreadingHTTPServer | None = None

    def run(self, parent, path: str = "/"):
        steps = []
        if not (self.repo.root / "node_modules").is_dir():
            steps.append(("Installing site tools (first time only)…", [npm(), "ci"]))
        steps.append(("Building site…", [npm(), "run", "build"]))
        TaskDialog(parent, "Preview Site", self.repo.root, steps, on_success=lambda: self._open(path)).exec()

    def _open(self, path: str):
        if not self.server:
            handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(self.repo.root / "dist"))
            handler.log_message = lambda *a: None
            self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            threading.Thread(target=self.server.serve_forever, daemon=True).start()
        QDesktopServices.openUrl(QUrl(f"http://127.0.0.1:{self.server.server_port}{path}"))

    def stop(self):
        if self.server:
            self.server.shutdown()


def publish(parent, repo: core.Repo, changes: list[str], on_done) -> None:
    dlg = QDialog(parent)
    dlg.setWindowTitle("Publish to matthewfregnan.com")
    lay = QVBoxLayout(dlg)
    lay.addWidget(QLabel("These changes will go live a minute or two after publishing:"))
    lst = QPlainTextEdit("\n".join(f"• {c}" for c in changes), readOnly=True)
    lay.addWidget(lst)
    lay.addWidget(QLabel("Note for the change history:"))
    msg = QLineEdit(commit_message(changes))
    lay.addWidget(msg)
    bb = QDialogButtonBox(QDialogButtonBox.Cancel)
    bb.addButton("Publish", QDialogButtonBox.AcceptRole)
    bb.accepted.connect(dlg.accept)
    bb.rejected.connect(dlg.reject)
    lay.addWidget(bb)
    dlg.resize(520, 360)
    if dlg.exec() != QDialog.Accepted:
        return
    TaskDialog(parent, "Publish", repo.root, [
        ("Staging changes…", ["git", "add", "-A", "--", "data", "images"]),
        ("Saving to history…", ["git", "commit", "-m", msg.text().strip() or "Update portfolio", "--", "data", "images"]),
        ("Getting any changes made on the web…", ["git", "pull", "--rebase", "--autostash"]),
        ("Uploading to GitHub…", ["git", "push"]),
    ], on_success=on_done).exec()
    QApplication.processEvents()
