"""Home Page window: choose which set of projects is live on the home page, and edit the sets."""
from __future__ import annotations

import json
import re

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QAbstractItemView, QCheckBox, QComboBox, QDialog, QFormLayout, QGroupBox, QDialogButtonBox, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMessageBox, QPushButton, QVBoxLayout, QWidget,
)

import core
from store import Store

KEY = Qt.UserRole

# Project page layouts. Add new ones here and as templates/partials/project-<id>.ejs
LAYOUTS = [
    ("standard", "Standard", "Client, production, role and year under the video."),
    ("detailed", "Detailed", "Adds the description, “What I did”, “Made for” and credits (agency, deliverables)."),
]


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


def featured_plan(store: Store, s: dict) -> dict:
    """Which landscape projects the home page shows for set `s`, with a status line for each (matches build.js)."""
    keys = [k for k in s.get("projects", [])
            if (p := store.project_by_key(k)) and p.get("category") != "vertical"]
    try:
        count = max(0, int(s.get("featuredCount") or 0))
    except (TypeError, ValueError):
        count = 0
    locked = set(s.get("locked", []))
    plan = {"total": len(keys), "count": count if 0 < count < len(keys) else 0,
            "shuffle": bool(s.get("shuffle")), "status": {}, "locked": 0}
    if not plan["count"]:
        return plan
    n = plan["count"]
    locked_keys = [k for k in keys if k in locked]
    plan["locked"] = len(locked_keys)
    first = (locked_keys + [k for k in keys if k not in locked])[:n]
    for k in keys:
        if k in locked:
            st = "Locked: always shown" if k in first else f"Not shown (more than {n} locked)"
        elif plan["shuffle"]:
            st = "Not shown (all places are locked)" if len(locked_keys) >= n else "In the shuffle"
        else:
            st = "Shown" if k in first else f"Not shown (only the top {n})"
        plan["status"][k] = st
    return plan


class HomeDialog(QDialog):
    shown = Signal(str)   # the set being shown (for the live preview)

    def __init__(self, parent, store: Store, embedded: bool = False):
        super().__init__(parent)
        if embedded:
            self.setWindowFlags(Qt.Widget)
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
        self.layout_combo = QComboBox()
        for lid, name, _hint in LAYOUTS:
            self.layout_combo.addItem(name, lid)
        self.layout_combo.activated.connect(self._set_layout)
        self.layout_hint = QLabel()
        self.layout_hint.setWordWrap(True)
        self.layout_hint.setStyleSheet("color: palette(placeholder-text);")
        self.items = QListWidget()
        self.items.setIconSize(QSize(96, 54))
        self.items.setDragDropMode(QAbstractItemView.InternalMove)
        self.items.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.items.model().rowsMoved.connect(self._reordered)
        b_add = QPushButton("Add Projects…")
        b_add.clicked.connect(self._add)
        b_rm = QPushButton("Remove")
        b_rm.clicked.connect(self._remove)
        self.b_lock = QPushButton("Lock")
        self.b_lock.setToolTip("Locked landscape projects are always shown on the home page")
        self.b_lock.clicked.connect(self._toggle_lock)
        self.items.itemSelectionChanged.connect(self._update_lock_button)

        # Featured: how many landscape projects show, and whether the rest are shuffled
        self.f_count = QComboBox()
        self.f_count.activated.connect(self._set_count)
        self.f_shuffle = QCheckBox("Shuffle on each visit")
        self.f_shuffle.toggled.connect(self._set_shuffle)
        self.f_hint = QLabel()
        self.f_hint.setWordWrap(True)
        self.f_hint.setStyleSheet("color: palette(placeholder-text);")
        hint = QLabel("Drag to reorder. Landscape and Social projects show in separate rows, in the order set above.")
        hint.setStyleSheet("color: palette(placeholder-text);")
        right = QWidget()
        rl = QVBoxLayout(right)
        rl.setContentsMargins(0, 0, 0, 0)
        rl.addWidget(self.title)
        rl.addWidget(self.tagline)
        lrow = QHBoxLayout()
        lrow.addWidget(QLabel("Project page layout:"))
        lrow.addWidget(self.layout_combo)
        lrow.addStretch()
        rl.addLayout(lrow)
        rl.addWidget(self.layout_hint)

        # How the selected work section looks for this set
        box = QGroupBox("Featured work section")
        box.setCheckable(False)
        form = QFormLayout(box)
        self.d_heading = QLineEdit(placeholderText="Featured Work")
        self.d_heading.editingFinished.connect(lambda: self._set_text("heading", self.d_heading.text(), "Change Heading"))
        self.d_order = QComboBox()
        self.d_order.addItem("Landscape first, then Social", "landscape-first")
        self.d_order.addItem("Social first, then landscape", "social-first")
        self.d_order.activated.connect(self._set_order)
        self.d_land = QLineEdit(placeholderText="None (optional)")
        self.d_land.editingFinished.connect(lambda: self._set_text("landscapeTitle", self.d_land.text(), "Change Row Title"))
        self.d_social = QLineEdit(placeholderText="None")
        self.d_social.editingFinished.connect(lambda: self._set_social_title(self.d_social.text()))
        self.d_show_land = QCheckBox("Landscape work")
        self.d_show_land.toggled.connect(lambda on: self._set_show("showLandscape", on))
        self.d_show_social = QCheckBox("Social work")
        self.d_show_social.toggled.connect(lambda on: self._set_show("showSocial", on))
        shows = QHBoxLayout()
        shows.addWidget(self.d_show_land)
        shows.addWidget(self.d_show_social)
        shows.addStretch()
        form.addRow("Heading", self.d_heading)
        form.addRow("Order", self.d_order)
        form.addRow("Landscape row title", self.d_land)
        form.addRow("Social row title", self.d_social)
        form.addRow("Show", shows)
        rl.addWidget(box)
        self.display_box = box
        frow = QHBoxLayout()
        frow.addWidget(QLabel("Landscape projects shown:"))
        frow.addWidget(self.f_count)
        frow.addWidget(self.f_shuffle)
        frow.addStretch()
        rl.addLayout(frow)
        rl.addWidget(self.f_hint)
        rl.addWidget(self.items, 1)
        r2 = QHBoxLayout()
        r2.addWidget(b_add)
        r2.addWidget(b_rm)
        r2.addWidget(self.b_lock)
        r2.addStretch()
        rl.addLayout(r2)
        rl.addWidget(hint)

        cols = QHBoxLayout()
        cols.addWidget(left, 2)
        cols.addWidget(right, 3)
        lay = QVBoxLayout(self)
        if embedded:
            lay.setContentsMargins(0, 0, 0, 0)
            head = QLabel("<span style='font-size:22px; font-weight:600'>Home Page</span>")
            lay.addWidget(head)
            sub = QLabel("Sets are different versions of the home page. Pick one to put on the site, "
                         "e.g. one per kind of job you apply for. Changes go live when you Publish.")
            sub.setWordWrap(True)
            sub.setStyleSheet("color: palette(placeholder-text);")
            lay.addWidget(sub)
        lay.addLayout(cols)
        if not embedded:
            close = QDialogButtonBox(QDialogButtonBox.Close)
            close.rejected.connect(self.reject)
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
        layout = (s or {}).get("projectLayout", "standard")
        self.layout_combo.setEnabled(bool(s))
        self.layout_combo.setCurrentIndex(max(0, self.layout_combo.findData(layout)))
        self.layout_hint.setText(next((h for lid, _n, h in LAYOUTS if lid == layout), ""))
        st = s or {}
        self.display_box.setEnabled(bool(s))
        for w in (self.d_heading, self.d_order, self.d_land, self.d_social, self.d_show_land, self.d_show_social):
            w.blockSignals(True)
        self.d_heading.setText(st.get("heading", ""))
        self.d_order.setCurrentIndex(1 if st.get("order") == "social-first" else 0)
        self.d_land.setText(st.get("landscapeTitle", ""))
        self.d_social.setText(st.get("socialTitle", ""))
        self.d_show_land.setChecked(st.get("showLandscape", True) is not False)
        self.d_show_social.setChecked(st.get("showSocial", True) is not False)
        for w in (self.d_heading, self.d_order, self.d_land, self.d_social, self.d_show_land, self.d_show_social):
            w.blockSignals(False)
        plan = featured_plan(self.store, st) if s else {"total": 0, "count": 0, "shuffle": False, "status": {}, "locked": 0}
        self._plan = plan
        self.f_count.blockSignals(True)
        self.f_shuffle.blockSignals(True)
        self.f_count.clear()
        self.f_count.addItem(f"All {plan['total']}", 0)
        for n in range(1, plan["total"]):
            self.f_count.addItem(str(n), n)
        self.f_count.setCurrentIndex(max(0, self.f_count.findData(plan["count"])))
        self.f_count.setEnabled(bool(s))
        self.f_shuffle.setChecked(bool(st.get("shuffle")))
        self.f_shuffle.setEnabled(bool(plan["count"]))
        self.f_count.blockSignals(False)
        self.f_shuffle.blockSignals(False)
        n, lk = plan["count"], min(plan["locked"], plan["count"])
        if not n:
            hint = "Every landscape project in this set is shown."
        elif plan["shuffle"]:
            free = n - lk
            hint = (f"{lk} locked, plus {free} picked at random from the other {plan['total'] - plan['locked']} "
                    "each time someone visits." if free > 0 else "All places are locked, so nothing is shuffled.")
        else:
            hint = f"Locked projects first, then the top of the list. Drag to change which {n} show."
        self.f_hint.setText(hint)
        dim = self.palette().placeholderText()
        self.items.blockSignals(True)
        self.items.clear()
        for key in (s.get("projects", []) if s else []):
            p = self.store.project_by_key(key)
            if p:
                cat = self.store.category(p["category"])["name"]
                status = plan["status"].get(key)
                lock = "🔒  " if status and key in st.get("locked", []) else ""
                item = QListWidgetItem(f"{lock}{p.get('title') or '(untitled)'}   ·   {cat}" + (f"   ·   {status}" if status else ""))
                if status and status.startswith("Not shown"):
                    item.setForeground(dim)
                thumb = self.store.repo.thumb_path(p)
                if thumb and thumb.exists():
                    item.setIcon(QIcon(str(thumb)))
            else:
                item = QListWidgetItem(f"(missing project: {key})")
            item.setData(KEY, key)
            self.items.addItem(item)
        self.items.blockSignals(False)
        self._update_lock_button()
        self.shown.emit(self.current or "")

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
        base = json.loads(json.dumps(copy_from)) if copy_from else {"tagline": "", "projectLayout": "standard", "projects": []}
        new = {**base, "id": self._unique_id(name), "name": name.strip()}
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

    # ------------------------------------------------------------------ display settings
    def _set_text(self, key: str, text: str, label: str):
        if not self.current:
            return
        v = text.strip()
        if v == self.store.home_set(self.current).get(key, ""):
            return
        self._edit_current(label, lambda st, _h: st.__setitem__(key, v) if v else st.pop(key, None))

    def _set_social_title(self, text: str):
        if self.current and text.strip() != self.store.home_set(self.current).get("socialTitle", ""):
            self._edit_current("Change Row Title", lambda st, _h: st.__setitem__("socialTitle", text.strip()))

    def _set_order(self):
        if self.current:
            v = self.d_order.currentData()
            if v != self.store.home_set(self.current).get("order", "landscape-first"):
                self._edit_current("Change Order", lambda st, _h: st.__setitem__("order", v))

    def _set_show(self, key: str, on: bool):
        if self.current:
            self._edit_current("Show Row" if on else "Hide Row",
                               lambda st, _h: st.pop(key, None) if on else st.__setitem__(key, False))

    def _set_layout(self):
        if self.current:
            lid = self.layout_combo.currentData()
            if lid != self.store.home_set(self.current).get("projectLayout", "standard"):
                self._edit_current("Change Project Layout", lambda st, _h: st.__setitem__("projectLayout", lid))

    # ------------------------------------------------------------------ featured picks
    def _set_count(self):
        if self.current:
            n = self.f_count.currentData() or 0
            self._edit_current("Change Number Shown",
                               lambda st, _h: st.__setitem__("featuredCount", n) if n else st.pop("featuredCount", None))

    def _set_shuffle(self, on: bool):
        if self.current:
            self._edit_current("Shuffle On" if on else "Shuffle Off",
                               lambda st, _h: st.__setitem__("shuffle", True) if on else st.pop("shuffle", None))

    def _lockable(self) -> list[str]:
        return [i.data(KEY) for i in self.items.selectedItems() if i.data(KEY) in self._plan["status"]]

    def _update_lock_button(self):
        keys = self._lockable() if hasattr(self, "_plan") else []
        s = self.store.home_set(self.current) if self.current else None
        locked = set((s or {}).get("locked", []))
        self.b_lock.setEnabled(bool(keys))
        self.b_lock.setText("Unlock" if keys and all(k in locked for k in keys) else "Lock")

    def _toggle_lock(self):
        keys = self._lockable()
        if not keys:
            return
        s = self.store.home_set(self.current)
        unlock = all(k in s.get("locked", []) for k in keys)

        def fn(st, _h):
            now = set(st.get("locked", []))
            now = now - set(keys) if unlock else now | set(keys)
            ordered = [k for k in st.get("projects", []) if k in now]
            if ordered:
                st["locked"] = ordered
            else:
                st.pop("locked", None)
        self._edit_current("Unlock" if unlock else "Lock", fn)

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
            def fn(st, _h):
                st["projects"] = [k for k in st["projects"] if k not in keys]
                if "locked" in st:
                    st["locked"] = [k for k in st["locked"] if k not in keys]
                    if not st["locked"]:
                        st.pop("locked")
            self._edit_current("Remove from Home Page", fn)

    def _reordered(self, *_):
        order = [self.items.item(i).data(KEY) for i in range(self.items.count())]
        self._edit_current("Reorder Home Page", lambda st, _h: st.__setitem__("projects", order))
