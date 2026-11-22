"""Video playback widgets: the editor's preview player, the frame picker, and the upload window."""
from __future__ import annotations

import tempfile
from pathlib import Path

from PySide6.QtCore import QObject, Qt, QUrl, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QDialog, QDialogButtonBox, QHBoxLayout, QLabel, QPlainTextEdit, QProgressBar, QPushButton, QSlider,
    QStackedLayout, QVBoxLayout, QWidget,
)

import core
from widgets import run_async


def _fmt(ms: int, frames: bool = False) -> str:
    s = max(0, ms) / 1000
    m, sec = divmod(s, 60)
    return f"{int(m)}:{sec:05.2f}" if frames else f"{int(m)}:{int(sec):02d}"


class _Transport(QWidget):
    """Play/pause + scrub bar + time, driving a QMediaPlayer."""

    def __init__(self, player: QMediaPlayer, precise: bool = False):
        super().__init__()
        self.player, self.precise = player, precise
        self.play = QPushButton("▶")
        self.play.setFixedWidth(40)
        self.play.clicked.connect(self.toggle)
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(0, 0)
        self.slider.sliderMoved.connect(self.player.setPosition)
        self.slider.sliderPressed.connect(self.player.pause)
        self.time = QLabel("0:00 / 0:00")
        self.time.setMinimumWidth(120 if precise else 90)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 4, 0, 0)
        lay.addWidget(self.play)
        lay.addWidget(self.slider, 1)
        lay.addWidget(self.time)
        player.durationChanged.connect(lambda d: (self.slider.setRange(0, d), self._show()))
        player.positionChanged.connect(self._pos)
        player.playbackStateChanged.connect(
            lambda st: self.play.setText("❚❚" if st == QMediaPlayer.PlayingState else "▶"))

    def toggle(self):
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def _pos(self, ms: int):
        if not self.slider.isSliderDown():
            self.slider.setValue(ms)
        self._show()

    def _show(self):
        self.time.setText(f"{_fmt(self.player.position(), self.precise)} / {_fmt(self.player.duration())}")


class VideoPreview(QWidget):
    """Inline player for a hosted video file; a message for platform links (they open in the browser).
    Dropping a video file on it asks to upload that file (fileDropped)."""
    fileDropped = Signal(Path)

    def __init__(self):
        super().__init__()
        self.setAcceptDrops(True)
        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.player.setAudioOutput(self.audio)
        self.video = QVideoWidget()
        self.video.setStyleSheet("background: black;")
        self.player.setVideoOutput(self.video)
        self.transport = _Transport(self.player)
        self.message = QLabel()
        self.message.setAlignment(Qt.AlignCenter)
        self.message.setWordWrap(True)
        self.message.setStyleSheet("background: black; color: #aaa; padding: 16px;")
        self.stack = QStackedLayout()
        self.stack.addWidget(self.video)
        self.stack.addWidget(self.message)
        frame = QWidget()
        frame.setAttribute(Qt.WA_StyledBackground, True)
        frame.setStyleSheet("background: black;")
        frame.setLayout(self.stack)
        self.frame = frame
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(frame)
        lay.addWidget(self.transport)
        self._url = None
        self.set_vertical(False)

    def set_vertical(self, vertical: bool):
        w = max(240, self.width() or 480)
        self.frame.setFixedHeight(min(420, int(w * 16 / 9)) if vertical else int(min(w, 640) * 9 / 16))

    def resizeEvent(self, e):
        super().resizeEvent(e)
        self.set_vertical(getattr(self, "_vertical", False))

    def show_file(self, url: str, vertical: bool):
        self._vertical = vertical
        self.set_vertical(vertical)
        if url != self._url:
            self._url = url
            self.player.stop()
            self.player.setSource(QUrl(url))
        self.stack.setCurrentWidget(self.video)
        self.transport.setVisible(True)

    def show_message(self, text: str):
        self._vertical = False
        self.set_vertical(False)
        self._url = None
        self.player.stop()
        self.player.setSource(QUrl())
        self.message.setText(text)
        self.stack.setCurrentWidget(self.message)
        self.transport.setVisible(False)

    def stop(self):
        self.player.pause()

    def dragEnterEvent(self, e):
        if any(Path(u.toLocalFile()).suffix.lower() in (".mp4", ".mov", ".m4v", ".mxf", ".mkv", ".webm", ".avi")
               for u in e.mimeData().urls() if u.isLocalFile()):
            e.acceptProposedAction()

    def dropEvent(self, e):
        files = [Path(u.toLocalFile()) for u in e.mimeData().urls() if u.isLocalFile()]
        if files:
            self.fileDropped.emit(files[0])


class FramePicker(QDialog):
    """Scrub a hosted video and grab frames as the thumbnail or gallery stills."""
    FRAME_MS = 40   # 25 fps

    def __init__(self, parent, title: str, url: str, on_thumbnail, on_still):
        super().__init__(parent)
        self.setWindowTitle(f"Pick from video · {title}")
        self.resize(900, 640)
        self.on_thumbnail, self.on_still = on_thumbnail, on_still
        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.audio.setMuted(True)
        self.player.setAudioOutput(self.audio)
        self.video = QVideoWidget()
        self.video.setStyleSheet("background: black;")
        self.video.setMinimumHeight(380)
        self.player.setVideoOutput(self.video)
        self.frame = None
        self.video.videoSink().videoFrameChanged.connect(self._frame)
        self.transport = _Transport(self.player, precise=True)
        steps = QHBoxLayout()
        for label, ms in (("−1s", -1000), ("‹ frame", -self.FRAME_MS), ("frame ›", self.FRAME_MS), ("+1s", 1000)):
            b = QPushButton(label)
            b.clicked.connect(lambda _=False, d=ms: self._step(d))
            steps.addWidget(b)
        steps.addStretch()
        self.status = QLabel(" ")
        self.status.setWordWrap(True)
        self.strip = QHBoxLayout()
        self.strip.addStretch()
        bb = QDialogButtonBox()
        b_still = bb.addButton("Add to Stills", QDialogButtonBox.ActionRole)
        b_thumb = bb.addButton("Use as Thumbnail", QDialogButtonBox.ActionRole)
        b_done = bb.addButton("Done", QDialogButtonBox.AcceptRole)
        b_still.clicked.connect(self._still)
        b_thumb.clicked.connect(self._thumb)
        b_done.clicked.connect(self.accept)
        lay = QVBoxLayout(self)
        lay.addWidget(self.video, 1)
        lay.addWidget(self.transport)
        lay.addLayout(steps)
        lay.addWidget(self.status)
        lay.addLayout(self.strip)
        lay.addWidget(bb)
        self.player.setSource(QUrl(url))
        self.player.mediaStatusChanged.connect(self._status)

    def _status(self, st):
        if st == QMediaPlayer.LoadedMedia and not getattr(self, "_primed", False):
            self._primed = True    # only once: seeking reports "loaded" again
            self.player.play()
            self.player.pause()   # show the first frame
        elif st == QMediaPlayer.InvalidMedia:
            self.status.setText("Couldn't load the video.")

    def _frame(self, frame):
        if frame.isValid():
            self.frame = frame

    def _step(self, ms: int):
        self.player.pause()
        self.player.setPosition(max(0, min(self.player.duration(), self.player.position() + ms)))

    def _grab(self) -> Path | None:
        if self.frame is None or not self.frame.isValid():
            self.status.setText("The video hasn’t shown a frame yet.")
            return None
        self.player.pause()
        img = self.frame.toImage()
        path = Path(tempfile.mkdtemp(prefix="portfolio-frame-")) / "frame.png"
        img.save(str(path))
        return path

    def _thumb(self):
        path = self._grab()
        if path:
            self.on_thumbnail(path)
            self.status.setText(f"Thumbnail set from {_fmt(self.player.position(), True)}.")

    def _still(self):
        path = self._grab()
        if path:
            self.on_still(path)
            thumb = QLabel()
            thumb.setPixmap(QPixmap(str(path)).scaledToHeight(54, Qt.SmoothTransformation))
            self.strip.insertWidget(self.strip.count() - 1, thumb)
            self.status.setText(f"Added a still from {_fmt(self.player.position(), True)}. Keep going, or press Done.")

    def done(self, r):
        self.player.stop()
        super().done(r)


class _Relay(QObject):
    line = Signal(object, str)   # job, text  (emitted from the worker thread; delivered on the UI thread)


class UploadJob:
    def __init__(self, project: dict, src: Path):
        self.key = core.project_key(project)          # how to find the project again when it finishes
        self.snapshot = dict(project)                  # category/id used for the storage address
        self.title = project.get("title") or "(untitled)"
        self.src = src
        self.state = "queued"                          # queued · running · done · failed
        self.status = "Waiting…"
        self.log: list[str] = []


class UploadManager(QObject):
    """Runs video uploads one at a time in the background, so the app stays usable."""
    changed = Signal()
    finished = Signal(object, object)   # job, url (str) or Exception

    def __init__(self, parent=None):
        super().__init__(parent)
        self.jobs: list[UploadJob] = []
        self._relay = _Relay(self)
        self._relay.line.connect(self._on_line)

    # ------------------------------------------------------------------ queue
    def enqueue(self, project: dict, src: Path) -> UploadJob:
        job = UploadJob(project, src)
        self.jobs.append(job)
        self.changed.emit()
        self._next()
        return job

    def active(self) -> list[UploadJob]:
        return [j for j in self.jobs if j.state in ("queued", "running")]

    def job_for(self, key: str) -> UploadJob | None:
        return next((j for j in self.jobs if j.key == key and j.state in ("queued", "running")), None)

    def _next(self):
        if any(j.state == "running" for j in self.jobs):
            return
        job = next((j for j in self.jobs if j.state == "queued"), None)
        if not job:
            return
        job.state = "running"
        job.status = "Starting…"
        self.changed.emit()
        from upload import upload_video
        run_async(lambda: upload_video(job.snapshot, job.src, lambda text: self._relay.line.emit(job, text)),
                  lambda result: self._done(job, result))

    def _on_line(self, job: UploadJob, text: str):
        job.status = text
        if job.log and "%" in text and text.split("…")[0] == job.log[-1].split("…")[0]:
            job.log[-1] = text    # update the same progress line rather than piling them up
        else:
            job.log.append(text)
        self.changed.emit()

    def _done(self, job: UploadJob, result):
        from upload import UploadError
        if isinstance(result, Exception):
            job.state = "failed"
            job.status = str(result) if isinstance(result, UploadError) else f"Something went wrong: {result}"
            job.log.append(f"✗ {job.status}")
        else:
            job.state = "done"
            job.status = "Uploaded"
            job.log.append("✓ Uploaded and linked. Publish to put it live.")
        self.changed.emit()
        self.finished.emit(job, result)
        self._next()


class UploadStatus(QWidget):
    """Status-bar summary of uploads, with a Details window."""

    def __init__(self, manager: UploadManager, parent=None):
        super().__init__(parent)
        self.manager = manager
        self.label = QLabel()
        self.bar = QProgressBar()
        self.bar.setRange(0, 0)
        self.bar.setFixedWidth(90)
        self.bar.setMaximumHeight(12)
        self.details = QPushButton("Details")
        self.details.setFlat(True)
        self.details.clicked.connect(self.show_details)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 6, 0)
        lay.addWidget(self.bar)
        lay.addWidget(self.label)
        lay.addWidget(self.details)
        self._dlg = None
        manager.changed.connect(self.refresh)
        self.refresh()

    def refresh(self):
        running = next((j for j in self.manager.jobs if j.state == "running"), None)
        queued = sum(1 for j in self.manager.jobs if j.state == "queued")
        self.setVisible(bool(self.manager.jobs))
        self.bar.setVisible(running is not None)
        if running:
            more = f" (+{queued} waiting)" if queued else ""
            self.label.setText(f"Uploading “{running.title}”: {running.status}{more}")
        elif self.manager.jobs:
            last = self.manager.jobs[-1]
            self.label.setText(f"Upload {'finished' if last.state == 'done' else 'failed'}: “{last.title}”")
        if self._dlg and self._dlg.isVisible():
            self._fill()

    def show_details(self):
        if not self._dlg:
            self._dlg = QDialog(self.window())
            self._dlg.setWindowTitle("Uploads")
            self._dlg.resize(560, 360)
            self._log = QPlainTextEdit(readOnly=True)
            bb = QDialogButtonBox(QDialogButtonBox.Close)
            bb.rejected.connect(self._dlg.close)
            lay = QVBoxLayout(self._dlg)
            lay.addWidget(self._log)
            lay.addWidget(bb)
        self._fill()
        self._dlg.show()
        self._dlg.raise_()

    def _fill(self):
        icons = {"queued": "…", "running": "▶", "done": "✓", "failed": "✗"}
        parts = []
        for j in self.manager.jobs:
            parts.append(f"{icons[j.state]} {j.title}  ({j.src.name})")
            parts += [f"    {line}" for line in j.log]
        self._log.setPlainText("\n".join(parts))
        self._log.verticalScrollBar().setValue(self._log.verticalScrollBar().maximum())
