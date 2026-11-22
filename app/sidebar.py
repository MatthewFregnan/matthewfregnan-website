"""Left-hand project list: search, category filter, drag to reorder."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QIcon
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QLineEdit, QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget,
)

from store import Store
from videos import VideoChecker
from widgets import COLORS, dot_icon

PID = Qt.UserRole        # id() of the project dict an item shows
CAT = Qt.UserRole + 1    # category id on category header items


class ProjectTree(QTreeWidget):
    """Tree that lets you drag a project up or down within its own category."""
    moved = Signal(int, int)   # project id(), new row in category

    def __init__(self):
        super().__init__(headerHidden=True)
        self.setIndentation(14)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.setDefaultDropAction(Qt.MoveAction)

    def dropEvent(self, e):
        src = self.currentItem()
        target = self.itemAt(e.position().toPoint())
        e.ignore()  # we reorder the data ourselves; the tree is rebuilt from it
        if not src or not target or src.parent() is None:
            return
        cat = target if target.parent() is None else target.parent()
        if cat is not src.parent():
            return  # dragging into another category isn't a reorder; use the Category field
        if target is cat:
            row = 0
        else:
            row = cat.indexOfChild(target)
            if self.dropIndicatorPosition() == QAbstractItemView.BelowItem:
                row += 1
            if row > cat.indexOfChild(src):
                row -= 1
        self.moved.emit(src.data(0, PID), row)


class Sidebar(QWidget):
    selected = Signal(object)   # project dict, or None

    def __init__(self, store: Store, checker: VideoChecker):
        super().__init__()
        self.store, self.checker = store, checker
        self.current: dict | None = None
        self._items: dict[int, QTreeWidgetItem] = {}

        self.search = QLineEdit(placeholderText="Search title, client, production…", clearButtonEnabled=True)
        self.search.textChanged.connect(self.rebuild)
        self.filter = QComboBox()
        self.filter.addItem("All categories", "")
        for c in store.categories:
            self.filter.addItem(c["name"], c["id"])
        self.filter.currentIndexChanged.connect(self.rebuild)
        self.tree = ProjectTree()
        self.tree.currentItemChanged.connect(self._on_current)
        self.tree.moved.connect(self._on_moved)

        lay = QVBoxLayout(self)
        lay.setContentsMargins(8, 8, 4, 8)
        lay.addWidget(self.search)
        lay.addWidget(self.filter)
        lay.addWidget(self.tree, 1)

        store.listChanged.connect(self.rebuild)
        store.projectChanged.connect(self._on_project_changed)
        checker.checked.connect(lambda _url: self.refresh_icons())
        self.rebuild()

    # ------------------------------------------------------------------ building
    def rebuild(self):
        term = self.search.text().strip().lower()
        only = self.filter.currentData()
        # Reordering only makes sense when every project in a category is visible
        self.tree.setDragEnabled(not term)
        self.tree.blockSignals(True)
        self.tree.clear()
        self._items.clear()
        for c in self.store.categories:
            if only and c["id"] != only:
                continue
            head = QTreeWidgetItem()
            head.setData(0, CAT, c["id"])
            head.setFlags(Qt.ItemIsEnabled | Qt.ItemIsDropEnabled)
            f = head.font(0)
            f.setBold(True)
            head.setFont(0, f)
            for p in self.store.projects:
                if p.get("category") != c["id"]:
                    continue
                hay = " ".join(str(p.get(k, "")) for k in ("title", "client", "production", "role")).lower()
                if term and term not in hay:
                    continue
                item = QTreeWidgetItem()
                item.setData(0, PID, id(p))
                item.setFlags(Qt.ItemIsEnabled | Qt.ItemIsSelectable | Qt.ItemIsDragEnabled)
                self._items[id(p)] = item
                self._decorate(item, p)
                head.addChild(item)
            head.setText(0, f"{c['name'].upper()}  ({head.childCount()})")
            self.tree.addTopLevelItem(head)
            head.setExpanded(True)
        if self.current is not None and id(self.current) in self._items:
            self.tree.setCurrentItem(self._items[id(self.current)])
        self.tree.blockSignals(False)
        if self.current is not None and not any(p is self.current for p in self.store.projects):
            self.select(None)  # it was deleted (or an add was undone)

    def _decorate(self, item: QTreeWidgetItem, p: dict):
        item.setText(0, p.get("title") or "(untitled)")
        item.setToolTip(0, f"{p.get('client', '')}  ·  {self.store.page_path(p)}")
        state = self.checker.state(p)
        item.setIcon(0, dot_icon(COLORS[state]) if state else QIcon())

    def refresh_icons(self):
        by_id = {id(p): p for p in self.store.projects}
        for pid, item in self._items.items():
            if pid in by_id:
                self._decorate(item, by_id[pid])

    def _on_project_changed(self, p: dict):
        item = self._items.get(id(p))
        if item is None or item.parent().data(0, CAT) != p.get("category"):
            self.rebuild()   # moved category, or not in the current view
        else:
            self._decorate(item, p)

    # ------------------------------------------------------------------ selection
    def _project_for(self, item) -> dict | None:
        pid = item.data(0, PID) if item else None
        return next((p for p in self.store.projects if id(p) == pid), None) if pid else None

    def _on_current(self, item, _prev):
        p = self._project_for(item)
        if p is not None and p is not self.current:
            self.current = p
            self.selected.emit(p)

    def select(self, p: dict | None):
        """Select a project, clearing the search/filter if they'd hide it."""
        self.current = p
        if p is not None and id(p) not in self._items:
            for w in (self.search, self.filter):
                w.blockSignals(True)
            self.search.clear()
            if self.filter.currentData() not in ("", p["category"]):
                self.filter.setCurrentIndex(0)
            for w in (self.search, self.filter):
                w.blockSignals(False)
            self.rebuild()
        if p is not None:
            self.tree.blockSignals(True)
            self.tree.setCurrentItem(self._items[id(p)])
            self.tree.scrollToItem(self._items[id(p)])
            self.tree.blockSignals(False)
        else:
            self.tree.setCurrentItem(None)
        self.selected.emit(p)

    def _on_moved(self, pid: int, row: int):
        p = next((x for x in self.store.projects if id(x) == pid), None)
        if p is not None:
            self.store.move(p, row)
