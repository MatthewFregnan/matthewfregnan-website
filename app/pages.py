"""The app's pages (left menu): Overview, Projects, Home Page and Storage, plus the live previews.

Previews use the web admin's own preview code (public/admin/js/preview.js and admin.css) in a
built-in browser view, so the desktop app and the web admin show exactly the same thing.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from PySide6.QtCore import QSize, Qt, QUrl, Signal
from PySide6.QtWebEngineCore import QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import (
    QButtonGroup, QFrame, QGridLayout, QHBoxLayout, QLabel, QListWidget, QListWidgetItem, QProgressBar, QPushButton,
    QScrollArea, QSizePolicy, QToolButton, QVBoxLayout, QWidget,
)

import core
from store import Store

LAYOUTS = {"standard": "Standard", "detailed": "Detailed"}
_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="admin.css">
<style>
  html, body {{ margin: 0; background: transparent; overflow-x: hidden; }}
  body {{ padding: 2px; }}
  .preview-frame.phone {{ max-width: 390px; margin: 0 auto; }}
  .pv-scaler {{ border-color: #3a3b41; }}
  .preview-frame.card .pv-tile {{ font-family: Poppins, system-ui, sans-serif; color: #fff; border-radius: 4px; }}
  .preview-frame.card .pv-tile-title {{ padding: 10px; }}
  .preview-frame.card .pv-tile-title b {{ font-size: 14px; }}
  .preview-frame.card .pv-tile-title small {{ font-size: 11px; }}
  .preview-frame.card .pv-tile.v .pv-tile-title b {{ font-size: 12px; }}
</style></head>
<body><div id="out"></div>
<script>
{js}
function h(tag, attrs = {{}}, ...children) {{
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {{}})) {{
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }}
  for (const c of children.flat()) {{
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }}
  return el;
}}
const thumb = p => (p && p.thumbnail ? ROOT + 'images/thumbnails/' + p.thumbnail : '');
const still = path => ROOT + 'images/gallery/' + path;
let ROOT = '';
function pick(p) {{ document.title = 'pick:' + p.category + '/' + p.id + ':' + Date.now(); }}
window.render = (d) => {{
  ROOT = d.root;
  const out = document.getElementById('out');
  const frame = document.createElement('div');
  frame.className = 'preview-frame ' + d.screen;
  if (d.kind === 'home') {{
    frame.append(homePreview(h, {{ set: d.set, projects: d.projects, categories: d.categories, site: d.site,
      thumb, screen: d.screen, seed: d.seed, heroHeight: d.heroHeight || undefined, onPick: d.clickable ? pick : null }}));
  }} else if (d.kind === 'card') {{
    frame.append(cardPreview(h, d.project, thumb));
  }} else {{
    frame.append(projectPreview(h, {{ project: d.project, category: d.category, layout: d.layout, site: d.site,
      thumb, still, screen: d.screen }}));
  }}
  out.replaceChildren(frame);
}};
</script></body></html>"""


def _preview_js(admin_dir: Path) -> str:
    """preview.js as a plain script (pages loaded from disk can't import modules)."""
    js = (admin_dir / "js" / "preview.js").read_text(encoding="utf-8")
    return re.sub(r"^export\s+", "", js, flags=re.M)


class PreviewView(QWebEngineView):
    """Draws a home page or project page preview. Emits `picked(key)` when a project tile is clicked."""
    picked = Signal(str)

    def __init__(self, repo: core.Repo, parent=None):
        super().__init__(parent)
        self.repo = repo
        self._ready = False
        self._pending: dict | None = None
        s = self.settings()
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        s.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, True)
        self.page().setBackgroundColor(Qt.transparent)
        self.setContextMenuPolicy(Qt.NoContextMenu)
        admin = repo.root / "public" / "admin"
        self.loadFinished.connect(self._loaded)
        self.titleChanged.connect(self._title)
        self.setHtml(_PAGE.format(js=_preview_js(admin)), QUrl.fromLocalFile(str(admin) + "/"))

    def _loaded(self, ok: bool):
        self._ready = ok
        if self._pending:
            self.show_data(self._pending)

    def _title(self, title: str):
        m = re.match(r"pick:(.+):\d+$", title or "")
        if m:
            self.picked.emit(m.group(1))

    def show_data(self, data: dict):
        data = {**data, "root": QUrl.fromLocalFile(str(self.repo.root) + "/").toString()}
        self._pending = data
        if self._ready:
            self.page().runJavaScript(f"window.render({json.dumps(data)})")


def site_info(repo: core.Repo) -> dict:
    try:
        site = json.loads((repo.root / "data" / "site.json").read_text(encoding="utf-8"))
    except Exception:
        site = {}
    poster = site.get("heroPoster") or "/images/hero-poster.webp"
    if poster.startswith("/"):
        site["heroPoster"] = QUrl.fromLocalFile(str(repo.root / poster.lstrip("/"))).toString()
    return site


def _segmented(options: list[tuple[str, str]], current: str, on_change: Callable[[str], None]) -> QWidget:
    box = QWidget()
    lay = QHBoxLayout(box)
    lay.setContentsMargins(0, 0, 0, 0)
    lay.setSpacing(0)
    group = QButtonGroup(box)
    for value, label in options:
        b = QToolButton(text=label, checkable=True, checked=value == current)
        b.setToolButtonStyle(Qt.ToolButtonTextOnly)
        b.clicked.connect(lambda _=False, v=value: on_change(v))
        group.addButton(b)
        lay.addWidget(b)
    box.group = group
    return box


# ---------------------------------------------------------------------------- left menu

class Rail(QListWidget):
    """The left menu."""
    def __init__(self, pages: list[tuple[str, str]]):
        super().__init__()
        self.setFixedWidth(118)
        self.setIconSize(QSize(1, 1))
        self.setFrameShape(QFrame.NoFrame)
        self.setStyleSheet("QListWidget { background: palette(window); border-right: 1px solid palette(mid); padding: 8px 6px; }"
                           "QListWidget::item { padding: 9px 8px; border-radius: 7px; margin-bottom: 2px; }"
                           "QListWidget::item:selected { background: palette(highlight); color: palette(highlighted-text); }")
        for key, label in pages:
            item = QListWidgetItem(label)
            item.setData(Qt.UserRole, key)
            self.addItem(item)

    def key(self) -> str:
        item = self.currentItem()
        return item.data(Qt.UserRole) if item else "overview"

    def select(self, key: str):
        for i in range(self.count()):
            if self.item(i).data(Qt.UserRole) == key:
                self.setCurrentRow(i)


# ---------------------------------------------------------------------------- overview

def _card(title: str) -> tuple[QFrame, QVBoxLayout]:
    f = QFrame()
    f.setObjectName("card")
    f.setStyleSheet("#card { border: 1px solid palette(mid); border-radius: 10px; background: palette(base); }")
    lay = QVBoxLayout(f)
    lay.setContentsMargins(16, 14, 16, 14)
    t = QLabel(f"<b style='font-size:14px'>{title}</b>")
    lay.addWidget(t)
    f.title = t
    return f, lay


def _muted(text: str) -> QLabel:
    lab = QLabel(text)
    lab.setWordWrap(True)
    lab.setStyleSheet("color: palette(placeholder-text);")
    return lab


def _ago(iso: str) -> str:
    try:
        t = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)
    except ValueError:
        return ""
    s = (datetime.now(timezone.utc) - t).total_seconds()
    if s < 3600:
        return f"{max(1, round(s / 60))} min ago"
    if s < 86400:
        return f"{round(s / 3600)} h ago"
    t = t.astimezone()
    return f"{t.day} {t:%b %Y}"


class OverviewPage(QScrollArea):
    """What's going on at a glance. `actions` provides: open_project(p), go(page), publish(), check_videos(),
    new_from_link(), changes() -> list[str], storage(callback)."""

    def __init__(self, store: Store, checker, actions):
        super().__init__()
        self.store, self.checker, self.a = store, checker, actions
        self.setWidgetResizable(True)
        self.setFrameShape(QFrame.NoFrame)
        self.mini = PreviewView(store.repo)
        self.mini.setFixedHeight(300)
        self.mini.picked.connect(lambda _k: self.a.go("home"))
        self._storage_text = "Checking…"
        self._storage_pct = None
        self.refresh()

    def set_storage(self, text: str, pct: float | None):
        self._storage_text, self._storage_pct = text, pct
        self.refresh()

    def refresh(self):
        store = self.store
        projects = store.projects
        home = store.home
        live = next((s for s in home.get("sets", []) if s["id"] == home.get("active")), (home.get("sets") or [None])[0])
        layout = (live or {}).get("projectLayout", "standard")
        inner = QWidget()
        outer = QVBoxLayout(inner)
        outer.setContentsMargins(26, 20, 26, 40)
        head = QLabel("<span style='font-size:22px; font-weight:600'>Overview</span>")
        outer.addWidget(head)
        outer.addWidget(_muted(f"{len(projects)} projects on matthewfregnan.com"))
        cols = QHBoxLayout()
        cols.setSpacing(16)
        left, right = QVBoxLayout(), QVBoxLayout()
        left.setSpacing(16)
        right.setSpacing(16)

        # publishing
        changes = self.a.changes()
        card, lay = _card(f"{len(changes)} unpublished change{'s' if len(changes) != 1 else ''}" if changes
                          else "Everything is live")
        if changes:
            lay.addWidget(QLabel("<br>".join(f"• {c}" for c in changes[:6]) + (f"<br>…and {len(changes) - 6} more"
                                                                              if len(changes) > 6 else "")))
        else:
            lay.addWidget(_muted("The site matches what you see here."))
        row = QHBoxLayout()
        if changes:
            b = QPushButton("Publish")
            b.setDefault(True)
            b.clicked.connect(self.a.publish)
            row.addWidget(b)
        b = QPushButton("Edit Projects")
        b.clicked.connect(lambda: self.a.go("projects"))
        row.addWidget(b)
        row.addStretch()
        lay.addLayout(row)
        left.addWidget(card)

        # needs attention
        card, lay = _card("Needs attention")
        issues = []
        live_keys = set((live or {}).get("projects", []))
        for p in projects:
            st = self.checker.state(p)
            if st == "bad":
                issues.append((p, "Video isn't playing"))
            elif st == "backup":
                issues.append((p, "Playing its backup link"))
            if not core.project_video(p) and not p.get("gallery"):
                issues.append((p, "No video or stills"))
            if not p.get("thumbnail"):
                issues.append((p, "No thumbnail"))
            if layout == "detailed" and not p.get("description") and core.project_key(p) in live_keys:
                issues.append((p, "No description (live layout is Detailed)"))
        if issues:
            for p, text in issues[:8]:
                b = QPushButton(f"{p.get('title') or '(untitled)'}  —  {text}")
                b.setFlat(True)
                b.setStyleSheet("text-align: left; padding: 4px 2px;")
                b.clicked.connect(lambda _=False, p=p: self.a.open_project(p))
                lay.addWidget(b)
            if len(issues) > 8:
                lay.addWidget(_muted(f"…and {len(issues) - 8} more"))
        else:
            lay.addWidget(_muted("Nothing to fix. Every video plays."))
        b = QPushButton("Check Videos Now")
        b.clicked.connect(self.a.check_videos)
        r = QHBoxLayout()
        r.addWidget(b)
        r.addStretch()
        lay.addLayout(r)
        left.addWidget(card)

        # view counts to refresh
        stats = core.stats_to_refresh(projects)
        due = [x for x in stats if x[1] >= core.STATS_DUE_DAYS]
        fresh = [x for x in stats if x[1] < core.STATS_DUE_DAYS]
        card, lay = _card(f"View counts to update ({len(due)})" if due else "View counts")
        if not stats:
            lay.addWidget(_muted("No projects show typed views or likes yet. Add them in a project's Video section."))
        else:
            if due:
                lay.addWidget(_muted(f"Over {core.STATS_DUE_DAYS} days old. Open the post, then update the numbers "
                                     "(or mark them as still current)."))
            for group, items in (("due", due), ("fresh", fresh)):
                if group == "fresh" and items:
                    lay.addWidget(_muted(f"Up to date (updated in the last {core.STATS_DUE_DAYS} days):"))
                for p, days in items:
                    r = QHBoxLayout()
                    views = f"{p['statsViews']} views · " if p.get("statsViews") else ""
                    b = QPushButton(f"{p.get('title') or '(untitled)'}   ·   updated {core.ago_text(days)}   ·   {views.rstrip(' ·')}".rstrip(" ·"))
                    b.setFlat(True)
                    b.setStyleSheet("text-align: left; padding: 4px 2px;")
                    b.clicked.connect(lambda _=False, p=p: self.a.open_project(p))
                    r.addWidget(b, 1)
                    if group == "due":
                        ok = QPushButton("Still current")
                        ok.setToolTip("The numbers haven't changed: mark them as checked today")
                        ok.clicked.connect(lambda _=False, p=p: self.store.edit(
                            p, "Mark Stats Checked", lambda q: q.__setitem__("statsUpdated", core.today())))
                        r.addWidget(ok)
                    lay.addLayout(r)
        left.addWidget(card)

        # storage
        card, lay = _card("Video storage")
        lay.addWidget(QLabel(self._storage_text))
        if self._storage_pct is not None:
            bar = QProgressBar()
            bar.setRange(0, 1000)
            bar.setValue(max(5, int(self._storage_pct * 10)))
            bar.setTextVisible(False)
            bar.setFixedHeight(8)
            colour = "#e5484d" if self._storage_pct >= 90 else "#f0a020" if self._storage_pct >= 70 else "#2fb36b"
            bar.setStyleSheet(f"QProgressBar {{ border: none; border-radius: 4px; background: palette(mid); }}"
                              f"QProgressBar::chunk {{ border-radius: 4px; background: {colour}; }}")
            lay.addWidget(bar)
        b = QPushButton("View Storage")
        b.clicked.connect(lambda: self.a.go("storage"))
        r = QHBoxLayout()
        r.addWidget(b)
        r.addStretch()
        lay.addLayout(r)
        left.addWidget(card)
        left.addStretch()

        # home page
        card, lay = _card("Home page")
        if live:
            keys = set(live.get("projects", []))
            chosen = [p for p in projects if core.project_key(p) in keys]
            land = sum(1 for p in chosen if p["category"] != "vertical")
            soc = len(chosen) - land
            fc = int(live.get("featuredCount") or 0)
            lay.addWidget(QLabel(f"<b>{live['name']}</b> is on the site"))
            lay.addWidget(_muted(f"{f'{fc} of {land} landscape' + (', shuffled' if live.get('shuffle') else '') if 0 < fc < land else f'{land} landscape'}"
                                 f" · {soc} social · {LAYOUTS.get(layout, 'Standard')} project pages"))
            self.mini.setParent(None)
            lay.addWidget(self.mini)
            self.mini.show_data({"kind": "home", "set": live, "projects": projects, "categories": store.data["categories"],
                                 "site": site_info(store.repo), "screen": "desktop", "seed": 1, "heroHeight": 300,
                                 "clickable": True})
        b = QPushButton("Edit Home Page")
        b.clicked.connect(lambda: self.a.go("home"))
        r = QHBoxLayout()
        r.addWidget(b)
        r.addStretch()
        lay.addLayout(r)
        right.addWidget(card)

        # projects
        card, lay = _card("Projects")
        grid = QHBoxLayout()
        for c in store.data["categories"]:
            n = sum(1 for p in projects if p["category"] == c["id"])
            b = QPushButton(f"{n}\n{c['name']}")
            b.setMinimumHeight(54)
            b.clicked.connect(lambda _=False, cid=c["id"]: self.a.go("projects", category=cid))
            grid.addWidget(b)
        lay.addLayout(grid)
        recent = sorted((p for p in projects if p.get("updated")), key=lambda p: p["updated"], reverse=True)[:5]
        if recent:
            lay.addWidget(_muted("Recently edited"))
            for p in recent:
                b = QPushButton(f"{p.get('title') or '(untitled)'}   ·   {store.category(p['category'])['name']} · {_ago(p['updated'])}")
                b.setFlat(True)
                b.setStyleSheet("text-align: left; padding: 4px 2px;")
                b.clicked.connect(lambda _=False, p=p: self.a.open_project(p))
                lay.addWidget(b)
        b = QPushButton("New from Link…")
        b.clicked.connect(self.a.new_from_link)
        r = QHBoxLayout()
        r.addWidget(b)
        b2 = QPushButton("New from Video File…")
        b2.clicked.connect(self.a.new_from_file)
        r.addWidget(b2)
        r.addStretch()
        lay.addLayout(r)
        right.addWidget(card)
        right.addStretch()

        cols.addLayout(left, 4)
        cols.addLayout(right, 5)
        outer.addLayout(cols)
        outer.addStretch()
        old = self.takeWidget()
        self.setWidget(inner)
        if old:
            old.deleteLater()


# ---------------------------------------------------------------------------- previews with controls

class HomePreviewPanel(QWidget):
    """Live preview of a home page set, with Laptop/Phone and Shuffle Again."""
    picked = Signal(str)

    def __init__(self, store: Store):
        super().__init__()
        self.store = store
        self.set_id: str | None = None
        self.screen = "desktop"
        self.seed = 1
        self.title = QLabel()
        self.view = PreviewView(store.repo)
        self.view.picked.connect(self.picked)
        self.view.setMinimumWidth(380)
        self.screens = _segmented([("desktop", "Laptop"), ("phone", "Phone")], self.screen, self._screen)
        self.shuffle = QPushButton("⤮ Shuffle Again")
        self.shuffle.setToolTip("Show another random mix, like a new visitor would see")
        self.shuffle.clicked.connect(self._reshuffle)
        bar = QHBoxLayout()
        bar.addWidget(self.title)
        bar.addStretch()
        bar.addWidget(self.screens)
        bar.addWidget(self.shuffle)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addLayout(bar)
        lay.addWidget(self.view, 1)
        lay.addWidget(_muted("Click a project in the preview to edit it. Changes show here straight away; "
                             "they go live when you Publish."))
        store.homeChanged.connect(self.refresh)
        store.listChanged.connect(self.refresh)

    def _screen(self, v):
        self.screen = v
        self.refresh()

    def _reshuffle(self):
        self.seed += 1
        self.refresh()

    def show_set(self, set_id: str | None):
        self.set_id = set_id
        self.refresh()

    def refresh(self):
        s = self.store.home_set(self.set_id) if self.set_id else None
        if not s:
            return
        live = s["id"] == self.store.home.get("active")
        self.title.setText("<b>Preview · on the site now</b>" if live else "<b>Preview</b>")
        self.shuffle.setVisible(bool(s.get("shuffle") and s.get("featuredCount")))
        self.view.show_data({"kind": "home", "set": s, "projects": self.store.projects,
                             "categories": self.store.data["categories"], "site": site_info(self.store.repo),
                             "screen": self.screen, "seed": self.seed, "clickable": True})


class ProjectPreviewPanel(QWidget):
    """Page Preview tab for a project: the page as it will look, and its tile."""

    def __init__(self, store: Store):
        super().__init__()
        self.store = store
        self.p: dict | None = None
        self.screen = "desktop"
        self.layout_override: str | None = None
        self.view = PreviewView(store.repo)
        self.card = PreviewView(store.repo)
        self.card.setFixedWidth(250)
        self.card.setFixedHeight(160)
        self.bar = QHBoxLayout()
        self.screens = _segmented([("desktop", "Laptop"), ("phone", "Phone")], self.screen, self._screen)
        self.layouts_box = QWidget()
        self.layouts_lay = QHBoxLayout(self.layouts_box)
        self.layouts_lay.setContentsMargins(0, 0, 0, 0)
        self.open_live = QPushButton("Open Live Page")
        self.open_live.clicked.connect(self._open_live)
        self.bar.addWidget(self.screens)
        self.bar.addWidget(self.layouts_box)
        self.bar.addWidget(self.open_live)
        self.bar.addStretch()
        self.side = QVBoxLayout()
        self.side_text = QLabel()
        self.side_text.setWordWrap(True)
        self.side_text.setAlignment(Qt.AlignTop)
        self.side.addWidget(QLabel("<b>In lists</b>"))
        self.side.addWidget(self.card)
        self.side.addWidget(self.side_text)
        self.side.addStretch()
        body = QHBoxLayout()
        body.addWidget(self.view, 1)
        sw = QWidget()
        sw.setLayout(self.side)
        sw.setFixedWidth(260)
        body.addWidget(sw)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 4, 0, 0)
        lay.addLayout(self.bar)
        lay.addLayout(body, 1)
        store.projectChanged.connect(lambda p: p is self.p and self.refresh())
        store.homeChanged.connect(self.refresh)

    def _open_live(self):
        from PySide6.QtGui import QDesktopServices
        if self.p:
            QDesktopServices.openUrl(QUrl("https://matthewfregnan.com" + self.store.page_path(self.p)))

    def _screen(self, v):
        self.screen = v
        self.refresh()

    def _layout(self, v):
        self.layout_override = None if v == self._live_layout() else v
        self.refresh()

    def _live_layout(self) -> str:
        home = self.store.home
        live = next((s for s in home.get("sets", []) if s["id"] == home.get("active")), None)
        return (live or {}).get("projectLayout", "standard")

    def set_project(self, p: dict | None):
        self.p = p
        if self.isVisible():
            self.refresh()

    def showEvent(self, e):
        super().showEvent(e)
        self.refresh()

    def refresh(self):
        p = self.p
        if not p or not self.isVisible():
            return
        live_layout = self._live_layout()
        layout = self.layout_override or live_layout
        old = self.layouts_box.layout().takeAt(0)
        while old:
            if old.widget():
                old.widget().deleteLater()
            old = self.layouts_box.layout().takeAt(0)
        self.layouts_lay.addWidget(_segmented(
            [(k, f"{v} (live)" if k == live_layout else v) for k, v in LAYOUTS.items()], layout, self._layout))
        cat = self.store.category(p["category"])
        site = site_info(self.store.repo)
        self.view.show_data({"kind": "project", "project": p, "category": cat, "layout": layout, "site": site,
                             "screen": self.screen})
        vertical = p["category"] == "vertical"
        self.card.setFixedSize(150 if vertical else 250, 272 if vertical else 145)
        self.card.show_data({"kind": "card", "project": p, "screen": "card"})
        sets = [s for s in self.store.home.get("sets", []) if core.project_key(p) in s.get("projects", [])]
        notes = [f"How it looks on the {cat['name']} page{' and the home page' if sets else ''}.", "",
                 "<b>Home page</b>",
                 ("In " + ", ".join(f"“{s['name']}”" + (" (live)" if s["id"] == self.store.home.get("active") else "")
                                    for s in sets) + ".") if sets else "Not in any home page set."]
        if not p.get("thumbnail"):
            notes += ["", "<span style='color:#f0a020'>No thumbnail yet: lists show a frame from the video.</span>"]
        if layout == "detailed" and not p.get("description"):
            notes += ["", "<span style='color:#f0a020'>No description: the Detailed layout looks best with a sentence or two.</span>"]
        self.side_text.setText("<br>".join(notes))


# ---------------------------------------------------------------------------- traffic

_TRAFFIC_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="admin.css">
<style>
  html, body {{ margin: 0; background: transparent; }}
  body {{ padding: 2px 4px 24px; font: 13px -apple-system, system-ui, sans-serif; }}
  a {{ color: var(--accent); }}
</style></head>
<body><div id="out" class="muted">Loading visits…</div>
<script>
{js}
function h(tag, attrs = {{}}, ...children) {{
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {{}})) {{
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }}
  for (const c of children.flat()) {{
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }}
  return el;
}}
window.render = (d) => {{
  const out = document.getElementById('out');
  if (d.error) {{ out.textContent = d.error; return; }}
  const titles = d.titles;
  const sum = summarise(d.rows, d.days);
  out.className = '';
  out.replaceChildren(renderTraffic(h, sum, {{
    titleOf: p => titles[p] || p,
    onPath: p => {{ document.title = 'open:' + p + ':' + Date.now(); }},
  }}));
}};
</script></body></html>"""


def stats_rows(repo: core.Repo, days: int) -> list:
    """Anonymous page views from the stats database (via Wrangler, signed in once on this computer)."""
    import os
    import shutil
    import subprocess
    import sys
    import time
    from tasks import tool_paths
    npx = shutil.which("npx", path=tool_paths())
    if not npx:
        raise RuntimeError("Couldn't find Node.js (npx) on this computer.")
    since = int((time.time() - days * 86400) * 1000)
    sql = ("SELECT ts, visit, seq, path, source, country, device, secs FROM views "
           f"WHERE ts >= {since} ORDER BY ts LIMIT 200000")
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    r = subprocess.run([npx, "-y", "wrangler@3", "d1", "execute", "matthewfregnan-stats", "--remote", "--json",
                        "--command", sql], capture_output=True, text=True, timeout=180,
                       cwd=str(repo.root / "upload-worker"), env={**os.environ, "PATH": tool_paths()},
                       creationflags=flags)
    out = r.stdout.strip()
    start = out.find("[")
    if r.returncode != 0 or start < 0:
        if re.search(r"not (be )?(logged|authenticated)|login", r.stdout + r.stderr, re.I):
            raise RuntimeError("Wrangler isn't signed in to Cloudflare on this computer.\n"
                               "In Terminal, run:  npx wrangler@3 login   then try again.")
        raise RuntimeError("Couldn't read the visit stats from Cloudflare.")
    results = json.loads(out[start:])[0].get("results", [])
    return [[x["ts"], x["visit"], x["seq"], x["path"], x["source"], x["country"], x["device"], x["secs"]]
            for x in results]


class TrafficPage(QWidget):
    """Visitors per day, most viewed pages, where visitors came from and their paths through the site."""
    open_path = Signal(str)

    def __init__(self, store: Store):
        super().__init__()
        self.store = store
        self.days = 30
        self.cache: dict[int, tuple[float, list]] = {}
        self.view = QWebEngineView()
        self.view.page().setBackgroundColor(Qt.transparent)
        self.view.setContextMenuPolicy(Qt.NoContextMenu)
        self._ready = False
        self._pending = None
        admin = store.repo.root / "public" / "admin"
        js = re.sub(r"^export\s+", "", (admin / "js" / "traffic.js").read_text(encoding="utf-8"), flags=re.M)
        self.view.loadFinished.connect(self._loaded)
        self.view.titleChanged.connect(self._title)
        self.view.setHtml(_TRAFFIC_PAGE.format(js=js), QUrl.fromLocalFile(str(admin) + "/"))
        head = QLabel("<span style='font-size:22px; font-weight:600'>Traffic</span>")
        sub = _muted("Who's looking at your site: visitors per day, what they watch, where they came from and how "
                     "they move around. Anonymous: no cookies, no IP addresses.")
        self.ranges = _segmented([("7", "Last 7 days"), ("30", "30 days"), ("90", "90 days"), ("365", "Year")],
                                 "30", lambda v: self.load(int(v)))
        refresh = QPushButton("Refresh")
        refresh.clicked.connect(lambda: self.load(self.days, force=True))
        bar = QHBoxLayout()
        bar.addWidget(self.ranges)
        bar.addWidget(refresh)
        bar.addStretch()
        lay = QVBoxLayout(self)
        lay.setContentsMargins(22, 18, 22, 8)
        lay.addWidget(head)
        lay.addWidget(sub)
        lay.addLayout(bar)
        lay.addWidget(self.view, 1)

    def _loaded(self, ok: bool):
        self._ready = ok
        if self._pending:
            self._send(self._pending)

    def _title(self, title: str):
        m = re.match(r"open:(.+):\d+$", title or "")
        if m:
            self.open_path.emit(m.group(1))

    def _send(self, data: dict):
        self._pending = data
        if self._ready:
            self.view.page().runJavaScript(f"window.render({json.dumps(data)})")

    def titles(self) -> dict:
        t = {"/": "Home", "/about/": "About", "/contact/": "Contact", "/my-work/": "All work"}
        for c in self.store.data["categories"]:
            t[f"/{c['slug']}/"] = f"{c['name']} (section)"
        for p in self.store.projects:
            t[self.store.page_path(p)] = p.get("title") or p["id"]
        return t

    def load(self, days: int, force: bool = False):
        import time
        from widgets import run_async
        self.days = days
        cached = self.cache.get(days)
        if cached and not force and time.time() - cached[0] < 300:
            self._send({"days": days, "rows": cached[1], "titles": self.titles()})
            return
        self.view.page().runJavaScript("document.getElementById('out').className='muted';"
                                       "document.getElementById('out').textContent='Loading visits…'")

        def done(res):
            if isinstance(res, Exception):
                self._send({"error": str(res)})
                return
            self.cache[days] = (time.time(), res)
            self._send({"days": days, "rows": res, "titles": self.titles()})
        run_async(lambda: stats_rows(self.store.repo, days), done)
