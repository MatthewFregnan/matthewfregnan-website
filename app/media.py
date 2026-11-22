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
    line = Signal(str)


class UploadDialog(QDialog):
    """Shows progress while a video is prepared and uploaded (the work runs in the background)."""

    def __init__(self, parent, title: str, work, on_done):
        super().__init__(parent)
        from upload import UploadError
        self.setWindowTitle(f"Upload video · {title}")
        self.resize(560, 300)
        self.log = QPlainTextEdit(readOnly=True)
        self.bar = QProgressBar()
        self.bar.setRange(0, 0)  # busy
        self.buttons = QDialogButtonBox(QDialogButtonBox.Close)
        self.buttons.button(QDialogButtonBox.Close).setEnabled(False)
        self.buttons.rejected.connect(self.reject)
        lay = QVBoxLayout(self)
        lay.addWidget(self.log)
        lay.addWidget(self.bar)
        lay.addWidget(self.buttons)
        relay = _Relay(self)
        relay.line.connect(self._line)

        def finished(result):
            self.bar.setRange(0, 1)
            self.bar.setValue(1)
            self.buttons.button(QDialogButtonBox.Close).setEnabled(True)
            if isinstance(result, Exception):
                msg = str(result) if isinstance(result, UploadError) else f"Something went wrong: {result}"
                self._line(f"\n✗ {msg}")
                return
            self._line("\n✓ Uploaded and linked to this project. Publish to put it live.")
            on_done(result)

        run_async(lambda: work(relay.line.emit), finished)

    def _line(self, text: str):
        lines = self.log.toPlainText().splitlines()
        # Progress updates replace the previous line of the same step instead of piling up
        if lines and text.split("…")[0] == lines[-1].split("…")[0] and "%" in text:
            lines[-1] = text
            self.log.setPlainText("\n".join(lines))
        else:
            self.log.appendPlainText(text)
        self.log.verticalScrollBar().setValue(self.log.verticalScrollBar().maximum())

    def reject(self):
        if self.buttons.button(QDialogButtonBox.Close).isEnabled():
            super().reject()
