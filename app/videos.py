"""Background video-link checking, remembered between launches."""
from __future__ import annotations

import dataclasses
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PySide6.QtCore import QObject, QTimer, Signal

import core

STALE_AFTER = 24 * 3600  # re-check a link automatically once a day


class VideoChecker(QObject):
    checked = Signal(str)        # page_url whose status just changed
    batchDone = Signal()         # every link from check_all() has an answer
    _result = Signal(str, object)

    def __init__(self, cache_file: Path):
        super().__init__()
        self.cache_file = cache_file
        self.status: dict[str, core.VideoStatus] = {}
        self._inflight: set[str] = set()
        self._batch: set[str] | None = None
        self._pool = ThreadPoolExecutor(max_workers=8)
        self._result.connect(self._on_result)  # queued: results arrive on the UI thread
        self._save_timer = QTimer(self, singleShot=True, interval=1500)
        self._save_timer.timeout.connect(self._save_cache)
        self._load_cache()

    # ------------------------------------------------------------------ cache
    def _load_cache(self):
        try:
            raw = json.loads(self.cache_file.read_text())
            fields = {f.name for f in dataclasses.fields(core.VideoStatus)}
            self.status = {u: core.VideoStatus(**{k: v for k, v in d.items() if k in fields}) for u, d in raw.items()}
        except (OSError, ValueError, TypeError):
            self.status = {}

    def _save_cache(self):
        try:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            self.cache_file.write_text(json.dumps({u: dataclasses.asdict(s) for u, s in self.status.items()}))
        except OSError:
            pass

    # ------------------------------------------------------------------ checking
    def get(self, ref: core.VideoRef | None) -> core.VideoStatus | None:
        return self.status.get(ref.page_url) if ref else None

    def check(self, ref: core.VideoRef, force: bool = False):
        st = self.status.get(ref.page_url)
        fresh = st and time.time() - st.checked_at < STALE_AFTER
        if (fresh and not force) or ref.page_url in self._inflight:
            return
        self._inflight.add(ref.page_url)

        def work():
            res = core.check_video(ref)
            res.checked_at = time.time()
            self._result.emit(ref.page_url, res)

        self._pool.submit(work)

    def check_projects(self, projects: list[dict]):
        """Check any links not checked in the last day (runs quietly at launch)."""
        for p in projects:
            for ref in core.ordered_sources(p):
                self.check(ref)

    def check_all(self, projects: list[dict]):
        refs = {r.page_url: r for p in projects for r in core.ordered_sources(p)}
        self._batch = set(refs)
        for url in refs:
            self.status.pop(url, None)
        for r in refs.values():
            self.check(r, force=True)
        if not refs:
            self._batch = None
            self.batchDone.emit()

    def _on_result(self, url: str, st: core.VideoStatus):
        self._inflight.discard(url)
        # Don't let a network blip overwrite a known answer with "broken"
        if st.ok is False and st.message.startswith("Couldn't reach") and url in self.status:
            st = self.status[url]
        self.status[url] = st
        self._save_timer.start()
        self.checked.emit(url)
        if self._batch is not None:
            self._batch.discard(url)
            if not self._batch:
                self._batch = None
                self.batchDone.emit()

    # ------------------------------------------------------------------ summary
    def state(self, p: dict) -> str | None:
        """ok = first choice plays · backup = site falls back · bad = nothing plays · unknown = not checked."""
        refs = core.ordered_sources(p)
        if not refs:
            return None
        sts = [self.status.get(r.page_url) for r in refs]
        if sts[0] is None:
            return "unknown"
        if sts[0].ok is not False:          # True, or Instagram (can't be checked)
            return "ok"
        if any(s is None or s.ok is not False for s in sts[1:]):
            return "backup"
        return "bad"

    def shutdown(self):
        self._save_cache()
        self._pool.shutdown(wait=False, cancel_futures=True)
