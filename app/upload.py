"""Upload a video file to the site's video storage (Cloudflare R2 at videos.matthewfregnan.com).

Any source works (ProRes/4K masters, phone or Instagram downloads): files that are already
web-ready 1080p H.264 MP4s are just tidied for instant start; anything else is converted
with the same settings used for the rest of the site's videos. Then it's uploaded with
Wrangler, which this Mac is already signed in to (`npx wrangler@3 login`).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Callable

import core
from tasks import tool_paths

BUCKET = "matthewfregnan-videos"
UPLOAD_LIMIT = 290 * 1024 * 1024   # Wrangler uploads single files up to ~300 MB
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mxf", ".mkv", ".webm", ".avi"}


class UploadError(Exception):
    pass


def _env() -> dict:
    return {**os.environ, "PATH": tool_paths()}


def _which(name: str) -> str:
    found = shutil.which(name, path=tool_paths())
    if not found:
        hint = {"ffmpeg": "Install it with:  brew install ffmpeg",
                "ffprobe": "Install it with:  brew install ffmpeg",
                "npx": "Install Node.js from nodejs.org"}.get(name, "")
        raise UploadError(f"Couldn't find {name} on this computer. {hint}")
    return found


def _run(args: list[str], **kw) -> subprocess.CompletedProcess:
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    return subprocess.run(args, capture_output=True, text=True, env=_env(), creationflags=flags, **kw)


def probe(path: Path) -> dict:
    """Basic facts about a video file."""
    r = _run([_which("ffprobe"), "-v", "error", "-show_entries",
              "stream=codec_type,codec_name,width,height,pix_fmt:format=duration",
              "-of", "json", str(path)])
    if r.returncode != 0:
        raise UploadError("That file doesn't look like a video ffmpeg can read.")
    j = json.loads(r.stdout)
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in j.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not v:
        raise UploadError("That file has no video in it.")
    return {"vcodec": v.get("codec_name"), "width": int(v.get("width") or 0), "height": int(v.get("height") or 0),
            "pix_fmt": v.get("pix_fmt"), "acodec": a.get("codec_name") if a else None,
            "duration": float(j.get("format", {}).get("duration") or 0)}


def is_web_ready(info: dict) -> bool:
    """Already a 1080p-or-smaller H.264 MP4 with AAC (or no) audio: no need to re-encode."""
    return (info["vcodec"] == "h264" and info["pix_fmt"] in ("yuv420p", None)
            and max(info["width"], info["height"]) <= 1920 and min(info["width"], info["height"]) <= 1080
            and info["acodec"] in ("aac", None))


def _ffmpeg(args: list[str], duration: float, progress: Callable[[str], None], label: str):
    """Run ffmpeg, reporting percentage progress."""
    cmd = [_which("ffmpeg"), "-v", "error", "-y", "-progress", "pipe:1", "-nostats", *args]
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=_env(),
                            creationflags=flags)
    last = -1
    for line in proc.stdout:
        m = re.match(r"out_time_us=(\d+)", line.strip())
        if m and duration > 0:
            pct = min(99, int(int(m.group(1)) / 1e6 / duration * 100))
            if pct != last and pct % 5 == 0:
                last = pct
                progress(f"{label}… {pct}%")
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise UploadError(f"ffmpeg couldn't process the video:\n{err[-400:]}")


def prepare(src: Path, workdir: Path, progress: Callable[[str], None]) -> Path:
    """Make a web-ready copy of `src` in `workdir`."""
    info = probe(src)
    out = workdir / "upload.mp4"
    if is_web_ready(info):
        progress("Already web-ready: tidying it so it starts playing instantly…")
        _ffmpeg(["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart",
                 str(out)], info["duration"], progress, "Tidying")
    else:
        size = f"{info['width']}×{info['height']} {info['vcodec']}"
        progress(f"Converting {size} to a 1080p web video (this can take a while for long or 4K files)…")
        scale = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))':flags=lanczos"
        _ffmpeg(["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-vf", scale, "-c:v", "libx264",
                 "-preset", "slow", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M", "-profile:v", "high",
                 "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)],
                info["duration"], progress, "Converting")
    if out.stat().st_size > UPLOAD_LIMIT:
        progress(f"That came out at {out.stat().st_size / 1e6:.0f} MB, over the upload limit: making a smaller copy…")
        smaller = workdir / "upload-small.mp4"
        _ffmpeg(["-i", str(out), "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-maxrate", "6M",
                 "-bufsize", "12M", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", str(smaller)],
                info["duration"], progress, "Shrinking")
        out = smaller
        if out.stat().st_size > UPLOAD_LIMIT:
            raise UploadError("The video is still over 300 MB after compressing. Try exporting a shorter or "
                              "lower-bitrate version.")
    return out


def upload(file: Path, key: str, progress: Callable[[str], None]) -> str:
    """Upload to R2 and return the public address (with a version tag so caches show the new file)."""
    progress(f"Uploading {file.stat().st_size / 1e6:.0f} MB to videos.matthewfregnan.com…")
    r = _run([_which("npx"), "-y", "wrangler@3", "r2", "object", "put", f"{BUCKET}/{key}", "--file", str(file),
              "--content-type", "video/mp4", "--cache-control", "public, max-age=86400"], timeout=3600)
    out = r.stdout + r.stderr
    if r.returncode != 0 or "Upload complete" not in out:
        if re.search(r"not (be )?(logged|authenticated)|login|auth", out, re.I):
            raise UploadError("Wrangler isn't signed in to Cloudflare on this computer.\n"
                              "In Terminal, run:  npx wrangler@3 login   then try again.")
        tail = "\n".join(line for line in out.splitlines() if line.strip() and "WARNING" not in line)[-400:]
        raise UploadError(f"The upload failed:\n{tail}")
    return f"{core.VIDEO_HOST}/{key}?v={int(time.time())}"


def upload_video(project: dict, src: Path, progress: Callable[[str], None]) -> str:
    """Prepare and upload `src` for `project`; returns the new video address."""
    if src.suffix.lower() not in VIDEO_EXTS:
        raise UploadError("Choose a video file (MP4, MOV, M4V, MXF…).")
    with tempfile.TemporaryDirectory(prefix="portfolio-upload-") as tmp:
        ready = prepare(src, Path(tmp), progress)
        url = upload(ready, f"{project['category']}/{project['id']}.mp4", progress)
    progress("Done.")
    return url
