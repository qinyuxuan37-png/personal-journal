"""Local-only server for the public profile and private journal."""

from __future__ import annotations

import argparse
import io
import json
import math
import mimetypes
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import uuid
import webbrowser
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
PORT = 8765
KINDS = {
    "public": {"tech", "projects", "games", "anime", "music", "gallery"},
    "private": {"photos", "notes", "skills", "goals", "diary", "quotes"},
}
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
IMAGE_NAME = re.compile(r"^[a-f0-9]{32}\.(?:jpg|png|webp|gif)$")
MAX_IMAGE = 12 * 1024 * 1024
MAX_JSON = 1024 * 1024
MAX_BACKUP = 2 * 1024 * 1024 * 1024
DATA = ROOT / "data"
WALLPAPER_ROOT: Path | None = None
WALLPAPER_URL = ""
SITE_ORIGIN = ""
DEFAULT_WALLPAPER_ROOT: Path | None = None
CUSTOM_WALLPAPER_ROOT: Path | None = None
CUSTOM_WALLPAPER_CONFIG = ROOT / "wallpaper.custom.json"
WALLPAPER_HOSTS = {}
USE_PINNED_WALLPAPERS = False
WALLPAPER_TYPES = {
    ".html", ".js", ".mjs", ".css", ".json", ".wasm",
    ".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".avif",
    ".woff", ".woff2", ".ttf", ".otf", ".glb", ".gltf", ".bin",
    ".mp3", ".ogg", ".wav", ".webm", ".mp4",
    ".pkg", ".tex", ".vert", ".frag", ".glsl",
    ".skel", ".atlas",
}
MAX_WALLPAPER_ASSET = 128 * 1024 * 1024


def wallpaper_metadata(root: Path) -> dict:
    target = (root / "project.json").resolve()
    try:
        if not target.is_relative_to(root) or target.stat().st_size > MAX_JSON:
            return {}
        value = json.loads(target.read_text(encoding="utf-8-sig"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def wallpaper_entry(root: Path) -> tuple[str, Path | None]:
    meta = wallpaper_metadata(root)
    kind = str(meta.get("type", "web")).lower()
    entry = meta.get("file", "index.html")
    if not isinstance(entry, str):
        return "unsupported", None
    target = (root / entry).resolve()
    if not target.is_relative_to(root):
        return "unsupported", None
    if kind == "web" and target.suffix.lower() == ".html" and target.is_file():
        return "html", target
    package = (root / "scene.pkg").resolve()
    if kind == "scene" and package.is_relative_to(root) and package.is_file():
        return "scene", package
    return "unsupported", None


def wallpaper_library_root() -> Path | None:
    # Read only the Steam Workshop directory already configured by the owner.
    default = DEFAULT_WALLPAPER_ROOT or configured_wallpaper()
    if default and default.parent.name == "431960":
        return default.parent.resolve()
    return None


def wallpaper_library_item(item_id: str) -> Path:
    base = wallpaper_library_root()
    if not base or not isinstance(item_id, str) or not re.fullmatch(r"[0-9]{1,20}", item_id):
        raise ValueError("壁纸不在已配置的 Steam 下载目录中")
    root = (base / item_id).resolve()
    if root.parent != base or not root.is_dir():
        raise ValueError("壁纸文件夹已移动或删除，请刷新列表")
    return root


def wallpaper_preview(root: Path) -> Path | None:
    name = wallpaper_metadata(root).get("preview", "preview.jpg")
    if not isinstance(name, str):
        return None
    target = (root / name).resolve()
    if (target.is_relative_to(root) and target.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp"}
            and target.is_file() and target.stat().st_size <= 12 * 1024 * 1024):
        return target
    return None


def wallpaper_library() -> dict:
    base = wallpaper_library_root()
    subscriptions = wallpaper_subscriptions(base)
    items = []
    if base and base.is_dir():
        for folder in sorted(base.iterdir(), key=lambda p: p.name):
            try:
                root = wallpaper_library_item(folder.name)
                meta = wallpaper_metadata(root)
                if not meta:
                    continue
                kind, entry = wallpaper_entry(root)
                supported = bool(entry and entry.stat().st_size <= MAX_WALLPAPER_ASSET)
                items.append({
                    "id": folder.name, "title": str(meta.get("title") or folder.name)[:200],
                    "kind": kind, "supported": supported, "selected": root == WALLPAPER_ROOT,
                    "subscription": ("unknown" if subscriptions is None else "subscribed" if folder.name in subscriptions else "retained"),
                    "compatibility": "pending" if supported else "unsupported",
                    "preview": f"/api/wallpaper/library/{folder.name}/preview" if wallpaper_preview(root) else "",
                })
            except (OSError, ValueError):
                continue
    return {"items": items, "configured": bool(base)}


def wallpaper_subscriptions(base: Path | None) -> set[str] | None:
    """ACF details retain subscribed items; Installed can include unsubscribed leftovers."""
    if base is None:
        return None
    try:
        text = (base.parent.parent / "appworkshop_431960.acf").read_text(encoding="utf-8")
        tokens = re.findall(r'"((?:\\.|[^"\\])*)"|([{}])', text)
        stack = [{}]
        key = None
        for string, brace in tokens:
            if brace == "{":
                if key is None:
                    return None
                child = {}
                stack[-1][key] = child
                stack.append(child)
                key = None
            elif brace == "}":
                if len(stack) == 1 or key is not None:
                    return None
                stack.pop()
            elif key is None:
                key = string
            else:
                stack[-1][key] = string
                key = None
        if len(stack) != 1 or key is not None:
            return None
        details = stack[0]["AppWorkshop"]["WorkshopItemDetails"]
        return {key for key, value in details.items() if isinstance(value, dict) and value.get("subscribedby")}
    except (OSError, KeyError, AttributeError, TypeError):
        return None


def pinned_wallpaper_url(root: Path) -> str:
    # One immutable origin per directory: trying another wallpaper must never
    # redirect the currently visible wallpaper's lazy asset requests.
    if root not in WALLPAPER_HOSTS:
        if len(WALLPAPER_HOSTS) >= 24:
            raise ValueError("本次已预览 24 个目录，请重启网站后继续")
        host = ThreadingHTTPServer(("127.0.0.1", 0), WallpaperHandler)
        host.wallpaper_root = root
        thread = threading.Thread(target=host.serve_forever, daemon=True)
        thread.start()
        WALLPAPER_HOSTS[root] = (host, thread)
    return f"http://127.0.0.1:{WALLPAPER_HOSTS[root][0].server_port}"


def close_wallpaper_hosts() -> None:
    for host, thread in WALLPAPER_HOSTS.values():
        host.shutdown()
        host.server_close()
        thread.join(timeout=2)
    WALLPAPER_HOSTS.clear()


def configured_wallpaper() -> Path | None:
    config = ROOT / "wallpaper.local.json"
    if not config.is_file():
        return None
    try:
        path = Path(json.loads(config.read_text(encoding="utf-8"))["path"]).resolve()
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return path if (path / "index.html").is_file() and (path / "src" / "app.js").is_file() else None


def validate_custom_wallpaper(raw: str) -> Path:
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 4096:
        raise ValueError("请选择壁纸文件夹")
    candidate = Path(raw.strip().strip('"')).expanduser()
    try:
        path = candidate.resolve(strict=True)
    except OSError as error:
        raise ValueError("找不到这个文件夹") from error
    if path.is_file() and (path.suffix.lower() == ".html" or path.name.lower() in {"project.json", "scene.pkg"}):
        path = path.parent
    kind, entry = wallpaper_entry(path)
    if not path.is_dir() or kind == "unsupported" or not entry:
        raise ValueError("请选择网页壁纸（index.html）或场景壁纸（project.json 和 scene.pkg）文件夹；暂不支持其他类型")
    if path == ROOT or path.is_relative_to(ROOT) or ROOT.is_relative_to(path):
        raise ValueError("不能把网站项目或其上级目录作为壁纸")
    if path == DATA or path.is_relative_to(DATA) or DATA.is_relative_to(path):
        raise ValueError("不能把记录数据目录或其上级目录作为壁纸")
    if path == Path.home() or path == Path(path.anchor):
        raise ValueError("请选择具体的壁纸文件夹，而不是整个磁盘或用户目录")
    if entry.stat().st_size > MAX_WALLPAPER_ASSET:
        raise ValueError("壁纸入口文件过大")
    return path


def configured_custom_wallpaper() -> Path | None:
    if not CUSTOM_WALLPAPER_CONFIG.is_file():
        return None
    try:
        return validate_custom_wallpaper(
            json.loads(CUSTOM_WALLPAPER_CONFIG.read_text(encoding="utf-8"))["path"]
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def wallpaper_info() -> dict:
    root = WALLPAPER_ROOT
    return {
        "available": bool(root and WALLPAPER_URL),
        "url": (pinned_wallpaper_url(root) if USE_PINNED_WALLPAPERS and WALLPAPER_URL else WALLPAPER_URL) if root else "",
        "name": str(wallpaper_metadata(root).get("title") or root.name)[:200] if root else "",
        "custom": bool(CUSTOM_WALLPAPER_ROOT),
        "kind": "koi" if root and root == DEFAULT_WALLPAPER_ROOT else wallpaper_entry(root)[0] if root else "html",
        "id": root.name if root else "",
    }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def db_path(scope: str) -> Path:
    return DATA / f"{scope}.sqlite3"


def media_dir(scope: str) -> Path:
    return DATA / "media" / scope


def connect(scope: str) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path(scope))
    connection.row_factory = sqlite3.Row
    return connection


def initialize() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for scope in KINDS:
        media_dir(scope).mkdir(parents=True, exist_ok=True)
        with closing(connect(scope)) as db, db:
            db.execute(
                """
                CREATE TABLE IF NOT EXISTS entries (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    sort_order INTEGER
                )
                """
            )
            columns = {row["name"] for row in db.execute("PRAGMA table_info(entries)")}
            if "sort_order" not in columns:
                db.execute("ALTER TABLE entries ADD COLUMN sort_order INTEGER")
            if scope == "public":
                for kind in KINDS[scope]:
                    rows = db.execute(
                        "SELECT id, sort_order FROM entries WHERE kind = ? "
                        "ORDER BY sort_order IS NULL, sort_order, updated_at DESC, id DESC",
                        (kind,),
                    ).fetchall()
                    for index, row in enumerate(rows):
                        if row["sort_order"] != index:
                            db.execute(
                                "UPDATE entries SET sort_order = ? WHERE id = ?",
                                (index, row["id"]),
                            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS entries_kind_updated ON entries(kind, updated_at DESC)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )


def read_snapshot(scope: str) -> dict:
    with closing(connect(scope)) as db:
        settings = {
            row["key"]: json.loads(row["value"])
            for row in db.execute("SELECT key, value FROM settings")
        }
        entries = {kind: [] for kind in sorted(KINDS[scope])}
        ordering = (
            "kind, sort_order, id" if scope == "public" else "updated_at DESC, id DESC"
        )
        for row in db.execute(
            "SELECT id, kind, data, created_at, updated_at FROM entries ORDER BY " + ordering
        ):
            if row["kind"] in entries:
                entries[row["kind"]].append(
                    {
                        "id": row["id"],
                        "kind": row["kind"],
                        "data": json.loads(row["data"]),
                        "created_at": row["created_at"],
                        "updated_at": row["updated_at"],
                    }
                )
    return {"settings": settings, "entries": entries}


def valid_image(data: bytes, media_type: str) -> bool:
    if media_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if media_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/webp":
        return data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    if media_type == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    return False


def validate_data(scope: str, kind: str, value: object) -> dict:
    if kind not in KINDS[scope]:
        raise ValueError("不支持这个内容栏目")
    if not isinstance(value, dict):
        raise ValueError("内容格式不正确")
    clean = {}
    for key, item in value.items():
        if not isinstance(key, str) or len(key) > 60:
            raise ValueError("字段名称不正确")
        if not isinstance(item, str) or len(item) > 30000:
            raise ValueError("内容过长或格式不正确")
        clean[key] = item.strip()
    image = clean.get("image", "")
    if image and not IMAGE_NAME.fullmatch(image):
        raise ValueError("图片引用不正确")
    if kind == "gallery" and (not image or not (media_dir("public") / image).is_file()):
        raise ValueError("请先为展示照片集上传图片；私人照片不会自动用于公开展示")
    return clean


def remove_unused_image(scope: str, image: str) -> None:
    if not IMAGE_NAME.fullmatch(image):
        return
    with closing(connect(scope)) as db:
        for row in db.execute("SELECT data FROM entries"):
            if json.loads(row["data"]).get("image") == image:
                return
        for row in db.execute("SELECT value FROM settings"):
            if json.loads(row["value"]).get("avatar") == image:
                return
    (media_dir(scope) / image).unlink(missing_ok=True)


def make_backup(output=None) -> bytes | None:
    in_memory = output is None
    if in_memory:
        output = io.BytesIO()
    with tempfile.TemporaryDirectory() as temp:
        snapshot_db = Path(temp) / "private.sqlite3"
        with closing(connect("private")) as source, closing(
            sqlite3.connect(snapshot_db)
        ) as target:
            source.backup(target)
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps({"version": 1, "created_at": now_iso()}, ensure_ascii=False),
            )
            archive.write(snapshot_db, "private.sqlite3")
            for image in media_dir("private").iterdir():
                if image.is_file() and IMAGE_NAME.fullmatch(image.name):
                    archive.write(image, f"media/{image.name}")
    return output.getvalue() if in_memory else None


def validate_layout(value: dict) -> dict:
    minimums = {"profile": (9, 7), "clock": (6, 4)}
    if set(value) != {"version", "items"} or type(value["version"]) is not int or value["version"] not in {1, 2}:
        raise ValueError("布局版本不正确")
    if value["version"] == 1:
        minimums.update({"tech": (5, 3), "projects": (5, 3), "interests": (5, 3)})
    items = value["items"]
    if not isinstance(items, dict) or set(items) != set(minimums):
        raise ValueError("布局模块不完整")
    checked = []
    for key, (min_w, min_h) in minimums.items():
        box = items[key]
        if not isinstance(box, dict) or set(box) != {"x", "y", "w", "h"} or any(type(n) is not int for n in box.values()):
            raise ValueError("布局坐标需要为整数")
        x, y, w, h = (box[name] for name in ("x", "y", "w", "h"))
        if x < 0 or y < 0 or w < min_w or h < min_h or x + w > 24 or y + h > 16:
            raise ValueError("模块超出画布或尺寸过小")
        if any(x < b[0] + b[2] and x + w > b[0] and y < b[1] + b[3] and y + h > b[1] for b in checked):
            raise ValueError("模块不能互相重叠")
        checked.append((x, y, w, h))
    return {"version": 2, "items": {key: dict(items[key]) for key in ("profile", "clock")}}


def make_public_export(output=None) -> bytes | None:
    in_memory = output is None
    snapshot = read_snapshot("public")
    html = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
    html = html.replace('<html lang="zh-CN">', '<html lang="zh-CN" data-export="true">', 1)
    html = html.replace('href="/public/', 'href="./public/')
    html = html.replace('src="/public/', 'src="./public/')
    html = html.replace(
        '<script src="./public/app.js" defer></script>',
        '<script src="./public-data.js" defer></script>\n  '
        '<script src="./public/app.js" defer></script>',
    )
    html = html.replace("PERSONAL WEBSITE · 本地原型", "PERSONAL WEBSITE")
    html = re.sub(r'<a [^>]*data-local-only[^>]*>.*?</a>', '', html, flags=re.DOTALL)
    html = re.sub(
        r'<!-- local-wallpaper:start -->.*?<!-- local-wallpaper:end -->',
        '', html, flags=re.DOTALL,
    )
    html = re.sub(r'<!-- local-editor:start -->.*?<!-- local-editor:end -->', '', html, flags=re.DOTALL)
    public_data = "window.PUBLIC_EXPORT_SNAPSHOT = " + json.dumps(
        snapshot, ensure_ascii=True, separators=(",", ":")
    ) + ";\n"
    images = set()
    profile = snapshot["settings"].get("profile", {})
    if IMAGE_NAME.fullmatch(profile.get("avatar", "")):
        images.add(profile["avatar"])
    for entries in snapshot["entries"].values():
        for entry in entries:
            image = entry["data"].get("image", "")
            if IMAGE_NAME.fullmatch(image):
                images.add(image)
    if in_memory:
        output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "README.txt",
            "公开主页离线包\n\n解压后打开 index.html 即可预览。"
            "此包只包含公开资料和公开图片，不包含私人记录。"
            "分享或发布前，请逐项检查页面内容。\n",
        )
        archive.writestr("index.html", html)
        archive.writestr("public-data.js", public_data)
        for name in ("style.css", "theme.css", "layout.css", "layout-model.js", "layout.js", "app.js", "motion.js", "home-pages.js", "home-pages.css", "photo-album.js", "photo-album.css", "music-wall.js", "music-wall.css", "work-showcase.js", "work-showcase.css", "favicon.svg",
                     "offline-map.css", "offline-map-model.js", "offline-map.js", "offline-map-worker.js", "offline-map-data.js", "map-sources.md", "weather-model.js", "weather.js"):
            archive.write(ROOT / "public" / name, f"public/{name}")
        for name in sorted(images):
            image = media_dir("public") / name
            if image.is_file():
                archive.write(image, f"media/public/{name}")
    return output.getvalue() if in_memory else None


def restore_backup(raw: bytes) -> None:
    with tempfile.TemporaryDirectory() as temp:
        stage = Path(temp)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = set(archive.namelist())
            if "manifest.json" not in names or "private.sqlite3" not in names:
                raise ValueError("备份缺少必要文件")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("version") != 1:
                raise ValueError("不支持这个备份版本")
            for name in names:
                if name in {"manifest.json", "private.sqlite3"}:
                    continue
                if not name.startswith("media/") or not IMAGE_NAME.fullmatch(name[6:]):
                    raise ValueError("备份包含不允许的文件")
            candidate_db = stage / "private.sqlite3"
            candidate_db.write_bytes(archive.read("private.sqlite3"))
            candidate_media = stage / "media"
            candidate_media.mkdir()
            for name in names:
                if name.startswith("media/"):
                    with archive.open(name) as source, (candidate_media / name[6:]).open(
                        "wb"
                    ) as target:
                        shutil.copyfileobj(source, target)
        with closing(sqlite3.connect(candidate_db)) as candidate:
            check = candidate.execute("PRAGMA quick_check").fetchone()[0]
            tables = {
                row[0]
                for row in candidate.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            if check != "ok" or not {"entries", "settings"}.issubset(tables):
                raise ValueError("备份数据库未通过校验")
            columns = {
                row[1] for row in candidate.execute("PRAGMA table_info(entries)")
            }
            if not {"id", "kind", "data", "created_at", "updated_at"}.issubset(columns):
                raise ValueError("备份数据库缺少必要字段")
            if "sort_order" not in columns:
                candidate.execute("ALTER TABLE entries ADD COLUMN sort_order INTEGER")
                candidate.commit()
        rollback = DATA / "pre-restore-backups"
        rollback.mkdir(exist_ok=True)
        backup_name = datetime.now().strftime("%Y%m%d-%H%M%S")
        with (rollback / f"private-{backup_name}.zip").open("wb") as backup:
            make_backup(backup)
        old_media = media_dir("private")
        parked_media = stage / "old-media"
        shutil.move(str(old_media), str(parked_media))
        try:
            shutil.move(str(candidate_media), str(old_media))
            os.replace(candidate_db, db_path("private"))
        except Exception:
            if old_media.exists():
                shutil.rmtree(old_media)
            shutil.move(str(parked_media), str(old_media))
            raise


class FileResponseMixin:
    """Bound each file transfer's Python buffer; never cache journal media."""

    def send_file(self, path: Path, media_type: str, *, revalidate: bool = False) -> None:
        with path.open("rb") as source:
            info = os.fstat(source.fileno())
            etag = f'W/"{info.st_mtime_ns:x}-{info.st_size:x}"' if revalidate else None
            supplied = self.headers.get("If-None-Match", "")
            tags = [tag.strip().removeprefix("W/") for tag in supplied.split(",")]
            unchanged = etag and ("*" in tags or etag.removeprefix("W/") in tags)
            self._headers(304 if unchanged else 200, media_type, info.st_size,
                          cache="no-cache" if revalidate else "no-store", etag=etag)
            if unchanged:
                return
            remaining = info.st_size
            try:
                while remaining:
                    chunk = source.read(min(64 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                # Closing a tab must also release its open file immediately.
                return


class WallpaperHandler(FileResponseMixin, BaseHTTPRequestHandler):
    """Serve the installed wallpaper on a separate loopback origin, read-only."""

    server_version = "PersonalJournalWallpaper/1.0"

    def do_GET(self) -> None:
        root = getattr(self.server, "wallpaper_root", WALLPAPER_ROOT)
        if root is None or self.headers.get("Host") not in {
            "127.0.0.1", f"127.0.0.1:{self.server.server_port}",
            "localhost", f"localhost:{self.server.server_port}",
        }:
            self.send_error(403)
            return
        path = unquote(urlsplit(self.path).path)
        kind, entry = wallpaper_entry(root)
        scene_files = {
            "/": ("scene-player.html", "text/html; charset=utf-8"),
            "/__scene-player.js": ("scene-player.js", "text/javascript; charset=utf-8"),
            "/__scene-player.css": ("scene-player.css", "text/css; charset=utf-8"),
            "/__vendor/webwallgl.mjs": ("vendor/webwallgl/webwallgl.mjs", "text/javascript; charset=utf-8"),
            "/__vendor/webwallgl.mjs.map": ("vendor/webwallgl/webwallgl.mjs.map", "application/json"),
        }
        if kind == "scene" and path in scene_files:
            name, media_type = scene_files[path]
            if path != "/":
                return self.send_file(ROOT / "public" / name, media_type, revalidate=True)
            payload = (ROOT / "public" / name).read_bytes()
            if path == "/":
                payload = payload.replace(b"__SITE_ORIGIN__", SITE_ORIGIN.encode("ascii"))
            self.send_wallpaper_bytes(payload, media_type)
            return
        if path == "/__preview":
            preview = wallpaper_preview(root)
            if not preview:
                self.send_error(404)
                return
            self.send_file(preview, mimetypes.guess_type(preview.name)[0], revalidate=True)
            return
        if path == "/__site-bridge.js":
            payload = (ROOT / "public" / "pond-bridge.js").read_text(encoding="utf-8")
            payload = payload.replace("__SITE_ORIGIN__", SITE_ORIGIN)
            payload = payload.replace(
                "__WALLPAPER_KIND__",
                "koi" if root == DEFAULT_WALLPAPER_ROOT else "html",
            ).encode("utf-8")
            self.send_wallpaper_bytes(payload, "text/javascript; charset=utf-8")
            return
        target = (root / path.lstrip("/")).resolve() if path != "/" else entry
        if target is None:
            self.send_error(404)
            return
        if (not target.is_relative_to(root) or target.suffix.lower() not in WALLPAPER_TYPES
                or not target.is_file() or target.stat().st_size > MAX_WALLPAPER_ASSET):
            self.send_error(404)
            return
        is_entry = kind == "html" and target == entry
        if is_entry:
            payload = target.read_bytes()
            bridge = b'<script src="/__site-bridge.js"></script>'
            payload, count = re.subn(br"(?i)<head\b[^>]*>", lambda match: match.group() + bridge, payload, count=1)
            if not count:
                payload = bridge + payload
        media_type = "text/javascript" if target.suffix.lower() in {".js", ".mjs"} else mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if media_type.startswith("text/") or target.suffix.lower() == ".js":
            media_type += "; charset=utf-8"
        if is_entry:
            self.send_wallpaper_bytes(payload, media_type)
        else:
            self.send_file(target, media_type, revalidate=True)

    def send_wallpaper_bytes(self, payload: bytes, media_type: str) -> None:
        self._headers(200, media_type, len(payload))
        self.wfile.write(payload)

    def _headers(self, status: int, content_type: str, length: int, *, cache: str = "no-store", etag: str | None = None) -> None:
        # SceneScript uses Function; this exception is restricted to the isolated
        # wallpaper origin. It never applies to the journal/management origin.
        root = getattr(self.server, "wallpaper_root", WALLPAPER_ROOT)
        # Pixi/Spine web wallpapers compile shader bindings too. Keep the
        # exception on this read-only origin, never on the journal origin.
        scene_eval = " 'unsafe-eval'" if root else ""
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if status != 304:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        if etag:
            self.send_header("ETag", etag)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            f"default-src 'none'; script-src 'self' 'unsafe-inline'{scene_eval}; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
            "font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; "
            "worker-src 'self' blob:; frame-src 'none'; "
            f"object-src 'none'; frame-ancestors {SITE_ORIGIN}; "
            "base-uri 'none'; form-action 'none'",
        )
        self.end_headers()


class Handler(FileResponseMixin, BaseHTTPRequestHandler):
    server_version = "PersonalJournal/1.0"

    def _headers(self, status: int, content_type: str, length: int, *, cache: str = "no-store", etag: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if status != 304:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        if etag:
            self.send_header("ETag", etag)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self'; "
            "script-src 'self'; connect-src 'self' https://api.open-meteo.com; object-src 'none'; base-uri 'none'; "
            "frame-src 'self' http://127.0.0.1:*",
        )
        self.end_headers()

    def send_bytes(self, data: bytes, content_type: str, status: int = 200) -> None:
        self._headers(status, content_type, len(data))
        self.wfile.write(data)

    def send_json(self, value: object, status: int = 200) -> None:
        self.send_bytes(
            json.dumps(value, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
            status,
        )

    def send_archive(self, writer, filename: str) -> None:
        # Zip central directories require seeking. Disk-backed temporary storage
        # bounds RAM without leaving generated downloads in the user's data dir.
        with tempfile.TemporaryFile(mode="w+b") as archive:
            writer(archive)
            length = archive.tell()
            archive.seek(0)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                shutil.copyfileobj(archive, self.wfile, length=64 * 1024)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                return

    def fail(self, status: int, message: str) -> None:
        self.send_json({"error": message}, status)

    def allowed_host(self) -> bool:
        host = self.headers.get("Host", "")
        return host in {
            "127.0.0.1",
            f"127.0.0.1:{self.server.server_port}",
            "localhost",
            f"localhost:{self.server.server_port}",
        }

    def allowed_write(self) -> bool:
        origin = self.headers.get("Origin")
        approved = {
            f"http://127.0.0.1:{self.server.server_port}",
            f"http://localhost:{self.server.server_port}",
        }
        return self.headers.get("X-Local-Request") == "1" and (
            not origin or origin in approved
        )

    def read_body(self, limit: int) -> bytes:
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError as error:
            raise ValueError("请求长度不正确") from error
        if size < 0 or size > limit:
            raise ValueError("文件过大或请求长度不正确")
        return self.rfile.read(size)

    def read_json(self) -> dict:
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            raise ValueError("请求需要 JSON 格式")
        value = json.loads(self.read_body(MAX_JSON))
        if not isinstance(value, dict):
            raise ValueError("请求格式不正确")
        return value

    def route(self) -> tuple[str, list[str]]:
        path = unquote(urlsplit(self.path).path)
        return path, [part for part in path.split("/") if part]

    def do_GET(self) -> None:
        if not self.allowed_host():
            return self.fail(403, "仅允许本机访问")
        path, parts = self.route()
        if len(parts) == 2 and parts[0] == "api" and parts[1] in KINDS:
            return self.send_json(read_snapshot(parts[1]))
        if parts == ["api", "wallpaper"]:
            return self.send_json(wallpaper_info())
        if parts == ["api", "wallpaper", "library"]:
            return self.send_json(wallpaper_library())
        if len(parts) == 5 and parts[:3] == ["api", "wallpaper", "library"] and parts[4] == "preview":
            try:
                preview = wallpaper_preview(wallpaper_library_item(parts[3]))
                if preview:
                    return self.send_file(preview, mimetypes.guess_type(preview.name)[0])
            except (OSError, ValueError):
                pass
            return self.fail(404, "预览图不存在")
        if parts == ["api", "private", "backup"]:
            return self.send_archive(make_backup, f"personal-journal-{datetime.now():%Y%m%d}.zip")
        if parts == ["api", "public", "export"]:
            return self.send_archive(make_public_export, f"personal-journal-public-{datetime.now():%Y%m%d}.zip")
        if len(parts) == 3 and parts[0] == "media" and parts[1] in KINDS:
            if not IMAGE_NAME.fullmatch(parts[2]):
                return self.fail(404, "图片不存在")
            image = media_dir(parts[1]) / parts[2]
            if not image.is_file():
                return self.fail(404, "图片不存在")
            media_type = mimetypes.guess_type(image.name)[0] or "application/octet-stream"
            return self.send_file(image, media_type)
        static = None
        if path == "/":
            static = ROOT / "public" / "index.html"
        elif path == "/studio":
            static = ROOT / "studio" / "index.html"
        elif parts and parts[0] in {"public", "studio"}:
            candidate = (ROOT / path.lstrip("/")).resolve()
            allowed = (ROOT / parts[0]).resolve()
            if candidate.is_relative_to(allowed):
                static = candidate
        if static and static.is_file():
            media_type = mimetypes.guess_type(static.name)[0] or "application/octet-stream"
            if media_type.startswith("text/") or media_type == "application/javascript":
                media_type += "; charset=utf-8"
            return self.send_file(static, media_type, revalidate=static.suffix.lower() not in {".html", ".htm"})
        self.fail(404, "页面不存在")

    def do_POST(self) -> None:
        self.mutate()

    def do_PUT(self) -> None:
        self.mutate()

    def do_DELETE(self) -> None:
        self.mutate()

    def mutate(self) -> None:
        global WALLPAPER_ROOT, CUSTOM_WALLPAPER_ROOT
        if not self.allowed_host() or not self.allowed_write():
            return self.fail(403, "仅允许本机页面修改内容")
        _, parts = self.route()
        try:
            if parts == ["api", "wallpaper", "prepare"] and self.command == "POST":
                body = self.read_json()
                raw = (str(DEFAULT_WALLPAPER_ROOT) if body.get("default") and DEFAULT_WALLPAPER_ROOT
                       else str(wallpaper_library_item(body["libraryId"])) if "libraryId" in body
                       else body.get("path", ""))
                root = validate_custom_wallpaper(raw)
                return self.send_json({"url": pinned_wallpaper_url(root), "kind": wallpaper_entry(root)[0], "name": str(wallpaper_metadata(root).get("title") or root.name)[:200]})
            if parts == ["api", "wallpaper"] and self.command in {"PUT", "DELETE"}:
                if not WALLPAPER_URL:
                    return self.fail(503, "壁纸服务端口不可用，请重启网站")
                if self.command == "PUT":
                    body = self.read_json()
                    raw = str(wallpaper_library_item(body["libraryId"])) if "libraryId" in body else body.get("path", "")
                    path = validate_custom_wallpaper(raw)
                    staged = CUSTOM_WALLPAPER_CONFIG.with_suffix(".tmp")
                    staged.write_text(json.dumps({"path": str(path)}, ensure_ascii=False), encoding="utf-8")
                    os.replace(staged, CUSTOM_WALLPAPER_CONFIG)
                    CUSTOM_WALLPAPER_ROOT = path
                    WALLPAPER_ROOT = path
                else:
                    CUSTOM_WALLPAPER_CONFIG.unlink(missing_ok=True)
                    CUSTOM_WALLPAPER_ROOT = None
                    WALLPAPER_ROOT = DEFAULT_WALLPAPER_ROOT
                return self.send_json(wallpaper_info())
            if parts == ["api", "wallpaper", "choose"] and self.command == "POST":
                try:
                    import tkinter as tk
                    from tkinter import filedialog
                    picker = tk.Tk()
                    picker.withdraw()
                    picker.wm_attributes("-topmost", True)
                    try:
                        selected = filedialog.askdirectory(parent=picker, title="选择 Wallpaper Engine 网页或场景壁纸文件夹")
                    finally:
                        picker.destroy()
                except Exception as error:
                    raise ValueError("系统文件夹选择器不可用，请手动粘贴文件夹路径") from error
                return self.send_json({"path": selected})
            if len(parts) >= 3 and parts[:2] in (
                ["api", "public"],
                ["api", "private"],
            ):
                scope = parts[1]
                if scope == "public" and parts[2] == "layout" and len(parts) == 3 and self.command in {"PUT", "DELETE"}:
                    value = validate_layout(self.read_json()) if self.command == "PUT" else None
                    with closing(connect("public")) as db, db:
                        if value is None:
                            db.execute("DELETE FROM settings WHERE key = 'layout'")
                        else:
                            db.execute(
                                "INSERT INTO settings(key, value) VALUES('layout', ?) "
                                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                                (json.dumps(value),),
                            )
                    return self.send_json({"ok": True, "layout": value})
                if parts[2] == "settings" and self.command == "PUT" and len(parts) == 3:
                    return self.save_settings(scope)
                if parts[2] == "images" and self.command == "POST" and len(parts) == 3:
                    return self.upload_image(scope)
                if parts[2] == "entries":
                    if self.command == "POST" and len(parts) == 3:
                        return self.create_entry(scope)
                    if (
                        scope == "public"
                        and self.command == "PUT"
                        and len(parts) == 4
                        and parts[3] == "order"
                    ):
                        return self.reorder_entries()
                    if len(parts) == 4 and self.command in {"PUT", "DELETE"}:
                        return self.change_entry(scope, parts[3])
                if (
                    scope == "private"
                    and parts[2] == "restore"
                    and self.command == "POST"
                    and len(parts) == 3
                ):
                    restore_backup(self.read_body(MAX_BACKUP))
                    return self.send_json({"ok": True})
            self.fail(404, "操作不存在")
        except (ValueError, json.JSONDecodeError, zipfile.BadZipFile) as error:
            self.fail(400, str(error))
        except Exception as error:
            print(f"Server error: {error}")
            self.fail(500, "保存失败，请重试")

    def save_settings(self, scope: str) -> None:
        value = self.read_json()
        clean = {}
        for key in (
            "name",
            "intro",
            "city",
            "timezone",
            "mapLatitude",
            "mapLongitude",
            "github",
            "social2Name",
            "social2Url",
            "social3Name",
            "social3Url",
            "avatar",
            "openingReveal",
            "openingCaption",
        ):
            item = value.get(key, "")
            limit = 80 if key == "openingReveal" else 160 if key == "openingCaption" else 5000
            if not isinstance(item, str) or len(item) > limit:
                raise ValueError("资料内容不正确")
            clean[key] = item.strip()
        if clean["mapLatitude"] or clean["mapLongitude"]:
            try:
                lat = float(clean["mapLatitude"])
                lon = float(clean["mapLongitude"])
            except ValueError:
                raise ValueError("地图经纬度需要同时填写为数字")
            if not math.isfinite(lat) or not math.isfinite(lon) or abs(lat) > 90 or abs(lon) > 180:
                raise ValueError("地图纬度需在 -90 到 90，经度需在 -180 到 180")
        for key in ("github", "social2Url", "social3Url"):
            if clean[key] and (urlsplit(clean[key]).scheme not in {"http", "https"} or not urlsplit(clean[key]).netloc):
                raise ValueError("账号链接需要为完整的 http / https 地址")
        if clean["avatar"] and not IMAGE_NAME.fullmatch(clean["avatar"]):
            raise ValueError("头像引用不正确")
        with closing(connect(scope)) as db, db:
            old = db.execute(
                "SELECT value FROM settings WHERE key = 'profile'"
            ).fetchone()
            db.execute(
                "INSERT INTO settings(key, value) VALUES('profile', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (json.dumps(clean, ensure_ascii=False),),
            )
        if old:
            prior = json.loads(old["value"]).get("avatar", "")
            if prior and prior != clean["avatar"]:
                remove_unused_image(scope, prior)
        self.send_json({"ok": True, "profile": clean})

    def upload_image(self, scope: str) -> None:
        media_type = self.headers.get("Content-Type", "").split(";")[0]
        if media_type not in IMAGE_TYPES:
            raise ValueError("只支持 JPG、PNG、WebP 或 GIF 图片")
        image = self.read_body(MAX_IMAGE)
        if not valid_image(image, media_type):
            raise ValueError("图片文件格式不正确")
        name = uuid.uuid4().hex + IMAGE_TYPES[media_type]
        (media_dir(scope) / name).write_bytes(image)
        self.send_json({"name": name, "url": f"/media/{scope}/{name}"}, 201)

    def create_entry(self, scope: str) -> None:
        body = self.read_json()
        kind = body.get("kind", "")
        data = validate_data(scope, kind, body.get("data"))
        timestamp = now_iso()
        entry_id = uuid.uuid4().hex
        with closing(connect(scope)) as db, db:
            sort_order = None
            if scope == "public":
                sort_order = db.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM entries WHERE kind = ?",
                    (kind,),
                ).fetchone()[0]
            db.execute(
                "INSERT INTO entries(id, kind, data, created_at, updated_at, sort_order) "
                "VALUES(?, ?, ?, ?, ?, ?)",
                (entry_id, kind, json.dumps(data, ensure_ascii=False), timestamp, timestamp, sort_order),
            )
        self.send_json({"ok": True, "id": entry_id}, 201)

    def reorder_entries(self) -> None:
        body = self.read_json()
        kind, ids = body.get("kind"), body.get("ids")
        if kind not in KINDS["public"] or not isinstance(ids, list):
            raise ValueError("排序内容不正确")
        if not all(isinstance(entry_id, str) and re.fullmatch(r"[a-f0-9]{32}", entry_id) for entry_id in ids):
            raise ValueError("排序内容不正确")
        with closing(connect("public")) as db, db:
            existing = [
                row["id"]
                for row in db.execute("SELECT id FROM entries WHERE kind = ?", (kind,))
            ]
            if len(ids) != len(existing) or set(ids) != set(existing):
                raise ValueError("排序列表与当前内容不一致，请刷新后重试")
            for index, entry_id in enumerate(ids):
                db.execute(
                    "UPDATE entries SET sort_order = ? WHERE id = ? AND kind = ?",
                    (index, entry_id, kind),
                )
        self.send_json({"ok": True})

    def change_entry(self, scope: str, entry_id: str) -> None:
        with closing(connect(scope)) as db, db:
            row = db.execute(
                "SELECT kind, data FROM entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if not row:
                return self.fail(404, "记录不存在")
            prior_image = json.loads(row["data"]).get("image", "")
            if self.command == "DELETE":
                db.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
            else:
                body = self.read_json()
                data = validate_data(scope, row["kind"], body.get("data"))
                db.execute(
                    "UPDATE entries SET data = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(data, ensure_ascii=False), now_iso(), entry_id),
                )
        if prior_image:
            if self.command == "DELETE" or prior_image != data.get("image", ""):
                remove_unused_image(scope, prior_image)
        self.send_json({"ok": True})


def main() -> None:
    global DATA, WALLPAPER_ROOT, WALLPAPER_URL, SITE_ORIGIN
    global DEFAULT_WALLPAPER_ROOT, CUSTOM_WALLPAPER_ROOT
    global USE_PINNED_WALLPAPERS
    USE_PINNED_WALLPAPERS = True
    parser = argparse.ArgumentParser(description="Run the personal journal locally")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    if args.data_dir:
        DATA = args.data_dir.resolve()
    initialize()
    server = HTTPServer(("127.0.0.1", args.port), Handler)
    address = f"http://127.0.0.1:{server.server_port}"
    SITE_ORIGIN = address
    wallpaper_server = None
    wallpaper_thread = None
    DEFAULT_WALLPAPER_ROOT = configured_wallpaper()
    CUSTOM_WALLPAPER_ROOT = configured_custom_wallpaper()
    WALLPAPER_ROOT = CUSTOM_WALLPAPER_ROOT or DEFAULT_WALLPAPER_ROOT
    try:
        wallpaper_server = HTTPServer(("127.0.0.1", args.port + 1), WallpaperHandler)
        WALLPAPER_URL = f"http://127.0.0.1:{wallpaper_server.server_port}"
        wallpaper_thread = threading.Thread(target=wallpaper_server.serve_forever, daemon=True)
        wallpaper_thread.start()
        print(f"本机壁纸服务：{WALLPAPER_URL}", flush=True)
    except OSError as error:
        WALLPAPER_URL = ""
        print(f"本机壁纸服务未启动：{error}", flush=True)
    print(f"个人网站已启动：{address}  私人记录区：{address}/studio", flush=True)
    if args.open:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        close_wallpaper_hosts()
        if wallpaper_server:
            wallpaper_server.shutdown()
            wallpaper_server.server_close()
        if wallpaper_thread:
            wallpaper_thread.join(timeout=2)


if __name__ == "__main__":
    main()
