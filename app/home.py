"""Home Page window: choose which set of projects is live on the home page, and edit the sets."""
from __future__ import annotations

import re

from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QAbstractItemView, QDialog, QDialogButtonBox, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMessageBox, QPushButton, QVBoxLayout, QWidget,
)

import core
from store import Store

KEY = Qt.UserRole


class AddProjectsDialog(QDialog):
    """Searchable checklist of every project, for adding several to a set at once."""

    def __init__(self, parent, store: Store, already: list[str]):
        super().__init__(parent)
        self.setWindowTitle("Add Projects")
        self.resize(480, 560)
        self.search = QLineEdit(placeholderText="Search…", clearButtonEnabled=True)
        self.list = QListWidget()
        self.list.setIconSize(QSize(64, 36))
        for p in store.projects:
            key = core.project_key(p)
            if key in already:
                continue
            cat = store.category(p["category"])["name"]
            item = QListWidgetItem(f"{p.get('title') or '(untitled)'}   ·   {cat}")
            thumb = store.repo.thumb_path(p)
            if thumb and thumb.exists():
                item.setIcon(QIcon(str(thumb)))
            item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
            item.setCheckState(Qt.Unchecked)
            item.setData(KEY, key)
            item.setToolTip(p.get("client", ""))
            self.list.addItem(item)
        self.search.textChanged.connect(self._filter)
        bb = QDialogButtonBox(QDialogButtonBox.Cancel)
        bb.addButton("Add", QDialogButtonBox.AcceptRole)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        lay = QVBoxLayout(self)
        lay.addWidget(self.search)
        lay.addWidget(self.list)
        lay.addWidget(bb)

    def _filter(self, text: str):
        t = text.lower()
        for i in range(self.list.count()):
            it = self.list.item(i)
            it.setHidden(bool(t) and t not in (it.text() + it.toolTip()).lower())

    def chosen(self) -> list[str]:
        return [self.list.item(i).data(KEY) for i in range(self.list.count())
                if self.list.item(i).checkState() == Qt.Checked]


class HomeDialog(QDialog):
    def __init__(self, parent, store: Store):
        super().__init__(parent)
        self.store = store
        self.setWindowTitle("Home Page")
        self.resize(900, 620)
        self.current: str | None = store.home.get("active")

        # Left: the sets
        self.sets = QListWidget()
        self.sets.currentItemChanged.connect(lambda cur, _prev: self._select(cur.data(KEY) if cur else None))
        self.btn_live = QPushButton("Show This on the Site")
        self.btn_live.clicked.connect(self._make_live)
        b_new = QPushButton("New Set")
        b_new.clicked.connect(self._new)
        b_dup = QPushButton("Duplicate")
        b_dup.clicked.connect(self._duplicate)
        b_ren = QPushButton("Rename")
        b_ren.clicked.connect(self._rename)
        self.b_del = QPushButton("Delete")
        self.b_del.clicked.connect(self._delete)
        left = QWidget()
        ll = QVBoxLayout(left)
        ll.setContentsMargins(0, 0, 0, 0)
        ll.addWidget(QLabel("<b>Sets</b> · the one marked ● is on the site"))
        ll.addWidget(self.sets, 1)
        ll.addWidget(self.btn_live)
        row = QHBoxLayout()
        for b in (b_new, b_dup, b_ren, self.b_del):
            row.addWidget(b)
        ll.addLayout(row)

        # Right: the chosen set's projects
        self.title = QLabel()
        self.title.setStyleSheet("font-size: 16px; font-weight: 600;")
        self.tagline = QLineEdit(placeholderText="Line under your name (leave empty for your usual tagline)")
        self.tagline.editingFinished.connect(self._set_tagline)
        self.items = QListWidget()
        self.items.setIconSize(QSize(96, 54))
        self.items.setDragDropMode(QAbstractItemView.InternalMove)
        self.items.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.items.model().rowsMoved.connect(self._reordered)
        b_add = QPushButton("Add Projects…")
        b_add.clicked.connect(self._add)
        b_rm = QPushButton("Remove")
        b_rm.clicked.connect(self._remove)
        hint = QLabel("Drag to reorder. Landscape projects show first, then short-form in its own row.")
        hint.setStyleSheet("color: palette(placeholder-text);")
        right = QWidget()
        rl = QVBoxLayout(right)
        rl.setContentsMargins(0, 0, 0, 0)
        rl.addWidget(self.title)
        rl.addWidget(self.tagline)
        rl.addWidget(self.items, 1)
        r2 = QHBoxLayout()
        r2.addWidget(b_add)
        r2.addWidget(b_rm)
        r2.addStretch()
        rl.addLayout(r2)
        rl.addWidget(hint)

        cols = QHBoxLayout()
        cols.addWidget(left, 2)
        cols.addWidget(right, 3)
        close = QDialogButtonBox(QDialogButtonBox.Close)
        close.rejected.connect(self.reject)
        lay = QVBoxLayout(self)
        lay.addLayout(cols)
        lay.addWidget(QLabel("Changes save automatically and go live when you Publish."))
        lay.addWidget(close)

        store.homeChanged.connect(self.refresh)
        self.refresh()

    # ------------------------------------------------------------------ display
    def refresh(self):
        home = self.store.home
        sets = home.get("sets", [])
        if self.current not in {s["id"] for s in sets}:
            self.current = home.get("active") if sets else None
        self.sets.blockSignals(True)
        self.sets.clear()
        for s in sets:
            live = s["id"] == home.get("active")
            item = QListWidgetItem(("●  " if live else "    ") + s["name"] + f"   ({len(s.get('projects', []))})")
            item.setData(KEY, s["id"])
            if live:
                f = item.font()
                f.setBold(True)
                item.setFont(f)
            self.sets.addItem(item)
            if s["id"] == self.current:
                self.sets.setCurrentItem(item)
        self.sets.blockSignals(False)
        self._show_set()

    def _select(self, set_id: str | None):
        self.current = set_id
        self._show_set()

    def _show_set(self):
        s = self.store.home_set(self.current) if self.current else None
        live = bool(s) and s["id"] == self.store.home.get("active")
        self.btn_live.setEnabled(bool(s) and not live)
        self.btn_live.setText("This set is on the site" if live else "Show This on the Site")
        self.b_del.setEnabled(bool(s) and len(self.store.home.get("sets", [])) > 1)
        self.title.setText(s["name"] if s else "")
        self.tagline.setEnabled(bool(s))
        self.tagline.setText(s.get("tagline", "") if s else "")
        self.items.blockSignals(True)
        self.items.clear()
        for key in (s.get("projects", []) if s else []):
            p = self.store.project_by_key(key)
            if p:
                cat = self.store.category(p["category"])["name"]
                item = QListWidgetItem(f"{p.get('title') or '(untitled)'}   ·   {cat}")
                thumb = self.store.repo.thumb_path(p)
                if thumb and thumb.exists():
                    item.setIcon(QIcon(str(thumb)))
            else:
                item = QListWidgetItem(f"(missing project: {key})")
            item.setData(KEY, key)
            self.items.addItem(item)
        self.items.blockSignals(False)

    # ------------------------------------------------------------------ actions
    def _edit_current(self, label, fn):
        set_id = self.current
        self.store.edit_home(label, lambda h: fn(next(s for s in h["sets"] if s["id"] == set_id), h))

    def _make_live(self):
        if self.current:
            name = self.store.home_set(self.current)["name"]
            self.store.edit_home(f"Show “{name}” on Home Page", lambda h: h.__setitem__("active", self.current))

    def _unique_id(self, name: str) -> str:
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "set"
        taken = {s["id"] for s in self.store.home.get("sets", [])}
        cand, n = base, 2
        while cand in taken:
            cand, n = f"{base}-{n}", n + 1
        return cand

    def _new(self, copy_from: dict | None = None):
        name, ok = QInputDialog.getText(self, "New Set", "Name (e.g. the job you're applying for):",
                                        text=f"{copy_from['name']} (copy)" if copy_from else "")
        if not ok or not name.strip():
            return
        new = {"id": self._unique_id(name), "name": name.strip(),
               "tagline": copy_from.get("tagline", "") if copy_from else "",
               "projects": list(copy_from.get("projects", [])) if copy_from else []}
        self.current = new["id"]
        self.store.edit_home(f"New Set “{new['name']}”", lambda h: h.setdefault("sets", []).append(new))

    def _duplicate(self):
        s = self.store.home_set(self.current) if self.current else None
        if s:
            self._new(copy_from=s)

    def _rename(self):
        s = self.store.home_set(self.current) if self.current else None
        if not s:
            return
        name, ok = QInputDialog.getText(self, "Rename Set", "Name:", text=s["name"])
        if ok and name.strip() and name.strip() != s["name"]:
            self._edit_current("Rename Set", lambda st, _h: st.__setitem__("name", name.strip()))

    def _delete(self):
        s = self.store.home_set(self.current) if self.current else None
        if not s or len(self.store.home["sets"]) < 2:
            return
        if QMessageBox.question(self, "Delete set", f"Delete the set “{s['name']}”? (You can undo this.)") != QMessageBox.Yes:
            return
        sid = s["id"]

        def fn(h):
            h["sets"] = [x for x in h["sets"] if x["id"] != sid]
            if h.get("active") == sid:
                h["active"] = h["sets"][0]["id"]
        self.current = None
        self.store.edit_home(f"Delete Set “{s['name']}”", fn)

    def _set_tagline(self):
        if self.current:
            text = self.tagline.text().strip()
            if text != self.store.home_set(self.current).get("tagline", ""):
                self._edit_current("Change Tagline", lambda st, _h: st.__setitem__("tagline", text))

    def _add(self):
        s = self.store.home_set(self.current) if self.current else None
        if not s:
            return
        dlg = AddProjectsDialog(self, self.store, s.get("projects", []))
        if dlg.exec() == QDialog.Accepted and dlg.chosen():
            keys = dlg.chosen()
            self._edit_current("Add to Home Page", lambda st, _h: st.setdefault("projects", []).extend(keys))

    def _remove(self):
        keys = {i.data(KEY) for i in self.items.selectedItems()}
        if keys:
            self._edit_current("Remove from Home Page",
                               lambda st, _h: st.__setitem__("projects", [k for k in st["projects"] if k not in keys]))

    def _reordered(self, *_):
        order = [self.items.item(i).data(KEY) for i in range(self.items.count())]
        self._edit_current("Reorder Home Page", lambda st, _h: st.__setitem__("projects", order))
