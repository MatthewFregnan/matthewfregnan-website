"""Video Storage: how much of the free 10 GB of video storage (Cloudflare R2) is used, and by what.

The total comes from Wrangler (`wrangler r2 bucket info`, signed in once with `npx wrangler@3 login`);
each project's file size comes from the video address itself. Anything in storage that no project
uses (usually earlier versions of a replaced video) shows as one "not used" amount.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PySide6.QtCore import QObject, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QDialog, QDialogButtonBox, QGridLayout, QLabel, QProgressBar, QPushButton, QScrollArea, QVBoxLayout, QWidget,
)

import core
from store import Store
from tasks import tool_paths
from upload import BUCKET

LIMIT = 10 * 1000 ** 3   # R2 free plan
DASHBOARD = "https://dash.cloudflare.com/?to=/:account/r2/default/buckets/matthewfregnan-videos"
UNITS = {"B": 1, "KB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3, "TB": 1000 ** 4,
         "KIB": 1024, "MIB": 1024 ** 2, "GIB": 1024 ** 3, "TIB": 1024 ** 4}


def fmt_bytes(n: float) -> str:
    if n >= 1000 ** 3:
        return f"{n / 1000 ** 3:.2f} GB"
    if n >= 1000 ** 2:
        return f"{n / 1000 ** 2:.0f} MB" if n >= 100 * 1000 ** 2 else f"{n / 1000 ** 2:.1f} MB"
    return f"{max(1, round(n / 1000))} KB"


def bucket_totals() -> tuple[int, int]:
    """(object count, total bytes) from Wrangler."""
    npx = shutil.which("npx", path=tool_paths())
    if not npx:
        raise RuntimeError("Couldn't find Node.js (npx) on this computer.")
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    r = subprocess.run([npx, "-y", "wrangler@3", "r2", "bucket", "info", BUCKET], capture_output=True, text=True,
                       timeout=120, env={**__import__("os").environ, "PATH": tool_paths()}, creationflags=flags)
    out = r.stdout + r.stderr
    count = re.search(r"object_count:\s*([\d,]+)", out)
    size = re.search(r"bucket_size:\s*([\d.]+)\s*([KMGT]?i?B)", out, re.I)
    if r.returncode != 0 or not (count and size):
        if re.search(r"not (be )?(logged|authenticated)|login", out, re.I):
            raise RuntimeError("Wrangler isn't signed in to Cloudflare on this computer.\n"
                               "In Terminal, run:  npx wrangler@3 login   then try again.")
        raise RuntimeError("Couldn't read the storage total from Cloudflare.")
    return int(count.group(1).replace(",", "")), int(float(size.group(1)) * UNITS[size.group(2).upper()])


def file_size(url: str) -> int | None:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PortfolioManager"})
        with urllib.request.urlopen(req, timeout=20) as res:
            return int(res.headers.get("Content-Length") or 0) or None
    except Exception:
        return None


def storage_key(url: str) -> str | None:
    u = urllib.parse.urlparse(url or "")
    return urllib.parse.unquote(u.path[1:]) if u.netloc == urllib.parse.urlparse(core.VIDEO_HOST).netloc else None


class _Relay(QObject):
    done = Signal(object)


class StorageDialog(QDialog):
    def __init__(self, parent, store: Store):
        super().__init__(parent)
        self.store = store
        self.setWindowTitle("Video Storage")
        self.resize(620, 640)
        self.body = QVBoxLayout()
        self.status = QLabel("Looking at your video storage…")
        self.body.addWidget(self.status)
        self.body.addStretch()
        inner = QWidget()
        inner.setLayout(self.body)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QScrollArea.NoFrame)
        scroll.setWidget(inner)
        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        dash = QPushButton("Open in Cloudflare")
        dash.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(DASHBOARD)))
        buttons.addButton(dash, QDialogButtonBox.ActionRole)
        lay = QVBoxLayout(self)
        lay.addWidget(scroll, 1)
        lay.addWidget(buttons)

        self._relay = _Relay()
        self._relay.done.connect(self._show)
        files = []
        for p in store.projects:
            key = storage_key(p.get("videoFile", ""))
            if key:
                files.append({"key": key, "url": p["videoFile"], "project": p})
        hero = self._hero_url()
        if storage_key(hero):
            files.append({"key": storage_key(hero), "url": hero, "project": None})
        threading.Thread(target=self._work, args=(files,), daemon=True).start()

    def _hero_url(self) -> str:
        try:
            return json.loads((self.store.repo.root / "data" / "site.json").read_text()).get("heroVideo", "")
        except Exception:
            return ""

    def _work(self, files: list[dict]):
        try:
            count, total = bucket_totals()
            with ThreadPoolExecutor(8) as pool:
                sizes = list(pool.map(lambda f: file_size(f["url"]), files))
            for f, size in zip(files, sizes):
                f["size"] = size or 0
            self._relay.done.emit((count, total, files))
        except Exception as e:   # noqa: BLE001 - shown to the user
            self._relay.done.emit(e)

    # ------------------------------------------------------------------ display
    def _clear(self):
        while self.body.count():
            w = self.body.takeAt(0).widget()
            if w:
                w.deleteLater()

    def _heading(self, text: str):
        lab = QLabel(f"<b>{text}</b>")
        lab.setContentsMargins(0, 12, 0, 2)
        self.body.addWidget(lab)

    def _note(self, text: str):
        lab = QLabel(text)
        lab.setWordWrap(True)
        lab.setStyleSheet("color: palette(placeholder-text);")
        self.body.addWidget(lab)

    def _table(self, rows: list[tuple[str, str, str]]):
        box = QWidget()
        grid = QGridLayout(box)
        grid.setContentsMargins(0, 0, 0, 0)
        grid.setColumnStretch(0, 1)
        for r, (name, mid, size) in enumerate(rows):
            n = QLabel(name)
            n.setTextInteractionFlags(Qt.TextSelectableByMouse)
            m = QLabel(mid)
            m.setStyleSheet("color: palette(placeholder-text);")
            s = QLabel(size)
            s.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
            grid.addWidget(n, r, 0)
            grid.addWidget(m, r, 1)
            grid.addWidget(s, r, 2)
        self.body.addWidget(box)

    def _show(self, result):
        self._clear()
        if isinstance(result, Exception):
            lab = QLabel(str(result))
            lab.setWordWrap(True)
            self.body.addWidget(lab)
            self.body.addStretch()
            return
        count, total, files = result
        # one file can be used by more than one project; count it once
        seen, unique = set(), []
        for f in files:
            if f["key"] not in seen:
                seen.add(f["key"])
                unique.append(f)
        used = sum(f["size"] for f in unique)
        other = max(0, total - used)
        pct = min(100.0, total / LIMIT * 100)

        top = QLabel(f"<span style='font-size:18px'><b>{fmt_bytes(total)}</b></span> of 10 GB free storage used "
                     f"({pct:.0f}%)")
        self.body.addWidget(top)
        bar = QProgressBar()
        bar.setRange(0, 1000)
        bar.setValue(max(5, int(pct * 10)))
        bar.setTextVisible(False)
        bar.setFixedHeight(10)
        colour = "#e5484d" if pct >= 90 else "#f0a020" if pct >= 70 else "#2fb36b"
        bar.setStyleSheet(f"QProgressBar {{ border: none; border-radius: 5px; background: palette(mid); }}"
                          f"QProgressBar::chunk {{ border-radius: 5px; background: {colour}; }}")
        self.body.addWidget(bar)
        self._note(f"{count} files · about {fmt_bytes(max(0, LIMIT - total))} left. "
                   "Your images are stored on GitHub and don't count.")

        sections: dict[str, list[int]] = {}
        for f in unique:
            sec = f["key"].split("/")[0]
            s = sections.setdefault(sec, [0, 0])
            s[0] += f["size"]
            s[1] += 1

        def section_name(sec: str) -> str:
            return "Home page background" if sec == "home" else self.store.category(sec)["name"]
        self._heading("By section")
        rows = [(section_name(sec), f"{n} file{'s' if n != 1 else ''}", fmt_bytes(size))
                for sec, (size, n) in sorted(sections.items(), key=lambda kv: -kv[1][0])]
        if other:
            rows.append(("Not used by any project", "", fmt_bytes(other)))
        self._table(rows)

        self._heading("Largest files")
        largest = sorted(unique, key=lambda f: -f["size"])[:8]
        self._table([((f["project"] or {}).get("title") or ("Home page background" if f["key"].startswith("home/")
                       else f["key"]), self.store.category(f["key"].split("/")[0])["name"] if f["project"] else "",
                      fmt_bytes(f["size"])) for f in largest])

        if other >= 1000 ** 2:
            self._heading(f"Not used by any project: about {fmt_bytes(other)}")
            self._note("Usually earlier versions of videos you replaced (every upload gets a new address). They "
                       "aren't on the site; delete them in Cloudflare (R2 → matthewfregnan-videos) to get the space "
                       "back. The web admin's Video Storage lists them one by one.")
        self.body.addStretch()
