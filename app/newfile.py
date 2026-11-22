"""New from Video File: pick a video, and the title, section, page address and thumbnail are filled
in for you; the video then uploads in the background (same as the web admin's version)."""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QVBoxLayout,
)

import core
from store import Store
from widgets import run_async


def frame_and_facts(src: Path) -> tuple[Path | None, dict | None]:
    """(a JPEG still from about a fifth of the way in, basic facts) — either may be None."""
    from upload import _run, _which, probe
    try:
        info = probe(src)
    except Exception:
        info = None
    try:
        out = Path(tempfile.mkdtemp(prefix="portfolio-frame-")) / "frame.jpg"
        t = min(5.0, (info or {}).get("duration", 5) * 0.2)
        r = _run([_which("ffmpeg"), "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1",
                  "-q:v", "2", str(out)], timeout=60)
        frame = out if r.returncode == 0 and out.exists() else None
    except Exception:
        frame = None
    return frame, info


class NewFromFileDialog(QDialog):
    def __init__(self, parent, store: Store, src: Path, category: str):
        super().__init__(parent)
        self.store = store
        self.src = src
        self.frame: Path | None = None
        self._addr_touched = False
        self._cat_touched = False
        self.setWindowTitle("New Project from Video File")
        self.resize(520, 480)

        self.still = QLabel("Reading the video…", alignment=Qt.AlignCenter)
        self.still.setFixedSize(150, 150)
        self.still.setStyleSheet("background: palette(mid); border-radius: 6px;")
        self.facts = QLabel(f"<b>{src.name}</b>")
        self.facts.setWordWrap(True)
        top = QHBoxLayout()
        top.addWidget(self.still)
        top.addWidget(self.facts, 1)

        self.title = QLineEdit(core.tidy_title(src.stem))
        self.title.textChanged.connect(self._sync)
        self.client = QLineEdit(placeholderText="e.g. Deakin University")
        self.category = QComboBox()
        for c in store.data["categories"]:
            self.category.addItem(c["name"], c["id"])
        self.category.setCurrentIndex(max(0, self.category.findData(category)))
        self.category.activated.connect(lambda _i: (setattr(self, "_cat_touched", True), self._sync()))
        self.address = QLineEdit()
        self.address.textEdited.connect(lambda _t: (setattr(self, "_addr_touched", True), self._show_url()))
        self.url = QLabel()
        self.url.setStyleSheet("color: palette(placeholder-text);")
        self.warn = QLabel()
        self.warn.setWordWrap(True)
        self.warn.setStyleSheet("color: #e0a100;")
        self.warn.hide()

        form = QFormLayout()
        form.addRow("Title", self.title)
        form.addRow("Client", self.client)
        form.addRow("Section", self.category)
        form.addRow("Page address", self.address)
        form.addRow("", self.url)
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.ok = buttons.addButton("Create && Upload", QDialogButtonBox.AcceptRole)
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        lay = QVBoxLayout(self)
        lay.addLayout(top)
        lay.addWidget(self.warn)
        lay.addLayout(form)
        note = QLabel("Any video works (ProRes, 4K, phone videos): it's converted if needed and uploads in the "
                      "background while you keep working.")
        note.setWordWrap(True)
        note.setStyleSheet("color: palette(placeholder-text);")
        lay.addWidget(note)
        lay.addWidget(buttons)
        self._sync()
        self.title.selectAll()
        run_async(lambda: frame_and_facts(src), self._looked)

    def _sync(self):
        if not self._addr_touched:
            self.address.setText(core.slugify(self.title.text()))
        self._show_url()

    def _final_id(self) -> str:
        return core.unique_id(self.store.data, core.slugify(self.address.text() or self.title.text()),
                              self.category.currentData())

    def _show_url(self):
        slug = self.store.category(self.category.currentData()).get("slug", self.category.currentData())
        self.url.setText(f"matthewfregnan.com/{slug}/{self._final_id()}/")

    def _looked(self, result):
        frame, info = result if isinstance(result, tuple) else (None, None)
        self.frame = frame
        if frame:
            pix = QPixmap(str(frame))
            self.still.setPixmap(pix.scaled(self.still.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            self.still.setText("No preview")
        if info:
            if info["height"] > info["width"] and not self._cat_touched:
                self.category.setCurrentIndex(max(0, self.category.findData("vertical")))
                self._sync()
            size = self.src.stat().st_size / 1e6
            self.facts.setText(f"<b>{self.src.name}</b><br>{info['width']}×{info['height']} {info['vcodec']} · "
                               f"{round(info['duration'])}s · {size:.0f} MB<br>"
                               + ("This frame becomes the thumbnail (change it any time)." if frame else ""))
        else:
            self.warn.setText("ffmpeg couldn't read this file, so it may not upload. "
                              "Install ffmpeg (brew install ffmpeg) or try an MP4/MOV export.")
            self.warn.show()

    def _accept(self):
        if not self.title.text().strip():
            self.title.setFocus()
            return
        self.accept()

    def make_project(self) -> dict:
        cat = self.category.currentData()
        p = {"id": self._final_id(), "title": self.title.text().strip(), "category": cat,
             "client": self.client.text().strip(), "role": "Editor", "production": "", "year": "",
             "description": "", "thumbnail": ""}
        core.touch(p)
        return p

    def cleanup(self):
        if self.frame:
            shutil.rmtree(self.frame.parent, ignore_errors=True)
