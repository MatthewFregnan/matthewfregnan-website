"""The single source of truth for project data while the app is open.

Every change goes through the Store so it can be undone (Qt's QUndoStack) and is saved
automatically shortly after. Projects are plain dicts and are tracked by identity (`is`),
so undo/redo restores a project's contents in place and selection never points at the
wrong project after a reorder.
"""
from __future__ import annotations

import copy
from collections import Counter
from typing import Callable

from PySide6.QtCore import QObject, QTimer, Signal
from PySide6.QtGui import QUndoCommand, QUndoStack

import core

AUTOSAVE_MS = 600


class Store(QObject):
    projectChanged = Signal(object)   # a project's fields changed (the dict itself)
    homeChanged = Signal()            # home page sets changed
    listChanged = Signal()            # projects added, removed or reordered
    saved = Signal()
    saveFailed = Signal(str)

    def __init__(self, repo: core.Repo):
        super().__init__()
        self.repo = repo
        self.data = repo.load()
        self.home = repo.load_home()
        self.undo_stack = QUndoStack(self)
        self._timer = QTimer(self, singleShot=True, interval=AUTOSAVE_MS)
        self._timer.timeout.connect(self.save)
        self.undo_stack.indexChanged.connect(lambda _i: self._timer.start())

    def reload(self):
        """Re-read the file (after pulling changes made in the web admin)."""
        self.data = self.repo.load()
        self.home = self.repo.load_home()
        self.undo_stack.clear()
        self.listChanged.emit()
        self.homeChanged.emit()

    # ------------------------------------------------------------------ reading
    @property
    def projects(self) -> list[dict]:
        return self.data["projects"]

    @property
    def categories(self) -> list[dict]:
        return self.data["categories"]

    def category(self, cid: str) -> dict:
        return next((c for c in self.categories if c["id"] == cid), {"id": cid, "name": cid, "slug": cid})

    def suggestions(self, key: str) -> list[str]:
        """Existing values for a field, most used first (for autocomplete)."""
        counts = Counter(str(p.get(key, "")).strip() for p in self.projects)
        counts.pop("", None)
        return [v for v, _ in counts.most_common()]

    def page_path(self, p: dict) -> str:
        return f"/{self.category(p['category'])['slug']}/{p['id']}/"

    # ------------------------------------------------------------------ saving
    def save(self):
        self._timer.stop()
        try:
            self.repo.save(self.data)
            self.repo.save_home(self.home)
        except OSError as e:
            self.saveFailed.emit(str(e))
            return
        self.saved.emit()

    def flush(self):
        """Save now if a save is pending (before preview, publish or quit)."""
        if self._timer.isActive():
            self.save()

    # ------------------------------------------------------------------ editing
    def set_field(self, p: dict, key: str, value: str):
        """Typing in a text field. Consecutive edits to the same field merge into one undo step."""
        if p.get(key, "") == value:
            return
        self.undo_stack.push(_SetField(self, p, key, value))

    def edit(self, p: dict, label: str, fn: Callable[[dict], None]):
        """Any other change to one project: `fn` mutates it, and the before/after is recorded."""
        before = copy.deepcopy(p)
        try:
            fn(p)
        except Exception:
            _restore(p, before)
            raise
        if p == before:
            return
        old_key, new_key = core.project_key(before), core.project_key(p)
        if old_key != new_key:
            core.remember_address(p, old_key)
        core.touch(p)
        if old_key == new_key:
            self.undo_stack.push(_EditProject(self, p, before, copy.deepcopy(p), label))
            return
        # Page address or category changed: keep the home page sets pointing at it
        self.undo_stack.beginMacro(label)
        self.undo_stack.push(_EditProject(self, p, before, copy.deepcopy(p), label))
        self.edit_home(label, lambda h: _rename_refs(h, old_key, new_key))
        self.undo_stack.endMacro()

    def _set_list(self, new: list[dict], label: str):
        self.undo_stack.push(_SetList(self, list(self.projects), new, label))

    def add(self, p: dict, after: dict | None = None):
        """Add a project at the top of its category, or straight after `after`."""
        new = list(self.projects)
        if after is not None and after in new:
            new.insert(new.index(after) + 1, p)
        else:
            first = next((i for i, x in enumerate(new) if x["category"] == p["category"]), len(new))
            new.insert(first, p)
        self._set_list(new, f"Add “{p.get('title', '')}”")

    def remove(self, p: dict):
        label = f"Delete “{p.get('title', '')}”"
        key = core.project_key(p)
        self.undo_stack.beginMacro(label)
        self._set_list([x for x in self.projects if x is not p], label)
        self.edit_home(label, lambda h: _rename_refs(h, key, None))
        self.undo_stack.endMacro()

    # ------------------------------------------------------------------ home page sets
    def edit_home(self, label: str, fn: Callable[[dict], None]):
        before = copy.deepcopy(self.home)
        fn(self.home)
        if self.home != before:
            self.undo_stack.push(_EditHome(self, before, copy.deepcopy(self.home), label))

    def home_set(self, set_id: str) -> dict | None:
        return next((s for s in self.home.get("sets", []) if s["id"] == set_id), None)

    def sets_containing(self, p: dict) -> set[str]:
        key = core.project_key(p)
        return {s["id"] for s in self.home.get("sets", []) if key in s.get("projects", [])}

    def set_in_home_set(self, p: dict, set_id: str, on: bool):
        key = core.project_key(p)
        name = (self.home_set(set_id) or {}).get("name", "home page")

        def fn(h):
            s = next(x for x in h["sets"] if x["id"] == set_id)
            items = s.setdefault("projects", [])
            if on and key not in items:
                items.append(key)
            elif not on and key in items:
                items.remove(key)
        self.edit_home(f"{'Add to' if on else 'Remove from'} {name}", fn)

    def project_by_key(self, key: str) -> dict | None:
        return next((p for p in self.projects if core.project_key(p) == key), None)

    def move(self, p: dict, row: int):
        """Move a project to position `row` within its category."""
        rest = [x for x in self.projects if x is not p]
        same = [i for i, x in enumerate(rest) if x["category"] == p["category"]]
        row = max(0, min(row, len(same)))
        at = same[row] if row < len(same) else (same[-1] + 1 if same else len(rest))
        rest.insert(at, p)
        if [id(x) for x in rest] != [id(x) for x in self.projects]:
            self._set_list(rest, f"Move “{p.get('title', '')}”")

    def row_in_category(self, p: dict) -> tuple[int, int]:
        same = [x for x in self.projects if x["category"] == p["category"]]
        return next(i for i, x in enumerate(same) if x is p), len(same)


def _restore(p: dict, state: dict):
    p.clear()
    p.update(copy.deepcopy(state))


class _SetField(QUndoCommand):
    NAMES = {"title": "Title", "client": "Client", "role": "Role", "production": "Production",
             "agency": "Agency", "year": "Year", "platform": "Made For", "deliverables": "Deliverables",
             "description": "Description"}

    def __init__(self, store: Store, p: dict, key: str, value):
        super().__init__(f"Edit {self.NAMES.get(key, key)}")
        self.store, self.p, self.key = store, p, key
        self.had_key = key in p
        self.old, self.new = p.get(key, ""), value
        self.old_updated = p.get("updated")

    def id(self):
        return 1

    def mergeWith(self, other: QUndoCommand) -> bool:
        if isinstance(other, _SetField) and other.p is self.p and other.key == self.key:
            self.new = other.new
            return True
        return False

    def redo(self):
        self.p[self.key] = self.new
        core.touch(self.p)
        self.store.projectChanged.emit(self.p)

    def undo(self):
        if self.had_key:
            self.p[self.key] = self.old
        else:
            self.p.pop(self.key, None)
        if self.old_updated is None:
            self.p.pop("updated", None)
        else:
            self.p["updated"] = self.old_updated
        self.store.projectChanged.emit(self.p)


class _EditProject(QUndoCommand):
    def __init__(self, store: Store, p: dict, before: dict, after: dict, label: str):
        super().__init__(label)
        self.store, self.p, self.before, self.after = store, p, before, after

    def redo(self):
        _restore(self.p, self.after)
        self.store.projectChanged.emit(self.p)

    def undo(self):
        _restore(self.p, self.before)
        self.store.projectChanged.emit(self.p)


def _rename_refs(home: dict, old: str, new: str | None):
    for s in home.get("sets", []):
        items = s.get("projects", [])
        s["projects"] = [new if k == old else k for k in items if not (k == old and new is None)]
        if "locked" in s:
            s["locked"] = [new if k == old else k for k in s["locked"] if not (k == old and new is None)]


class _EditHome(QUndoCommand):
    def __init__(self, store: Store, before: dict, after: dict, label: str):
        super().__init__(label)
        self.store, self.before, self.after = store, before, after

    def redo(self):
        _restore(self.store.home, self.after)
        self.store.homeChanged.emit()

    def undo(self):
        _restore(self.store.home, self.before)
        self.store.homeChanged.emit()


class _SetList(QUndoCommand):
    def __init__(self, store: Store, before: list, after: list, label: str):
        super().__init__(label)
        self.store, self.before, self.after = store, before, after

    def redo(self):
        self.store.projects[:] = self.after
        self.store.listChanged.emit()

    def undo(self):
        self.store.projects[:] = self.before
        self.store.listChanged.emit()
