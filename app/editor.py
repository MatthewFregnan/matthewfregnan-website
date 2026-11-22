"""Right-hand editor for one project. Every edit goes straight to the Store (undoable, autosaved)."""
from __future__ import annotations

import functools
import shutil
import tempfile
from pathlib import Path

from PySide6.QtCore import QRegularExpression, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QIcon, QRegularExpressionValidator
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QFileDialog, QFormLayout, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit,
    QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton, QScrollArea, QSizePolicy, QVBoxLayout, QWidget,
)

import core
from store import Store
from videos import VideoChecker
from widgets import (
    COLORS, IMAGE_FILTER, GalleryList, ImageDrop, PlainEdit, SuggestEdit, crop_preview, dot, parse_focus, run_async,
    set_text_quietly,
)

TEXT_KEYS = ["title", "client", "role", "production", "agency", "year", "platform", "deliverables", "description"]
GENERIC = "Paste a video file, Vimeo, YouTube or Instagram link"
PLACEHOLDERS = {
    "file": "https://videos.matthewfregnan.com/…/name.mp4",
    "vimeo": "Vimeo link (unlisted share links work too)",
    "youtube": "YouTube link (video, Short or live)",
    "instagram": "Instagram post or reel link",
}


def section(title: str) -> QLabel:
    lbl = QLabel(title)
    lbl.setStyleSheet("font-weight: 600; margin-top: 6px;")
    return lbl


def link_button(text: str) -> QPushButton:
    b = QPushButton(text)
    b.setFlat(True)
    b.setCursor(Qt.PointingHandCursor)
    b.setStyleSheet("text-align: left; color: palette(link); padding: 2px 0;")
    return b


class ProjectEditor(QScrollArea):
    message = Signal(str)

    def __init__(self, store: Store, checker: VideoChecker):
        super().__init__(widgetResizable=True, frameShape=QFrame.NoFrame)
        self.store, self.checker = store, checker
        self.p: dict | None = None
        self._show_backups = False
        self._show_gallery = False
        self._gallery_shown: list[str] | None = None

        body = QWidget()
        self.setWidget(body)
        outer = QVBoxLayout(body)
        outer.setContentsMargins(20, 14, 20, 20)
        self.heading = QLabel()
        self.heading.setStyleSheet("font-size: 20px; font-weight: 600;")
        self.heading.setWordWrap(True)
        outer.addWidget(self.heading)
        cols = QHBoxLayout()
        cols.setSpacing(24)
        outer.addLayout(cols)
        outer.addStretch()
        left, right = QVBoxLayout(), QVBoxLayout()
        cols.addLayout(left, 5)
        cols.addLayout(right, 6)

        # ---------------- left: details
        self.f: dict[str, QLineEdit | QPlainTextEdit] = {
            "title": QLineEdit(),
            "client": SuggestEdit("e.g. Deakin University"),
            "role": SuggestEdit("e.g. Editor"),
            "production": SuggestEdit("e.g. ThinkHQ"),
            "agency": SuggestEdit("If you worked through an agency"),
            "platform": SuggestEdit("e.g. TV, YouTube, Social"),
            "deliverables": QLineEdit(placeholderText="e.g. 30s TVC, 15s and 6s cutdowns, 9:16 versions"),
            "year": QLineEdit(placeholderText="YYYY"),
            "description": PlainEdit(placeholderText="A sentence or two about the project (helps Google too)"),
        }
        self.f["year"].setValidator(QRegularExpressionValidator(QRegularExpression(r"\d{0,4}")))
        self.f["year"].setMaximumWidth(80)
        self.f["description"].setMinimumHeight(110)
        self.f["description"].setMaximumHeight(180)
        for k, w in self.f.items():
            w.textChanged.connect(lambda *_args, k=k: self._typed(k))
            w.editingFinished.connect(lambda k=k: self._typed(k, True))

        self.category = QComboBox()
        for c in store.categories:
            self.category.addItem(c["name"], c["id"])
        self.category.activated.connect(self._set_category)
        self.slug = QLineEdit()
        self.slug.editingFinished.connect(self._set_slug)
        self.url_label = QLabel()
        self.url_label.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.url_label.setStyleSheet("color: palette(placeholder-text);")

        form = QFormLayout()
        form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
        form.setLabelAlignment(Qt.AlignRight)
        form.addRow("Title", self.f["title"])
        form.addRow("Category", self.category)
        form.addRow("Client", self.f["client"])
        form.addRow("Role", self.f["role"])
        form.addRow("Production", self.f["production"])
        form.addRow("Agency", self.f["agency"])
        form.addRow("Year", self.f["year"])
        form.addRow("Made for", self.f["platform"])
        form.addRow("Deliverables", self.f["deliverables"])
        form.addRow("Description", self.f["description"])
        detailed_note = QLabel("Agency, Made for, Deliverables and Description show on project pages "
                               "when the live home page set uses the Detailed layout.")
        detailed_note.setWordWrap(True)
        detailed_note.setStyleSheet("color: palette(placeholder-text); font-size: 11px;")
        form.addRow("", detailed_note)
        form.addRow("Page address", self.slug)
        form.addRow("", self.url_label)
        self.home_box = QWidget()
        self.home_lay = QVBoxLayout(self.home_box)
        self.home_lay.setContentsMargins(0, 4, 0, 0)
        self.home_lay.setSpacing(2)
        form.addRow("Home page", self.home_box)
        form_box = QWidget()
        form_box.setLayout(form)
        form_box.setSizePolicy(QSizePolicy.Preferred, QSizePolicy.Maximum)
        left.addWidget(form_box, 0, Qt.AlignTop)
        left.addStretch(1)

        # ---------------- right: video
        right.addWidget(section("Video"))
        grid = QGridLayout()
        grid.setHorizontalSpacing(6)
        grid.setVerticalSpacing(4)
        self.vrow: dict[str, list[QWidget]] = {}
        self.vfield: dict[str, QLineEdit] = {}
        self.vdot: dict[str, QLabel] = {}
        for r, kind in enumerate(core.SOURCES):
            name = QLabel(core.SOURCE_NAMES[kind])
            d = QLabel()
            d.setFixedWidth(12)
            e = QLineEdit(placeholderText=PLACEHOLDERS[kind], clearButtonEnabled=True)
            e.editingFinished.connect(functools.partial(self._set_source, kind))
            ob = QPushButton("Open")
            ob.clicked.connect(functools.partial(self._open_source, kind))
            for c, w in enumerate((name, d, e, ob)):
                grid.addWidget(w, r, c)
            self.vrow[kind] = [name, d, e, ob]
            self.vfield[kind], self.vdot[kind] = e, d
        grid.setColumnStretch(2, 1)
        right.addLayout(grid)
        self.add_backup = link_button("+ Add a backup link (Vimeo, YouTube or Instagram)")
        self.add_backup.clicked.connect(lambda: self._toggle("_show_backups"))
        right.addWidget(self.add_backup)

        self.primary = QComboBox()
        self.primary.setMinimumContentsLength(10)
        self.primary.setSizeAdjustPolicy(QComboBox.AdjustToMinimumContentsLengthWithIcon)
        self.primary.activated.connect(self._set_primary)
        self.primary_row = QWidget()
        pr = QHBoxLayout(self.primary_row)
        pr.setContentsMargins(0, 0, 0, 0)
        pr.addWidget(QLabel("Show first:"))
        pr.addWidget(self.primary)
        pr.addStretch()
        right.addWidget(self.primary_row)
        self.video_state = QLabel()
        self.video_state.setWordWrap(True)
        right.addWidget(self.video_state)
        self.show_stats = QCheckBox("Show view count on the project page")
        self.show_stats.setToolTip("Views (and likes on YouTube) are fetched when the site builds. "
                                   "Needs API keys in GitHub; see app/README.md.")
        self.show_stats.toggled.connect(self._set_stats)
        right.addWidget(self.show_stats)
        self.btn_fetch = QPushButton("Use Video's Title, Year && Thumbnail")
        self.btn_fetch.clicked.connect(self.use_video_details)
        right.addWidget(self.btn_fetch, 0, Qt.AlignLeft)

        # ---------------- right: thumbnail
        right.addWidget(section("Thumbnail"))
        self.thumb = ImageDrop("Drop a thumbnail here\nor click to choose")
        self.thumb.focus_mode = True
        self.thumb.fileChosen.connect(self.set_thumbnail)
        self.thumb.focusChosen.connect(self._set_focus)
        right.addWidget(self.thumb)
        self.focus_hint = QLabel("Click the picture to choose what stays in view when it’s cropped (e.g. a face).")
        self.focus_hint.setWordWrap(True)
        self.focus_hint.setStyleSheet("color: palette(placeholder-text);")
        right.addWidget(self.focus_hint)
        self.crop_title = QLabel("Widest crop on the site")
        self.crop_title.setStyleSheet("color: palette(placeholder-text); font-size: 11px;")
        right.addWidget(self.crop_title)
        self.crop = QLabel()
        self.crop.setAlignment(Qt.AlignLeft)
        right.addWidget(self.crop)
        trow = QHBoxLayout()
        self.thumb_replace = link_button("Replace…")
        self.thumb_replace.clicked.connect(self._pick_thumbnail)
        self.focus_reset = link_button("Reset focus")
        self.focus_reset.clicked.connect(lambda: self._set_focus(50, 50))
        self.thumb_remove = link_button("Remove thumbnail")
        self.thumb_remove.clicked.connect(self._remove_thumbnail)
        for b in (self.thumb_replace, self.focus_reset, self.thumb_remove):
            trow.addWidget(b)
        trow.addStretch()
        right.addLayout(trow)

        # ---------------- right: gallery
        self.add_stills = link_button("+ Add stills (gallery)")
        self.add_stills.clicked.connect(lambda: self._toggle("_show_gallery"))
        right.addWidget(self.add_stills)
        self.gallery_box = QWidget()
        gb = QVBoxLayout(self.gallery_box)
        gb.setContentsMargins(0, 0, 0, 0)
        gb.addWidget(section("Gallery"))
        self.gallery = GalleryList()
        self.gallery.filesDropped.connect(self.add_gallery)
        self.gallery.orderChanged.connect(self._gallery_reordered)
        self.gallery.deletePressed.connect(self._remove_gallery)
        gb.addWidget(self.gallery)
        row = QHBoxLayout()
        b_add = QPushButton("Add Images…")
        b_add.clicked.connect(lambda: self.add_gallery(
            [Path(f) for f in QFileDialog.getOpenFileNames(self, "Add gallery images", "", IMAGE_FILTER)[0]]))
        b_rm = QPushButton("Remove Selected")
        b_rm.clicked.connect(self._remove_gallery)
        row.addWidget(b_add)
        row.addWidget(b_rm)
        row.addStretch()
        gb.addLayout(row)
        hint = QLabel("Drag to reorder · drop files from your computer to add")
        hint.setStyleSheet("color: palette(placeholder-text);")
        gb.addWidget(hint)
        right.addWidget(self.gallery_box)
        right.addStretch()

        store.projectChanged.connect(lambda p: p is self.p and self.load())
        store.homeChanged.connect(self._load_home_sets)
        checker.checked.connect(self._on_checked)

    # ------------------------------------------------------------------ loading
    def set_project(self, p: dict | None):
        self.p = p
        self._show_backups = self._show_gallery = False
        self._gallery_shown = None
        if p is None:
            return
        for k in ("client", "role", "production", "agency", "platform"):
            self.f[k].set_suggestions(self.store.suggestions(k))
        self.load()
        for ref in core.ordered_sources(p):
            self.checker.check(ref)
        self.verticalScrollBar().setValue(0)

    def load(self):
        """Show the current project's data (called again whenever it changes, e.g. on undo)."""
        p = self.p
        if p is None:
            return
        self.heading.setText(p.get("title") or "(untitled)")
        for k, w in self.f.items():
            set_text_quietly(w, str(p.get(k, "")))
        self.category.setCurrentIndex(max(0, self.category.findData(p.get("category"))))
        set_text_quietly(self.slug, p["id"])
        self.url_label.setText("matthewfregnan.com" + self.store.page_path(p))
        sources = core.project_sources(p)
        for kind, e in self.vfield.items():
            set_text_quietly(e, sources[kind].page_url if kind in sources else "")
        self.show_stats.blockSignals(True)
        self.show_stats.setChecked(bool(p.get("showStats")))
        self.show_stats.blockSignals(False)
        self._show_video_state()
        focus = parse_focus(p.get("thumbFocus"))
        self.thumb.show_path(self.store.repo.thumb_path(p), focus)
        has = bool(p.get("thumbnail")) and self.thumb._pix is not None
        for w in (self.thumb_remove, self.thumb_replace, self.focus_hint, self.crop_title, self.crop):
            w.setVisible(has)
        self.focus_reset.setVisible(has and bool(p.get("thumbFocus")))
        if has:
            self.crop.setPixmap(crop_preview(self.thumb._pix, focus, 16 / 5, 420))
        gallery = p.get("gallery", [])
        show_gallery = bool(gallery) or p.get("category") == "colour-grading" or self._show_gallery
        self.gallery_box.setVisible(show_gallery)
        self.add_stills.setVisible(not show_gallery)
        if gallery != self._gallery_shown:
            self._load_gallery(gallery)
        self._load_home_sets()

    def _load_home_sets(self):
        """One checkbox per home page set: tick to feature this project in that set."""
        if self.p is None:
            return
        while self.home_lay.count():
            w = self.home_lay.takeAt(0).widget()
            if w:
                w.deleteLater()
        member = self.store.sets_containing(self.p)
        active = self.store.home.get("active")
        for s in self.store.home.get("sets", []):
            label = s["name"] + ("  (on the site now)" if s["id"] == active else "")
            cb = QCheckBox(label)
            cb.setChecked(s["id"] in member)
            cb.toggled.connect(functools.partial(self._toggle_home_set, s["id"]))
            self.home_lay.addWidget(cb)

    def _toggle_home_set(self, set_id: str, on: bool):
        if self.p is not None:
            self.store.set_in_home_set(self.p, set_id, on)

    def _load_gallery(self, gallery: list[str]):
        self._gallery_shown = list(gallery)
        self.gallery.clear()
        for rel in gallery:
            item = QListWidgetItem(QIcon(str(self.store.repo.gallery_path(rel))), "")
            item.setData(Qt.UserRole, rel)
            item.setToolTip(Path(rel).name)
            self.gallery.addItem(item)

    def _toggle(self, flag: str):
        setattr(self, flag, True)
        self.load()

    # ------------------------------------------------------------------ details
    def _typed(self, key: str, finished: bool = False):
        if self.p is None:
            return
        w = self.f[key]
        text = w.toPlainText() if isinstance(w, QPlainTextEdit) else w.text()
        if finished:
            text = text.strip()
            set_text_quietly(w, text)
        self.store.set_field(self.p, key, text)

    def _set_category(self):
        new = self.category.currentData()
        if self.p is None or new == self.p.get("category"):
            return

        def fn(p):
            p["category"] = new
            p["id"] = core.unique_id(self.store.data, p["id"], new, ignore=p)
        self.store.edit(self.p, "Change Category", fn)

    def _set_slug(self):
        if self.p is None:
            return
        new = core.slugify(self.slug.text())
        if new == self.p["id"]:
            set_text_quietly(self.slug, new)
            return
        new = core.unique_id(self.store.data, new, self.p["category"], ignore=self.p)
        self.store.edit(self.p, "Change Page Address", lambda p: p.__setitem__("id", new))
        self.message.emit("Page address changed. Links to the old address will stop working.")

    # ------------------------------------------------------------------ video
    def _set_source(self, kind: str):
        p = self.p
        if p is None:
            return
        text = self.vfield[kind].text().strip()
        ref = core.parse_video(text, hint=kind)
        if text and not ref:
            self.video_state.setText(f"{dot('bad')} That doesn't look like a {core.SOURCE_NAMES[kind]} link.")
            return
        target = ref.kind if ref else kind   # a YouTube link pasted in the Vimeo box goes to YouTube
        current = core.project_sources(p)
        if (current[target].page_url if target in current else "") == (ref.page_url if ref else ""):
            self.load()
            return
        self.store.edit(p, f"Change {core.SOURCE_NAMES[target]} Link", lambda q: core.set_source(q, target, ref))
        self.load()   # also puts a mis-pasted link back where it belongs
        if ref:
            self.checker.check(ref, force=True)

    def _set_primary(self):
        kind = self.primary.currentData()
        if self.p and kind and kind != core.project_video(self.p).kind:
            self.store.edit(self.p, "Change Main Video", lambda p: p.__setitem__("videoPrimary", kind))

    def _set_stats(self, on: bool):
        if self.p is None:
            return
        self.store.edit(self.p, "Show View Count" if on else "Hide View Count",
                        lambda p: p.__setitem__("showStats", True) if on else p.pop("showStats", None))

    def _open_source(self, kind: str):
        ref = core.project_sources(self.p or {}).get(kind)
        if ref:
            QDesktopServices.openUrl(QUrl(ref.page_url))

    def _on_checked(self, url: str):
        if self.p and any(r.page_url == url for r in core.ordered_sources(self.p)):
            self._show_video_state()

    def _show_video_state(self):
        p = self.p
        sources = core.project_sources(p)
        ordered = core.ordered_sources(p)
        for kind in core.SOURCES:
            visible = kind in sources or self._show_backups or (not sources and kind == core.SOURCES[0])
            for w in self.vrow[kind]:
                w.setVisible(visible)
            ref = sources.get(kind)
            st = self.checker.get(ref)
            self.vrow[kind][3].setEnabled(ref is not None)
            self.vdot[kind].setText(dot(st.ok if st else None) if ref else "")
            self.vdot[kind].setToolTip((st.title or st.message if st else "Checking…") if ref else "")
        first = core.SOURCES[0]
        self.vfield[first].setPlaceholderText(GENERIC if not sources else PLACEHOLDERS[first])
        self.add_backup.setVisible(bool(sources) and not self._show_backups and len(sources) < len(core.SOURCES))

        self.primary.blockSignals(True)
        self.primary.clear()
        for r in ordered:
            self.primary.addItem(core.SOURCE_NAMES[r.kind], r.kind)
        self.primary.blockSignals(False)
        self.primary_row.setVisible(len(ordered) > 1)
        self.show_stats.setVisible(bool(ordered))
        self.btn_fetch.setVisible(bool(ordered))
        self.btn_fetch.setEnabled(any((s := self.checker.get(r)) and s.ok and r.kind != "file" for r in ordered))

        if not ordered:
            self.video_state.setText("No video. The page will show the gallery only." if p.get("gallery") else "")
            return
        names = [core.SOURCE_NAMES[r.kind] for r in ordered]
        first = self.checker.get(ordered[0])
        state = self.checker.state(p)
        if state == "unknown":
            msg = "Checking…"
        elif state == "ok":
            note = first.title if first.ok else first.message
            msg = f"{dot('ok')} {names[0]} plays · {note}"
            if len(names) > 1:
                msg += f"<br>Backup if it stops working: {' → '.join(names[1:])}"
        elif state == "backup":
            msg = (f"{dot('backup')} {names[0]} isn't playing ({first.message.lower()}). "
                   "The site will show the backup instead.")
        else:
            msg = (f"{dot('bad')} Nothing plays: {first.message.lower()}.<br>"
                   "Check the link opens in your browser, or add a backup link.")
        self.video_state.setText(msg)

    def use_video_details(self):
        p = self.p
        ref = next((r for r in core.ordered_sources(p)
                    if r.kind != "file" and (s := self.checker.get(r)) and s.ok), None)
        if not ref:
            return
        st = self.checker.get(ref)
        replace_thumb = not p.get("thumbnail") or QMessageBox.question(
            self, "Replace thumbnail?", "Replace the current thumbnail with the video's poster frame?") == QMessageBox.Yes
        self.message.emit("Fetching video details…")

        def done(path):
            if isinstance(path, Exception):
                path = None
                self.message.emit("Couldn't download the thumbnail.")

            def fn(q):
                if st.title and q.get("title") in ("", "New Project", None):
                    q["title"] = core.tidy_title(st.title)
                if st.upload_date and not q.get("year"):
                    q["year"] = st.upload_date[:4]
                if path:
                    core.import_thumbnail(self.store.repo, q, path)
            self.store.edit(p, "Use Video Details", fn)
            if path:
                shutil.rmtree(path.parent, ignore_errors=True)
            self.message.emit("Updated from the video.")

        if replace_thumb:
            run_async(lambda: download_thumbnail(ref, st), done)
        else:
            done(None)

    # ------------------------------------------------------------------ images
    def set_thumbnail(self, src: Path):
        if self.p is None:
            return
        try:
            def fn(p):
                core.import_thumbnail(self.store.repo, p, src)
                p.pop("thumbFocus", None)   # a new picture starts centred
            self.store.edit(self.p, "Change Thumbnail", fn)
        except Exception as e:
            QMessageBox.critical(self, "Thumbnail", f"Couldn't read that image:\n{e}")
            return
        self.message.emit("Thumbnail saved as WebP.")

    def _pick_thumbnail(self):
        f, _ = QFileDialog.getOpenFileName(self, "Choose thumbnail", "", IMAGE_FILTER)
        if f:
            self.set_thumbnail(Path(f))

    def _set_focus(self, x: float, y: float):
        if self.p is None:
            return
        value = f"{int(x)}% {int(y)}%"
        self.store.edit(self.p, "Set Focus Point",
                        lambda p: p.pop("thumbFocus", None) if value == "50% 50%" else p.__setitem__("thumbFocus", value))

    def _remove_thumbnail(self):
        if self.p and self.p.get("thumbnail"):
            self.store.edit(self.p, "Remove Thumbnail", lambda p: (p.__setitem__("thumbnail", ""), p.pop("thumbFocus", None)))

    def add_gallery(self, files: list[Path]):
        if self.p is None or not files:
            return
        added = []
        self.store.edit(self.p, "Add Stills", lambda p: added.append(core.import_gallery(self.store.repo, p, files)))
        self.message.emit(f"Added {added[0] if added else 0} image(s).")

    def _remove_gallery(self):
        rows = {self.gallery.row(i) for i in self.gallery.selectedItems()}
        if self.p is None or not rows:
            return
        self.store.edit(self.p, "Remove Stills",
                        lambda p: p.__setitem__("gallery", [g for i, g in enumerate(p.get("gallery", [])) if i not in rows]))

    def _gallery_reordered(self):
        order = [self.gallery.item(i).data(Qt.UserRole) for i in range(self.gallery.count())]
        self._gallery_shown = order
        if self.p is not None and order != self.p.get("gallery", []):
            self.store.edit(self.p, "Reorder Stills", lambda p: p.__setitem__("gallery", order))


def download_thumbnail(ref: core.VideoRef, st: core.VideoStatus) -> Path:
    """Download a video's poster frame to a temp file (runs on a worker thread)."""
    tmp = Path(tempfile.mkdtemp()) / "thumb.jpg"
    urls = [st.thumbnail_url]
    if ref.kind == "youtube":
        urls.append(f"https://i.ytimg.com/vi/{ref.id}/hqdefault.jpg")
    for u in urls:
        try:
            return core.download(u, tmp)
        except Exception:
            continue
    raise OSError("couldn't download thumbnail")
