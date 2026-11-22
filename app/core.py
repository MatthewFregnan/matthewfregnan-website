"""Data, image and video helpers for the Portfolio Manager app (no UI code here)."""
from __future__ import annotations

import copy
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

THUMB_MAX = 1280      # longest side of a thumbnail, px
GALLERY_MAX = 1920    # longest side of a gallery still, px
WEBP_QUALITY = 82
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif", ".heic"}

FIELDS = ["title", "client", "role", "production", "year", "description"]


# --------------------------------------------------------------------------- repo

def find_repo(start: Path) -> Path | None:
    """Walk up from `start` looking for the website repo (has data/projects.json)."""
    for p in [start, *start.parents]:
        if (p / "data" / "projects.json").is_file():
            return p
    return None


class Repo:
    def __init__(self, root: Path):
        self.root = root
        self.projects_json = root / "data" / "projects.json"
        self.thumbs_dir = root / "images" / "thumbnails"
        self.gallery_dir = root / "images" / "gallery"

    def load(self) -> dict:
        with open(self.projects_json, encoding="utf-8") as f:
            return json.load(f)

    def save(self, data: dict) -> None:
        tmp = self.projects_json.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        tmp.replace(self.projects_json)  # atomic: never leaves a half-written file

    def thumb_path(self, project: dict) -> Path | None:
        t = project.get("thumbnail")
        if not t:
            return None
        # The web admin saves site paths like "/images/thumbnails/uploads/x.webp"
        return self.root / t.lstrip("/") if t.startswith("/") else self.thumbs_dir / t

    def gallery_path(self, rel: str) -> Path:
        return self.root / rel.lstrip("/") if rel.startswith("/") else self.gallery_dir / rel


# --------------------------------------------------------------------------- projects

def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return re.sub(r"-{2,}", "-", s) or "untitled"


def unique_id(data: dict, base: str, category: str, ignore: dict | None = None) -> str:
    taken = {p["id"] for p in data["projects"] if p.get("category") == category and p is not ignore}
    cand, n = base, 2
    while cand in taken:
        cand, n = f"{base}-{n}", n + 1
    return cand


def touch(project: dict) -> None:
    project["updated"] = datetime.now().isoformat(timespec="seconds")


def snapshot(data: dict) -> dict:
    return copy.deepcopy(data)


def tidy_title(title: str) -> str:
    """Make upload filenames like 'KIA_SHIPYARD_9x16_MASTER_v03' read like a title."""
    t = re.sub(r"\.(mp4|mov|mxf)$", "", title.strip(), flags=re.I)
    if "_" in t and " " not in t:
        t = t.replace("_", " ")
    t = re.sub(r"\b(\d+x\d+|master|clean|final|v\d+|r\d+|\d+s(ec)?)\b", "", t, flags=re.I)
    t = re.sub(r"\b[A-Z]?\d{5,}\b", "", t)                      # job numbers like E002291
    t = re.sub(r"\s{2,}", " ", t).strip(" -_")
    if t.isupper():  # SHOUTY → Title Case, but keep short words like KIA / VCE as acronyms
        t = " ".join(w if len(w) <= 3 and w.isalpha() and w not in ("THE", "AND", "FOR", "WITH") else w.capitalize()
                     for w in t.split(" "))
        t = re.sub(r"\b(And|For|The|With|Of|In|On|To)\b", lambda m: m.group(1).lower(), t)
        t = t[:1].upper() + t[1:]
    return t


# --------------------------------------------------------------------------- images

def _open_image(src: Path) -> Image.Image:
    im = ImageOps.exif_transpose(Image.open(src))
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    return im.convert("RGBA" if has_alpha else "RGB")


def save_webp(src: Path, dest: Path, max_side: int) -> Path:
    dest = dest.with_suffix(".webp")
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = _open_image(src)
    im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
    return dest


def import_thumbnail(repo: Repo, project: dict, src: Path) -> None:
    rel = Path(project["category"]) / f"{project['id']}.webp"
    old = repo.thumb_path(project)
    save_webp(src, repo.thumbs_dir / rel, THUMB_MAX)
    if old and old.exists() and old != repo.thumbs_dir / rel:
        old.unlink()
    project["thumbnail"] = rel.as_posix()


def import_gallery(repo: Repo, project: dict, files: list[Path]) -> int:
    gallery = project.setdefault("gallery", [])
    folder = repo.gallery_dir / project["id"]
    used = {int(m.group(1)) for g in gallery if (m := re.search(r"-(\d+)\.\w+$", g))}
    n, added = max(used, default=0), 0
    for f in files:
        if f.suffix.lower() not in IMAGE_EXTS:
            continue
        n += 1
        out = save_webp(f, folder / f"{project['id']}-{n}", GALLERY_MAX)
        gallery.append(out.relative_to(repo.gallery_dir).as_posix())
        added += 1
    return added


# --------------------------------------------------------------------------- video

SOURCES = ["vimeo", "youtube", "instagram"]          # default fallback order
SOURCE_NAMES = {"vimeo": "Vimeo", "youtube": "YouTube", "instagram": "Instagram"}


@dataclass
class VideoRef:
    kind: str          # "vimeo" | "youtube" | "instagram"
    id: str
    hash: str = ""     # Vimeo unlisted-link hash

    @property
    def page_url(self) -> str:
        if self.kind == "vimeo":
            return f"https://vimeo.com/{self.id}" + (f"/{self.hash}" if self.hash else "")
        if self.kind == "instagram":
            return f"https://www.instagram.com/p/{self.id}/"
        return f"https://www.youtube.com/watch?v={self.id}"


def parse_video(text: str, hint: str | None = None) -> VideoRef | None:
    """Accept a Vimeo, YouTube or Instagram URL (incl. unlisted Vimeo links), or a bare ID.

    `hint` is the field the text was typed into; it decides what a bare ID means.
    """
    t = text.strip()
    if not t:
        return None
    if "/" not in t and "." not in t:
        if re.fullmatch(r"\d{5,}", t):
            return VideoRef("vimeo", t)
        if hint == "instagram" and re.fullmatch(r"[\w-]{5,}", t):
            return VideoRef("instagram", t)
        if re.fullmatch(r"[\w-]{11}", t):
            return VideoRef("youtube", t)
        return None
    u = urllib.parse.urlparse(t if "://" in t else "https://" + t)
    host = u.netloc.lower()
    q = urllib.parse.parse_qs(u.query)
    parts = [p for p in u.path.split("/") if p]
    if "vimeo.com" in host:
        for i, p in enumerate(parts):
            if p.isdigit():
                h = q.get("h", [""])[0]
                if not h and i + 1 < len(parts) and re.fullmatch(r"[0-9a-f]{6,}", parts[i + 1]):
                    h = parts[i + 1]
                return VideoRef("vimeo", p, h)
    if "youtu.be" in host and parts:
        return VideoRef("youtube", parts[0])
    if "youtube.com" in host:
        if "v" in q:
            return VideoRef("youtube", q["v"][0])
        m = re.search(r"/(?:embed|shorts|live)/([\w-]{11})", u.path)
        if m:
            return VideoRef("youtube", m.group(1))
    if "instagram.com" in host or "instagr.am" in host:
        for i, p in enumerate(parts[:-1]):
            if p in ("p", "reel", "reels", "tv"):
                return VideoRef("instagram", parts[i + 1])
    return None


def project_sources(project: dict) -> dict[str, VideoRef]:
    out = {}
    for kind, key in (("vimeo", "vimeoId"), ("youtube", "youtubeId"), ("instagram", "instagramId")):
        value = str(project.get(key) or "").strip()
        if not value:
            continue
        # The web admin lets you paste a whole link into these fields
        ref = parse_video(value, hint=kind) if ("/" in value or "." in value) else VideoRef(kind, value)
        if ref and ref.kind == kind:
            if kind == "vimeo" and not ref.hash:
                ref.hash = project.get("vimeoHash", "")
            out[kind] = ref
    return out


def ordered_sources(project: dict) -> list[VideoRef]:
    """The chosen source first, then the others as backups (same order the website uses)."""
    src = project_sources(project)
    order = sorted(src, key=lambda k: (k != project.get("videoPrimary"), SOURCES.index(k)))
    return [src[k] for k in order]


def project_video(project: dict) -> VideoRef | None:
    s = ordered_sources(project)
    return s[0] if s else None


def set_source(project: dict, kind: str, ref: VideoRef | None) -> None:
    keys = {"vimeo": ("vimeoId", "vimeoHash"), "youtube": ("youtubeId",), "instagram": ("instagramId",)}[kind]
    for k in keys:
        project.pop(k, None)
    if ref:
        project[keys[0]] = ref.id
        if ref.hash:
            project["vimeoHash"] = ref.hash
    if project.get("videoPrimary") not in project_sources(project):
        project.pop("videoPrimary", None)


@dataclass
class VideoStatus:
    ok: bool | None    # None = can't be checked automatically
    message: str
    title: str = ""
    thumbnail_url: str = ""
    upload_date: str = ""   # Vimeo only, "YYYY-MM-DD ..."
    width: int = 0
    height: int = 0
    checked_at: float = 0.0


def check_video(ref: VideoRef, timeout: float = 12) -> VideoStatus:
    """Ask the provider's public oEmbed endpoint whether the video can be embedded."""
    if ref.kind == "instagram":
        # Instagram's public embed page answers "OK" even for posts that don't exist,
        # and its oEmbed API needs a Meta developer token, so it can't be verified here.
        return VideoStatus(None, "Instagram links can't be checked automatically. Open it to make sure the post is public.")
    if ref.kind == "vimeo":
        api = "https://vimeo.com/api/oembed.json?url=" + urllib.parse.quote(ref.page_url, safe="")
    else:
        api = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(ref.page_url, safe="")
    req = urllib.request.Request(api, headers={"User-Agent": "PortfolioManager/2.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404):
            return VideoStatus(False, "Can't be embedded: it's private, deleted, or embedding is turned off")
        return VideoStatus(False, f"{SOURCE_NAMES[ref.kind]} returned an error ({e.code})")
    except Exception as e:  # network down etc.
        return VideoStatus(False, f"Couldn't reach {SOURCE_NAMES[ref.kind]}: {e}")
    thumb = j.get("thumbnail_url", "")
    if ref.kind == "vimeo":
        thumb = re.sub(r"-d_\d+(x\d+)?", "-d_1920", thumb)
    else:
        thumb = f"https://i.ytimg.com/vi/{ref.id}/maxresdefault.jpg"
    return VideoStatus(True, "Embeds OK", j.get("title", ""), thumb, j.get("upload_date", "") or "",
                       int(j.get("width") or 0), int(j.get("height") or 0))


def download(url: str, dest: Path, timeout: float = 20) -> Path:
    req = urllib.request.Request(url, headers={"User-Agent": "PortfolioManager/2.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dest.write_bytes(r.read())
    return dest
