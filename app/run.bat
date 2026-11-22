@echo off
rem Windows: double-click to open Portfolio Manager (first run sets things up).
cd /d "%~dp0"
if not exist .venv\Scripts\pythonw.exe (
  echo First run: installing Portfolio Manager...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\pip install -q -r requirements.txt
)
start "" .venv\Scripts\pythonw.exe main.py
