"""Left-hand project list: search, category filter, drag to reorder."""
from __future__ import annotations

from PySide6.QtCore import QRect, QSize, Qt, Signal
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QLineEdit, QStyle, QStyledItemDelegate, QTreeWidget, QTreeWidgetItem,
    QVBoxLayout, QWidget,
)

from store import Store
from videos import VideoChecker
from widgets import COLORS, dot_icon

PID = Qt.UserRole        # id() of the project dict an item shows
CAT = Qt.UserRole + 1    # category id on category header items
THUMB = Qt.UserRole + 2  # thumbnail file path
SUB = Qt.UserRole + 3    # "client · year" line
DOT = Qt.UserRole + 4    # status dot colour (or "")
FOCUS = Qt.UserRole + 5  # (x%, y%) focus point for cropping the thumbnail

THUMB_W, THUMB_H = 48, 27


class ProjectDelegate(QStyledItemDelegate):
    """Project rows like the web admin: status dot, small thumbnail, title with client · year under it."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cache: dict[tuple, QPixmap] = {}

    def _thumb(self, path: str, focus) -> QPixmap | None:
        focus = tuple(focus) if focus else (50.0, 50.0)
        key = (path, focus)
        if key not in self._cache:
            pix = QPixmap(path)
            if pix.isNull():
                self._cache[key] = None
            else:
                from widgets import crop_preview
                self._cache[key] = crop_preview(pix, focus or (50.0, 50.0), THUMB_W / THUMB_H, THUMB_W * 2)
        return self._cache[key]

    def sizeHint(self, option, index):
        if index.data(PID) is None:
            return super().sizeHint(option, index)
        return QSize(option.rect.width(), 40)

    def paint(self, painter: QPainter, option, index):
        if index.data(PID) is None:
            return super().paint(painter, option, index)
        painter.save()
        selected = option.state & QStyle.State_Selected
        if selected:
            painter.fillRect(option.rect, option.palette.highlight())
        elif option.state & QStyle.State_MouseOver:
            painter.fillRect(option.rect, option.palette.alternateBase())
        r = option.rect
        x = r.left() + 4
        dot = index.data(DOT)
        if dot:
            painter.setRenderHint(QPainter.Antialiasing)
            painter.setPen(Qt.NoPen)
            painter.setBrush(QColor(dot))
            painter.drawEllipse(x, r.center().y() - 4, 8, 8)
        x += 14
        thumb_rect = QRect(x, r.center().y() - THUMB_H // 2, THUMB_W, THUMB_H)
        pix = self._thumb(index.data(THUMB), index.data(FOCUS)) if index.data(THUMB) else None
        if pix:
            painter.drawPixmap(thumb_rect, pix)
        else:
            painter.fillRect(thumb_rect, option.palette.mid())
        x += THUMB_W + 8
        text_w = r.right() - x - 4
        title_color = option.palette.highlightedText().color() if selected else option.palette.text().color()
        sub_color = QColor(title_color)
        sub_color.setAlpha(150)
        f = option.font
        painter.setFont(f)
        painter.setPen(title_color)
        fm = painter.fontMetrics()
        painter.drawText(QRect(x, r.top() + 4, text_w, fm.height()), Qt.AlignLeft | Qt.AlignVCenter,
                         fm.elidedText(index.data(Qt.DisplayRole) or "", Qt.ElideRight, text_w))
        small = f.__class__(f)
        small.setPointSizeF(max(8.0, f.pointSizeF() - 1.5))
        painter.setFont(small)
        painter.setPen(sub_color)
        sfm = painter.fontMetrics()
        painter.drawText(QRect(x, r.top() + 4 + fm.height(), text_w, sfm.height()), Qt.AlignLeft | Qt.AlignVCenter,
                         sfm.elidedText(index.data(SUB) or "", Qt.ElideRight, text_w))
        painter.restore()


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
        self.tree.setItemDelegate(ProjectDelegate(self.tree))
        self.tree.setMouseTracking(True)
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
        from widgets import parse_focus
        item.setText(0, p.get("title") or "(untitled)")
        item.setToolTip(0, f"{p.get('client', '')}  ·  {self.store.page_path(p)}")
        state = self.checker.state(p)
        item.setData(0, DOT, COLORS[state] if state else "")
        thumb = self.store.repo.thumb_path(p)
        item.setData(0, THUMB, str(thumb) if thumb and thumb.exists() else "")
        item.setData(0, FOCUS, parse_focus(p.get("thumbFocus")))
        item.setData(0, SUB, " · ".join(x for x in (p.get("client", ""), p.get("year", "")) if x) or " ")

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
