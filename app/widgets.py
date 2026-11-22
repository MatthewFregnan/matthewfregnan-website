"""Small reusable widgets and helpers."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from PySide6.QtCore import QObject, QSize, QStringListModel, Qt, Signal
from PySide6.QtCore import QPointF
from PySide6.QtGui import QColor, QIcon, QPainter, QPen, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView, QCompleter, QFileDialog, QFrame, QLabel, QLineEdit, QListWidget, QPlainTextEdit,
    QSizePolicy,
)

IMAGE_FILTER = "Images (*.png *.jpg *.jpeg *.webp *.tif *.tiff *.bmp *.gif *.heic)"
COLORS = {True: "#2fb36b", False: "#e5484d", None: "#9a9a9a",
          "ok": "#2fb36b", "backup": "#f0a020", "bad": "#e5484d", "unknown": "#9a9a9a"}


def dot_icon(color: str, size: int = 10) -> QIcon:
    pm = QPixmap(size * 2, size * 2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor(color))
    p.setPen(Qt.NoPen)
    p.drawEllipse(size // 2, size // 2, size, size)
    p.end()
    return QIcon(pm)


def dot(color_key) -> str:
    return f"<span style='color:{COLORS[color_key]}'>●</span>"


# --------------------------------------------------------------------------- background work

class _Relay(QObject):
    done = Signal(object, object)   # callback, result


_relay: _Relay | None = None
_pool = ThreadPoolExecutor(max_workers=4)


def run_async(fn: Callable[[], Any], callback: Callable[[Any], None]):
    """Run `fn` on a worker thread, then `callback(result)` on the UI thread.
    If `fn` raises, the callback receives the exception object."""
    global _relay
    if _relay is None:
        _relay = _Relay()
        _relay.done.connect(lambda cb, res: cb(res))

    def work():
        try:
            res = fn()
        except Exception as e:  # handed to the callback to deal with
            res = e
        _relay.done.emit(callback, res)

    _pool.submit(work)


# --------------------------------------------------------------------------- inputs

class SuggestEdit(QLineEdit):
    """Line edit that suggests values already used on other projects (e.g. production companies)."""

    def __init__(self, placeholder: str = ""):
        super().__init__(placeholderText=placeholder)
        self._model = QStringListModel()
        c = QCompleter(self._model, self)
        c.setCaseSensitivity(Qt.CaseInsensitive)
        c.setFilterMode(Qt.MatchContains)
        c.setCompletionMode(QCompleter.PopupCompletion)
        self.setCompleter(c)

    def set_suggestions(self, values: list[str]):
        self._model.setStringList(values)

    def mousePressEvent(self, e):
        super().mousePressEvent(e)
        if not self.text():  # show every option when clicking an empty field
            self.completer().setCompletionPrefix("")
            self.completer().complete()


class PlainEdit(QPlainTextEdit):
    editingFinished = Signal()

    def focusOutEvent(self, e):
        super().focusOutEvent(e)
        self.editingFinished.emit()


def set_text_quietly(w: QLineEdit | QPlainTextEdit, value: str):
    """Update a field from the data without disturbing the cursor if it already matches."""
    current = w.toPlainText() if isinstance(w, QPlainTextEdit) else w.text()
    if current == value:
        return
    w.blockSignals(True)
    if isinstance(w, QPlainTextEdit):
        w.setPlainText(value)
    else:
        w.setText(value)
    w.blockSignals(False)


# --------------------------------------------------------------------------- images

class ImageDrop(QLabel):
    """Shows an image; accepts a dropped image file or a click to choose one.

    With `focus_mode` on, clicking a shown image sets its focus point instead (emits
    focusChosen with percentages) and a ring marks the current point."""
    fileChosen = Signal(Path)
    focusChosen = Signal(float, float)

    def __init__(self, empty_text: str = "Drop an image here\nor click to choose", max_height: int = 320):
        super().__init__()
        self.empty_text, self.max_height = empty_text, max_height
        self.setAcceptDrops(True)
        self.setAlignment(Qt.AlignCenter)
        self.setMinimumSize(240, 150)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        self.setCursor(Qt.PointingHandCursor)
        self.setFrameShape(QFrame.StyledPanel)
        self._pix: QPixmap | None = None
        self.focus_mode = False
        self.focus: tuple[float, float] = (50.0, 50.0)
        self.show_path(None)

    def show_path(self, path: Path | None, focus: tuple[float, float] | None = None):
        pix = QPixmap(str(path)) if path and path.exists() else None
        self._pix = pix if pix and not pix.isNull() else None
        self.focus = focus or (50.0, 50.0)
        if self._pix:
            self._rescale()
            self.setCursor(Qt.CrossCursor if self.focus_mode else Qt.PointingHandCursor)
        else:
            self.setPixmap(QPixmap())
            self.setText(self.empty_text)
            self.setCursor(Qt.PointingHandCursor)
        self.update()

    def _shown_rect(self):
        pm = self.pixmap()
        if pm is None or pm.isNull():
            return None
        x = (self.width() - pm.width()) / 2
        y = (self.height() - pm.height()) / 2
        return x, y, pm.width(), pm.height()

    def paintEvent(self, e):
        super().paintEvent(e)
        r = self._shown_rect() if (self.focus_mode and self._pix) else None
        if not r:
            return
        x, y, w, h = r
        cx, cy = x + w * self.focus[0] / 100, y + h * self.focus[1] / 100
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(QColor(0, 0, 0, 140), 5))
        p.drawEllipse(QPointF(cx, cy), 12, 12)
        p.setPen(QPen(QColor("white"), 2))
        p.drawEllipse(QPointF(cx, cy), 12, 12)
        p.setBrush(QColor("white"))
        p.drawEllipse(QPointF(cx, cy), 2, 2)
        p.end()

    def _rescale(self):
        if self._pix:
            w = max(self.width(), self.minimumWidth()) - 12
            self.setPixmap(self._pix.scaled(w, self.max_height, Qt.KeepAspectRatio, Qt.SmoothTransformation))

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._rescale()

    def mouseReleaseEvent(self, e):
        r = self._shown_rect() if (self.focus_mode and self._pix) else None
        if r:
            x, y, w, h = r
            px, py = e.position().x(), e.position().y()
            if x <= px <= x + w and y <= py <= y + h:
                self.focusChosen.emit(round((px - x) / w * 100), round((py - y) / h * 100))
            return
        f, _ = QFileDialog.getOpenFileName(self, "Choose image", "", IMAGE_FILTER)
        if f:
            self.fileChosen.emit(Path(f))


def parse_focus(value) -> tuple[float, float]:
    """A project's thumbFocus ("x% y%") as numbers; the centre if unset."""
    import re
    m = re.fullmatch(r"(\d{1,3}(?:\.\d+)?)% (\d{1,3}(?:\.\d+)?)%", str(value or "").strip())
    return (min(100.0, float(m[1])), min(100.0, float(m[2]))) if m else (50.0, 50.0)


def crop_preview(pix: QPixmap, focus: tuple[float, float], aspect: float, width: int) -> QPixmap:
    """What a CSS object-fit: cover crop at `aspect` (w/h) keeps, honouring the focus point."""
    w, h = pix.width(), pix.height()
    if w / h > aspect:
        cw, ch = h * aspect, h
    else:
        cw, ch = w, w / aspect
    x0 = (w - cw) * focus[0] / 100
    y0 = (h - ch) * focus[1] / 100
    return pix.copy(int(x0), int(y0), int(cw), int(ch)).scaledToWidth(width, Qt.SmoothTransformation)

    def dragEnterEvent(self, e):
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e):
        files = [Path(u.toLocalFile()) for u in e.mimeData().urls() if u.isLocalFile()]
        if files:
            self.fileChosen.emit(files[0])


class GalleryList(QListWidget):
    """Gallery stills: drag to reorder, drop files from Finder/Explorer to add, Delete to remove."""
    filesDropped = Signal(list)
    orderChanged = Signal()
    deletePressed = Signal()

    def __init__(self):
        super().__init__()
        # ListMode + wrapping (not IconMode) so drag-to-reorder really reorders the items
        self.setFlow(QListWidget.LeftToRight)
        self.setWrapping(True)
        self.setIconSize(QSize(128, 72))
        self.setSpacing(4)
        self.setResizeMode(QListWidget.Adjust)
        self.setUniformItemSizes(True)
        self.setDragDropMode(QAbstractItemView.InternalMove)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setAcceptDrops(True)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setMinimumHeight(180)

    def _external(self, e) -> bool:
        return e.mimeData().hasUrls() and e.source() is None

    def dragEnterEvent(self, e):
        e.acceptProposedAction() if self._external(e) else super().dragEnterEvent(e)

    def dragMoveEvent(self, e):
        e.acceptProposedAction() if self._external(e) else super().dragMoveEvent(e)

    def dropEvent(self, e):
        if self._external(e):
            self.filesDropped.emit([Path(u.toLocalFile()) for u in e.mimeData().urls() if u.isLocalFile()])
            e.acceptProposedAction()
            return
        super().dropEvent(e)
        self.orderChanged.emit()

    def keyPressEvent(self, e):
        if e.key() in (Qt.Key_Delete, Qt.Key_Backspace):
            self.deletePressed.emit()
        else:
            super().keyPressEvent(e)
