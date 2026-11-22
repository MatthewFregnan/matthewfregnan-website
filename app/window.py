"""Main window: wires the store, project list, editor, video checker and site tasks together."""
from __future__ import annotations

import copy
import shutil

from PySide6.QtCore import QSettings, QStandardPaths, Qt, QTimer, QUrl
from PySide6.QtGui import QAction, QDesktopServices, QKeySequence
from PySide6.QtWidgets import (
    QComboBox, QDialog, QDialogButtonBox, QFormLayout, QLabel, QLineEdit, QMainWindow, QMessageBox, QSplitter,
    QStackedWidget, QToolBar, QVBoxLayout,
)
from pathlib import Path

import core
import tasks
from editor import ProjectEditor, download_thumbnail
from sidebar import Sidebar
from store import Store
from videos import VideoChecker
from widgets import dot, run_async

APP_NAME = "Portfolio Manager"


class NewFromLinkDialog(QDialog):
    """Paste a link → the app looks the video up and suggests a category."""

    def __init__(self, parent, store: Store, default_category: str):
        super().__init__(parent)
        self.setWindowTitle("New Project from Link")
        self.ref: core.VideoRef | None = None
        self.status: core.VideoStatus | None = None
        self._category_touched = False
        self.link = QLineEdit(placeholderText="Paste a video file, Vimeo, YouTube or Instagram link")
        self.link.textChanged.connect(lambda: self._timer.start())
        self.category = QComboBox()
        for c in store.categories:
            self.category.addItem(c["name"], c["id"])
        self.category.setCurrentIndex(max(0, self.category.findData(default_category)))
        self.category.activated.connect(lambda: setattr(self, "_category_touched", True))
        self.info = QLabel(" ")
        self.info.setWordWrap(True)
        self.info.setMinimumHeight(40)
        self.buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.create = self.buttons.addButton("Create Project", QDialogButtonBox.AcceptRole)
        self.create.setEnabled(False)
        self.buttons.accepted.connect(self.accept)
        self.buttons.rejected.connect(self.reject)
        form = QFormLayout(self)
        form.addRow("Link", self.link)
        form.addRow("Category", self.category)
        form.addRow("", self.info)
        form.addRow(self.buttons)
        self.resize(560, 0)
        self._timer = QTimer(self, singleShot=True, interval=350)
        self._timer.timeout.connect(self._lookup)

    def _lookup(self):
        self.ref = core.parse_video(self.link.text())
        self.status = None
        self.create.setEnabled(self.ref is not None)
        if not self.ref:
            self.info.setText(f"{dot('bad')} Not a video file, Vimeo, YouTube or Instagram link." if self.link.text().strip() else " ")
            return
        self.info.setText("Looking up the video…")
        ref = self.ref
        run_async(lambda: core.check_video(ref), lambda st: self._found(ref, st))

    def _found(self, ref: core.VideoRef, st):
        if ref != self.ref or isinstance(st, Exception):
            return
        self.status = st
        if st.ok:
            year = f" · {st.upload_date[:4]}" if st.upload_date else ""
            self.info.setText(f"{dot('ok')} <b>{core.tidy_title(st.title)}</b>{year}<br>"
                              "Title, year and thumbnail will be filled in for you.")
            if st.height > st.width and not self._category_touched:
                self.category.setCurrentIndex(max(0, self.category.findData("vertical")))
        elif st.ok is None:
            self.info.setText(f"{dot(None)} {st.message}")
        else:
            self.info.setText(f"{dot('bad')} {st.message}. You can still create the project and fix the link later.")


class MainWindow(QMainWindow):
    def __init__(self, repo: core.Repo):
        super().__init__()
        self.repo = repo
        self.store = Store(repo)
        cache = Path(QStandardPaths.writableLocation(QStandardPaths.AppDataLocation)) / "video-status.json"
        self.checker = VideoChecker(cache)
        self.previewer = tasks.Previewer(repo)
        self.changes: list[str] = []

        self.setWindowTitle(APP_NAME)
        self.setUnifiedTitleAndToolBarOnMac(True)
        self.resize(1280, 820)

        self.sidebar = Sidebar(self.store, self.checker)
        self.editor = ProjectEditor(self.store, self.checker)
        self.empty = QLabel("Select a project, or click “New from Link” to add one.", alignment=Qt.AlignCenter)
        self.stack = QStackedWidget()
        self.stack.addWidget(self.empty)
        self.stack.addWidget(self.editor)
        self.split = QSplitter()
        self.split.addWidget(self.sidebar)
        self.split.addWidget(self.stack)
        self.split.setStretchFactor(1, 1)
        self.split.setSizes([300, 980])
        self.setCentralWidget(self.split)

        self._build_actions()
        self.sidebar.selected.connect(self._on_selected)
        self.editor.message.connect(lambda m: self.statusBar().showMessage(m, 5000))
        self.store.saved.connect(self._on_saved)
        self.store.saveFailed.connect(lambda e: QMessageBox.critical(self, "Couldn't save", e))
        self.store.listChanged.connect(self._update_actions)
        self.checker.batchDone.connect(self._report_check)

        settings = QSettings()
        if settings.value("geometry"):
            self.restoreGeometry(settings.value("geometry"))
        if settings.value("splitter"):
            self.split.restoreState(settings.value("splitter"))
        self._on_selected(None)
        self._refresh_changes()
        self.statusBar().showMessage(f"{len(self.store.projects)} projects · changes save automatically")
        QTimer.singleShot(300, lambda: self.checker.check_projects(self.store.projects))
        run_async(lambda: tasks.sync_from_github(self.repo), self._synced)

    def _synced(self, msg):
        if isinstance(msg, str) and msg.startswith("Downloaded"):
            current = self.editor.p
            key = (current["category"], current["id"]) if current else None
            self.store.reload()
            match = next((p for p in self.store.projects if key and (p["category"], p["id"]) == key), None)
            self.sidebar.select(match)
            self.checker.check_projects(self.store.projects)
            self._refresh_changes()
        if isinstance(msg, str) and msg:
            self.statusBar().showMessage(msg, 8000)

    # ------------------------------------------------------------------ actions
    def _build_actions(self):
        def act(text, slot, shortcut=None, tip=None):
            a = QAction(text, self)
            a.triggered.connect(slot)
            if shortcut:
                a.setShortcut(QKeySequence(shortcut))
                a.setToolTip(f"{tip or text} ({a.shortcut().toString(QKeySequence.NativeText)})")
            elif tip:
                a.setToolTip(tip)
            return a

        self.act_new_link = act("New from Link…", self.new_from_link, QKeySequence.New, "New project from a video link")
        self.act_new = act("New Blank", self.new_blank, "Ctrl+Shift+N", "New empty project")
        self.act_dup = act("Duplicate", self.duplicate, "Ctrl+D")
        self.act_del = act("Delete", self.delete, "Ctrl+Backspace", "Delete project (you can undo)")
        self.act_up = act("Move Up", lambda: self.move(-1), "Ctrl+Up")
        self.act_down = act("Move Down", lambda: self.move(1), "Ctrl+Down")
        self.act_undo = self.store.undo_stack.createUndoAction(self, "Undo")
        self.act_undo.setShortcut(QKeySequence.Undo)
        self.act_redo = self.store.undo_stack.createRedoAction(self, "Redo")
        self.act_redo.setShortcut(QKeySequence.Redo)
        self.act_find = act("Find", lambda: (self.sidebar.search.setFocus(), self.sidebar.search.selectAll()),
                            QKeySequence.Find)
        self.act_check = act("Check Videos", self.check_videos, "Ctrl+K", "Check every video link still plays")
        self.act_home = act("Home Page…", self.open_home, "Ctrl+H", "Choose which projects are on the home page")
        self.act_preview = act("Preview Site", self.preview, "Ctrl+R", "Build the site and open it in your browser")
        self.act_view = act("View on Site", self.view_on_site, "Ctrl+Shift+V", "Open this project on the live site")
        self.act_discard = act("Discard Unpublished Changes…", self.discard_changes, None,
                               "Throw away everything that isn't live yet")
        self.act_publish = act("Publish", self.publish, "Ctrl+Shift+P", "Put your changes live")

        tb = QToolBar("Main")
        tb.setMovable(False)
        tb.setToolButtonStyle(Qt.ToolButtonTextOnly)
        for a in (self.act_new_link, self.act_new, self.act_dup, self.act_del, None, self.act_undo, self.act_redo,
                  None, self.act_home, self.act_check, self.act_view, self.act_preview, self.act_publish):
            tb.addSeparator() if a is None else tb.addAction(a)
        self.addToolBar(tb)

        mb = self.menuBar()
        for title, items in (
            ("&File", (self.act_new_link, self.act_new, self.act_dup, None, self.act_view, self.act_preview,
                       self.act_publish, None, self.act_discard)),
            ("&Edit", (self.act_undo, self.act_redo, None, self.act_find, self.act_up, self.act_down, None, self.act_del)),
            ("&Tools", (self.act_home, self.act_check)),
        ):
            m = mb.addMenu(title)
            for a in items:
                m.addSeparator() if a is None else m.addAction(a)

    def _update_actions(self):
        p = self.editor.p
        has = p is not None and any(x is p for x in self.store.projects)
        for a in (self.act_dup, self.act_del, self.act_up, self.act_down, self.act_view):
            a.setEnabled(has)
        if has:
            row, n = self.store.row_in_category(p)
            self.act_up.setEnabled(row > 0)
            self.act_down.setEnabled(row < n - 1)

    # ------------------------------------------------------------------ selection
    def _on_selected(self, p: dict | None):
        self.editor.set_project(p)
        self.stack.setCurrentWidget(self.editor if p is not None else self.empty)
        self._update_actions()

    def _current_category(self) -> str:
        p = self.editor.p
        return p["category"] if p else (self.sidebar.filter.currentData() or self.store.categories[0]["id"])

    # ------------------------------------------------------------------ project ops
    def new_from_link(self):
        dlg = NewFromLinkDialog(self, self.store, self._current_category())
        if dlg.exec() != QDialog.Accepted or not dlg.ref:
            return
        ref, st, cat = dlg.ref, dlg.status, dlg.category.currentData()
        title = core.tidy_title(st.title) if st and st.title else "New Project"
        p = {"id": core.unique_id(self.store.data, core.slugify(title), cat), "title": title, "category": cat,
             "client": "", "role": "Editor", "production": "", "year": (st.upload_date[:4] if st and st.upload_date else ""),
             "description": "", "thumbnail": ""}
        core.set_source(p, ref.kind, ref)
        core.touch(p)

        def finish(path):
            if isinstance(path, Path):
                try:
                    core.import_thumbnail(self.repo, p, path)
                finally:
                    shutil.rmtree(path.parent, ignore_errors=True)
            self.store.add(p)
            self.sidebar.select(p)
            self.editor.f["client"].setFocus()
            self.statusBar().showMessage(f"Added “{title}”. Fill in the client and production.", 6000)

        if st and st.ok and st.thumbnail_url:
            self.statusBar().showMessage("Downloading thumbnail…")
            run_async(lambda: download_thumbnail(ref, st), finish)
        else:
            finish(None)

    def new_blank(self):
        cat = self._current_category()
        p = {"id": core.unique_id(self.store.data, "new-project", cat), "title": "New Project", "category": cat,
             "client": "", "role": "Editor", "production": "", "year": "", "description": "", "thumbnail": ""}
        core.touch(p)
        self.store.add(p)
        self.sidebar.select(p)
        self.editor.f["title"].setFocus()
        self.editor.f["title"].selectAll()

    def duplicate(self):
        p = self.editor.p
        if p is None:
            return
        q = copy.deepcopy(p)
        q["title"] = p.get("title", "") + " (copy)"
        q["id"] = core.unique_id(self.store.data, p["id"] + "-copy", p["category"])
        core.touch(q)
        self.store.add(q, after=p)
        self.sidebar.select(q)

    def delete(self):
        p = self.editor.p
        if p is None:
            return
        self.store.remove(p)
        self.statusBar().showMessage(f"Deleted “{p.get('title')}”. Undo (⌘Z / Ctrl+Z) to bring it back.", 8000)

    def move(self, step: int):
        p = self.editor.p
        if p is not None:
            row, _n = self.store.row_in_category(p)
            self.store.move(p, row + step)
            self._update_actions()

    # ------------------------------------------------------------------ home page
    def open_home(self):
        from home import HomeDialog
        HomeDialog(self, self.store).exec()

    # ------------------------------------------------------------------ videos
    def check_videos(self):
        self.statusBar().showMessage("Checking every video link…")
        self.checker.check_all(self.store.projects)

    def _report_check(self):
        states = {id(p): self.checker.state(p) for p in self.store.projects}
        bad = [p for p in self.store.projects if states[id(p)] == "bad"]
        backup = [p for p in self.store.projects if states[id(p)] == "backup"]
        none = [p for p in self.store.projects if not core.project_video(p) and not p.get("gallery")]
        self.statusBar().showMessage(f"Video check done: {len(bad)} not playing, {len(backup)} using a backup", 8000)
        if not (bad or backup or none):
            QMessageBox.information(self, "Videos", "Every video plays.")
            return
        line = lambda p: f"• {p['title']} ({self.store.category(p['category'])['name']})"
        parts = []
        if bad:
            parts.append(f"{len(bad)} project(s) have no video that plays (red dot):\n" + "\n".join(map(line, bad)))
        if backup:
            parts.append(f"{len(backup)} project(s) are playing their backup link (orange dot):\n" + "\n".join(map(line, backup)))
        if none:
            parts.append(f"{len(none)} project(s) have no video and no gallery.")
        QMessageBox.warning(self, "Videos", "\n\n".join(parts))

    # ------------------------------------------------------------------ save / preview / publish
    def _on_saved(self):
        self.statusBar().showMessage("All changes saved", 2500)
        self._refresh_changes()

    def _refresh_changes(self):
        run_async(lambda: tasks.unpublished_changes(self.repo), self._set_changes)

    def _set_changes(self, changes):
        self.changes = changes if isinstance(changes, list) else []
        n = len(self.changes)
        self.act_publish.setText(f"Publish ({n})" if n else "Publish")
        self.act_publish.setToolTip("\n".join(self.changes) if n else "Everything is live")

    def view_on_site(self):
        p = self.editor.p
        if p is not None:
            QDesktopServices.openUrl(QUrl("https://matthewfregnan.com" + self.store.page_path(p)))

    def discard_changes(self):
        self.store.flush()
        changes = tasks.unpublished_changes(self.repo)
        if not changes:
            QMessageBox.information(self, "Discard", "There's nothing unpublished to discard.")
            return
        listing = "\n".join(f"• {c}" for c in changes[:15]) + ("\n…" if len(changes) > 15 else "")
        if QMessageBox.warning(self, "Discard unpublished changes?",
                               f"This throws away everything that isn't live yet:\n\n{listing}\n\n"
                               "Your project list and images go back to what's on the site. This can't be undone.",
                               QMessageBox.Discard | QMessageBox.Cancel, QMessageBox.Cancel) != QMessageBox.Discard:
            return
        current = self.editor.p
        key = (current["category"], current["id"]) if current else None
        r1 = tasks.git(self.repo, "restore", "--source=HEAD", "--staged", "--worktree", "--", "data", "images")
        r2 = tasks.git(self.repo, "clean", "-fd", "--", "images")
        if r1.returncode != 0 or r2.returncode != 0:
            QMessageBox.critical(self, "Discard", f"Couldn't discard:\n{(r1.stderr or r2.stderr)[-400:]}")
            return
        self.store.reload()
        match = next((p for p in self.store.projects if key and (p["category"], p["id"]) == key), None)
        self.sidebar.select(match)
        self._refresh_changes()
        self.statusBar().showMessage("Discarded unpublished changes.", 6000)

    def preview(self):
        self.store.flush()
        p = self.editor.p
        self.previewer.run(self, self.store.page_path(p) if p else "/")

    def publish(self):
        self.store.flush()
        changes = tasks.unpublished_changes(self.repo)
        if not changes:
            QMessageBox.information(self, "Publish", "Nothing new to publish. The live site is up to date.")
            return
        tasks.publish(self, self.repo, changes, on_done=lambda: (
            self.statusBar().showMessage("Published. GitHub is updating the site (1–2 minutes).", 10000),
            self._refresh_changes()))
        self._refresh_changes()

    def closeEvent(self, e):
        self.store.flush()
        s = QSettings()
        s.setValue("geometry", self.saveGeometry())
        s.setValue("splitter", self.split.saveState())
        self.checker.shutdown()
        self.previewer.stop()
        e.accept()
