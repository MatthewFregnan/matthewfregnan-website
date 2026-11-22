"""Portfolio Manager: a desktop editor for matthewfregnan.com's project data.

Run:  python app/main.py   (or double-click app/run.command on Mac, app/run.bat on Windows)

Code map:
  core.py     data files, images, video-link parsing/checking (no UI)
  store.py    the open data, undo/redo and autosave
  videos.py   background link checking, remembered between launches
  sidebar.py  project list (search, filter, drag to reorder)
  editor.py   the project editor panel
  tasks.py    preview (npm) and publish (git)
  window.py   main window tying it together
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PySide6.QtCore import QSettings, Qt  # noqa: E402
from PySide6.QtWidgets import QApplication, QFileDialog, QMessageBox, QStyleFactory  # noqa: E402

import core  # noqa: E402
from window import APP_NAME, MainWindow  # noqa: E402


def locate_repo() -> core.Repo | None:
    settings = QSettings()
    starts = [Path(__file__).resolve().parent, Path.cwd()]
    if settings.value("repo"):
        starts.append(Path(str(settings.value("repo"))))
    for start in starts:
        root = core.find_repo(start)
        if root:
            settings.setValue("repo", str(root))
            return core.Repo(root)
    QMessageBox.information(None, APP_NAME, "Choose your website folder (the one containing data/projects.json).")
    folder = QFileDialog.getExistingDirectory(None, "Choose website folder")
    root = core.find_repo(Path(folder)) if folder else None
    if root:
        settings.setValue("repo", str(root))
        return core.Repo(root)
    return None


def main() -> int:
    QApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("Matthew Fregnan")
    if sys.platform == "win32":
        # Native Windows 11 look (follows light/dark mode) where available
        app.setStyle(QStyleFactory.create("windows11") or QStyleFactory.create("Fusion"))
    repo = locate_repo()
    if not repo:
        return 1
    win = MainWindow(repo)
    win.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
