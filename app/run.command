#!/bin/bash
# macOS: double-click to open Portfolio Manager (first run sets things up).
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "First run: installing Portfolio Manager (takes a minute)…"
  python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt || { echo "Setup failed"; read; exit 1; }
fi
exec .venv/bin/python main.py
