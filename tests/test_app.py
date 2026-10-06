"""End-to-end checks for the local HTTP API, using disposable data only."""

import base64
import io
import json
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from contextlib import closing
from http.server import HTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4"
    "z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg=="
)


class QuietHandler(server.Handler):
    def log_message(self, format, *args):
        pass


class QuietWallpaperHandler(server.WallpaperHandler):
    def log_message(self, format, *args):
        pass


class LocalSiteTest(unittest.TestCase):
    def test_static_conditional_cache_does_not_apply_to_html_or_private_api(self):
        url = self.base + "/public/offline-map-worker.js"
        with urlopen(url) as response:
            etag = response.headers["ETag"]
            self.assertEqual(response.headers["Cache-Control"], "no-cache")
            self.assertIn("script-src 'self'", response.headers["Content-Security-Policy"])
            self.assertIn(b"importScripts", response.read())
        with self.assertRaises(HTTPError) as cached:
            urlopen(Request(url, headers={"If-None-Match": etag}))
        self.assertEqual(cached.exception.code, 304)
        self.assertEqual(cached.exception.read(), b"")
        cached.exception.close()
        for path in ("/", "/studio", "/api/private"):
            with urlopen(Request(self.base + path, headers={"If-None-Match": "*"})) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertIsNone(response.headers.get("ETag"))

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        server.DATA = Path(cls.temp.name) / "data"
        server.initialize()
        cls.httpd = HTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.base = "http://127.0.0.1:" + str(cls.httpd.server_port)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def call(self, path, method="GET", payload=None, content_type="application/json", origin=None):
        body = None if payload is None else (
            json.dumps(payload).encode("utf-8")
            if content_type == "application/json"
            else payload
        )
        headers = {}
        if method != "GET":
            headers["X-Local-Request"] = "1"
            headers["Content-Type"] = content_type
        if origin:
            headers["Origin"] = origin
        request = Request(self.base + path, data=body, headers=headers, method=method)
        with urlopen(request, timeout=10) as response:
            raw = response.read()
            return (
                json.loads(raw)
                if response.headers.get_content_type() == "application/json"
                else raw
            )

    def test_content_isolation_images_and_backup(self):
        public_name = "公开展示名称"
        private_note = "仅供自己看的测试秘密"
        self.call(
            "/api/public/settings",
            "PUT",
            {
                "name": public_name,
                "intro": "公开介绍",
                "city": "上海",
                "timezone": "Asia/Shanghai",
                "github": "https://github.com/example",
                "openingReveal": "另一层测试文字",
                "openingCaption": "开场说明",
            },
        )
        self.call(
            "/api/private/settings",
            "PUT",
            {"name": "私人昵称", "intro": private_note, "city": "东京"},
        )
        public_entry = self.call(
            "/api/public/entries",
            "POST",
            {"kind": "projects", "data": {"title": "公开项目", "description": "展示内容"}},
        )
        self.assertTrue(public_entry["id"])
        private_entry = self.call(
            "/api/private/entries",
            "POST",
            {"kind": "notes", "data": {"title": private_note, "description": "正文"}},
        )
        picture = self.call("/api/private/images", "POST", PNG, "image/png")
        self.assertEqual(self.call(picture["url"]), PNG)
        self.call(
            "/api/private/entries",
            "POST",
            {"kind": "photos", "data": {"title": "照片", "image": picture["name"]}},
        )
        public = self.call("/api/public")
        private = self.call("/api/private")
        self.assertEqual(public["settings"]["profile"]["name"], public_name)
        self.assertEqual(public["settings"]["profile"]["openingReveal"], "另一层测试文字")
        self.assertEqual(private["entries"]["notes"][0]["id"], private_entry["id"])
        self.assertNotIn(private_note, json.dumps(public, ensure_ascii=False))
        self.assertNotIn(private_note, self.call("/").decode("utf-8"))
        studio_page = self.call("/studio")
        self.assertIn(b"studio/app.js", studio_page)
        self.assertIn(b"studio/wallpaper.js", studio_page)
        self.assertIn(b'id="studio-wallpaper-frame"', studio_page)
        self.assertIn(b"opening-reveal", self.call("/"))
        self.assertIn(b"openingActive", self.call("/public/motion.js"))

        archive = self.call("/api/private/backup")
        self.call("/api/private/entries/" + private_entry["id"], "DELETE")
        self.assertFalse(self.call("/api/private")["entries"]["notes"])
        self.call("/api/private/restore", "POST", archive, "application/zip")
        restored = self.call("/api/private")
        self.assertEqual(restored["entries"]["notes"][0]["data"]["title"], private_note)
        self.assertEqual(self.call(picture["url"]), PNG)
        self.assertTrue(list((server.DATA / "pre-restore-backups").glob("*.zip")))
        self.assertEqual(self.call("/api/public")["entries"]["projects"][0]["data"]["title"], "公开项目")

    def test_rejects_cross_origin_write(self):
        with self.assertRaises(HTTPError) as error:
            self.call(
                "/api/private/entries",
                "POST",
                {"kind": "notes", "data": {"title": "不应保存"}},
                origin="https://example.com",
            )
        self.assertEqual(error.exception.code, 403)

    def test_rejects_unknown_image(self):
        with self.assertRaises(HTTPError) as error:
            self.call("/api/private/images", "POST", b"not a real image", "image/png")
        self.assertEqual(error.exception.code, 400)

    def test_layout_persistence_validation_reset_and_export(self):
        layout = {"version": 2, "items": {
            "profile": {"x": 0, "y": 3, "w": 13, "h": 9},
            "clock": {"x": 18, "y": 0, "w": 6, "h": 5},
        }}
        self.call("/api/public/layout", "PUT", layout)
        self.call("/api/public/settings", "PUT", {"name": "布局测试"})
        self.assertEqual(self.call("/api/public")["settings"]["layout"], layout)
        self.assertNotIn("layout", self.call("/api/private")["settings"])
        for field, invalid in (("x", -1), ("x", True), ("w", 30), ("w", 2), ("x", 10), ("y", 1.5)):
            bad = json.loads(json.dumps(layout))
            bad["items"]["profile"][field] = invalid
            with self.subTest(field=field, value=invalid), self.assertRaises(HTTPError) as error:
                self.call("/api/public/layout", "PUT", bad)
            self.assertEqual(error.exception.code, 400)
        for bad in ({}, {"version": 3, "items": layout["items"]}, {"version": 1, "items": {}}):
            with self.assertRaises(HTTPError) as error:
                self.call("/api/public/layout", "PUT", bad)
            self.assertEqual(error.exception.code, 400)
        self.assertEqual(self.call("/api/public")["settings"]["layout"], layout)
        with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
            html = archive.read("index.html").decode("utf-8")
            self.assertIn("public/layout.js", html)
            self.assertIn("public/layout-model.js", archive.namelist())
            self.assertNotIn("public/layout-editor.js", archive.namelist())
            self.assertNotIn('id="layout-start"', html)
            self.assertNotIn('id="layout-toolbar"', html)
            self.assertNotIn('id="wallpaper-diy"', html)
            self.assertNotIn('id="opening-frequency"', html)
            self.assertNotIn('public/customize.js', html)
            self.assertNotIn('public/editor-motion.css', html)
            data = archive.read("public-data.js").decode("utf-8")
            snapshot = json.loads(data.removeprefix("window.PUBLIC_EXPORT_SNAPSHOT = ").removesuffix(";\n"))
            self.assertEqual(snapshot["settings"]["layout"], layout)
        self.call("/api/public/layout", "DELETE")
        self.assertNotIn("layout", self.call("/api/public")["settings"])
        self.assertEqual(self.call("/api/public")["settings"]["profile"]["name"], "布局测试")

    def test_old_layout_migrates_without_changing_retained_positions(self):
        old = {"version": 1, "items": {
            "profile": {"x": 0, "y": 3, "w": 13, "h": 9},
            "clock": {"x": 18, "y": 0, "w": 6, "h": 5},
            "tech": {"x": 0, "y": 13, "w": 8, "h": 3},
            "projects": {"x": 8, "y": 13, "w": 8, "h": 3},
            "interests": {"x": 16, "y": 13, "w": 8, "h": 3},
        }}
        saved = self.call("/api/public/layout", "PUT", old)["layout"]
        self.assertEqual(saved, {"version": 2, "items": {key: old["items"][key] for key in ("profile", "clock")}})
        self.assertEqual(self.call("/api/public")["settings"]["layout"], saved)
        self.call("/api/public/layout", "DELETE")

    def test_social_account_settings_validation_and_public_export(self):
        profile = {"name": "账号测试", "github": "https://github.com/example", "social2Name": "博客", "social2Url": "https://example.com/me", "social3Name": "哔哩哔哩", "social3Url": "https://space.bilibili.com/123"}
        self.call("/api/public/settings", "PUT", profile)
        for key, value in profile.items():
            self.assertEqual(self.call("/api/public")["settings"]["profile"][key], value)
        for key in ("github", "social2Url", "social3Url"):
            for invalid in ("javascript:alert(1)", "data:text/html,test", "https:///no-host"):
                with self.subTest(key=key, url=invalid), self.assertRaises(HTTPError) as error:
                    self.call("/api/public/settings", "PUT", {**profile, key: invalid})
                self.assertEqual(error.exception.code, 400)
        with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
            html = archive.read("index.html").decode("utf-8")
            self.assertNotIn('class="home-menu"', html)
            for element in ("github-link", "social2-link", "social3-link", "avatar-placeholder"):
                self.assertIn(f'id="{element}"', html)
            snapshot = json.loads(archive.read("public-data.js").decode("utf-8").removeprefix("window.PUBLIC_EXPORT_SNAPSHOT = ").removesuffix(";\n"))
            self.assertEqual(snapshot["settings"]["profile"]["social2Url"], profile["social2Url"])
    def test_map_coordinates_validate_persist_and_export_offline(self):
        profile = {"city": "Shanghai", "mapLatitude": "31.2", "mapLongitude": "121.5"}
        self.call("/api/public/settings", "PUT", profile)
        for lat, lon in (("31", ""), ("", "121"), ("NaN", "1"), ("1", "Infinity"), ("91", "0"), ("0", "181")):
            with self.subTest(lat=lat, lon=lon), self.assertRaises(HTTPError) as error:
                self.call("/api/public/settings", "PUT", {**profile, "mapLatitude": lat, "mapLongitude": lon})
            self.assertEqual(error.exception.code, 400)
        saved = self.call("/api/public")["settings"]["profile"]
        self.assertEqual(saved["mapLatitude"], "31.2")
        self.assertEqual(saved["mapLongitude"], "121.5")
        with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
            for asset in ("offline-map.css", "offline-map-model.js", "offline-map.js", "offline-map-data.js", "map-sources.md", "weather-model.js", "weather.js"):
                self.assertIn("public/" + asset, archive.namelist())
            html = archive.read("index.html").decode("utf-8")
            self.assertIn('id="map-dialog"', html)
            self.assertIn('src="./public/offline-map.js"', html)
            self.assertNotIn('id="map-edit"', html)
            snapshot = json.loads(archive.read("public-data.js").decode("utf-8").removeprefix("window.PUBLIC_EXPORT_SNAPSHOT = ").removesuffix(";\n"))
            self.assertEqual(snapshot["settings"]["profile"]["mapLongitude"], "121.5")
        self.call("/api/public/settings", "PUT", {"city": "上海", "mapLatitude": "0", "mapLongitude": "0"})
        self.assertEqual(self.call("/api/public")["settings"]["profile"]["mapLatitude"], "0")
        self.call("/api/public/settings", "PUT", {"city": "上海"})
        self.assertEqual(self.call("/api/public")["settings"]["profile"]["mapLatitude"], "")

    def test_all_sections_support_create_edit_and_delete(self):
        for scope, kinds in server.KINDS.items():
            for kind in kinds:
                with self.subTest(scope=scope, kind=kind):
                    photo = {"image": self.call("/api/public/images", "POST", PNG, "image/png")["name"]} if kind == "gallery" else {}
                    created = self.call(
                        "/api/" + scope + "/entries",
                        "POST",
                        {"kind": kind, "data": {"title": "测试标题", "description": "初始内容", **photo}},
                    )
                    entry_id = created["id"]
                    self.call(
                        "/api/" + scope + "/entries/" + entry_id,
                        "PUT",
                        {"data": {"title": "修改后的标题", "description": "修改后的内容", **photo}},
                    )
                    entries = self.call("/api/" + scope)["entries"][kind]
                    saved = next(item for item in entries if item["id"] == entry_id)
                    self.assertEqual(saved["data"]["description"], "修改后的内容")
                    self.call("/api/" + scope + "/entries/" + entry_id, "DELETE")
                    entries = self.call("/api/" + scope)["entries"][kind]
                    self.assertFalse(any(item["id"] == entry_id for item in entries))

    def test_music_is_public_editable_and_exported(self):
        image = self.call("/api/public/images", "POST", PNG, "image/png")["name"]
        data = {"title": "循环的歌", "artist": "音乐人", "description": "夜晚听", "url": "https://example.com/song", "image": image}
        entry = self.call("/api/public/entries", "POST", {"kind": "music", "data": data})
        try:
            saved = next(item for item in self.call("/api/public")["entries"]["music"] if item["id"] == entry["id"])
            self.assertEqual(saved["data"], data)
            self.assertNotIn("music", self.call("/api/private")["entries"])
            with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
                snapshot = json.loads(archive.read("public-data.js").decode("utf-8").removeprefix("window.PUBLIC_EXPORT_SNAPSHOT = ").removesuffix(";\n"))
                self.assertTrue(any(item["data"] == data for item in snapshot["entries"]["music"]))
                self.assertIn("media/public/" + image, archive.namelist())
                self.assertIn('id="music-list"', archive.read("index.html").decode("utf-8"))
                self.assertIn('id="music-wall"', archive.read("index.html").decode("utf-8"))
                self.assertIn("public/music-wall.js", archive.namelist())
                self.assertIn("public/music-wall.css", archive.namelist())
                self.assertIn("public/work-showcase.js", archive.namelist())
                self.assertIn("public/work-showcase.css", archive.namelist())
        finally:
            self.call("/api/public/entries/" + entry["id"], "DELETE")

    def test_public_cannot_serve_private_source_file(self):
        with self.assertRaises(HTTPError) as error:
            self.call("/public/%2e%2e/server.py")
        self.assertEqual(error.exception.code, 404)

    def test_gallery_requires_public_upload_and_never_exports_private_photos(self):
        private_image = self.call("/api/private/images", "POST", PNG, "image/png")["name"]
        private_entry = self.call("/api/private/entries", "POST", {
            "kind": "photos", "data": {"title": "私人相册隔离标记", "image": private_image},
        })["id"]
        public_image = self.call("/api/public/images", "POST", PNG, "image/png")["name"]
        gallery_entry = None
        try:
            for image in ("", "../private/" + private_image, private_image):
                with self.subTest(image=image), self.assertRaises(HTTPError) as rejected:
                    self.call("/api/public/entries", "POST", {"kind": "gallery", "data": {"title": "展示", "image": image}})
                self.assertEqual(rejected.exception.code, 400)
                rejected.exception.close()
            gallery_entry = self.call("/api/public/entries", "POST", {
                "kind": "gallery", "data": {"title": "主动展示的照片", "image": public_image, "date": "2026-10-05"},
            })["id"]
            gallery = self.call("/api/public")["entries"]["gallery"]
            self.assertTrue(any(entry["id"] == gallery_entry for entry in gallery))
            self.assertFalse(any(entry["id"] == private_entry for entry in gallery))
            with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
                self.assertIn("public/photo-album.js", archive.namelist())
                self.assertIn("public/photo-album.css", archive.namelist())
                self.assertIn("media/public/" + public_image, archive.namelist())
                self.assertFalse(any(private_image in path for path in archive.namelist()))
                self.assertNotIn("私人相册隔离标记", archive.read("public-data.js").decode("utf-8"))
                self.assertNotIn("/studio?view=gallery", archive.read("index.html").decode("utf-8"))
        finally:
            if gallery_entry:
                self.call("/api/public/entries/" + gallery_entry, "DELETE")
            self.call("/api/private/entries/" + private_entry, "DELETE")

    def test_home_opens_dedicated_work_and_music_exhibits(self):
        html = self.call("/").decode("utf-8")
        self.assertNotIn('class="home-menu"', html)
        self.assertIn('class="profile-stats"', html)
        self.assertIn('class="brand" href="#about"', html)
        self.assertIn('id="pond-status"', html)
        self.assertNotIn('id="pond-toggle"', html)
        self.assertEqual(html.count('class="panel-back"'), 1)
        for target in ("#tech", "#projects"):
            self.assertIn(f'href="{target}"', html)
            self.assertIn(f'data-display-target="{target[1:]}"', html)
            self.assertIn(f'id="{target[1:]}" class="section work-page"', html)
        self.assertIn('href="#interests" data-display-target="interests"', html)
        self.assertIn('class="interest-destination collection-music-entry" href="#music"', html)
        self.assertNotIn('class="profile-music-entry"', html)
        self.assertIn('id="music-wall"', html)
        self.assertIn(b"function showPanel", self.call("/public/motion.js"))
        self.assertIn(b"body.single-screen", self.call("/public/style.css"))

    def test_technology_image_and_text_survive_edit_and_public_export(self):
        image = self.call("/api/public/images", "POST", PNG, "image/png")["name"]
        created = self.call(
            "/api/public/entries", "POST",
            {"kind": "tech", "data": {"title": "示例技术", "description": "最初说明", "image": image}},
        )["id"]
        try:
            self.call(
                "/api/public/entries/" + created, "PUT",
                {"data": {"title": "示例技术", "description": "修改后的说明", "image": image}},
            )
            item = next(
                entry for entry in self.call("/api/public")["entries"]["tech"]
                if entry["id"] == created
            )
            self.assertEqual(item["data"]["description"], "修改后的说明")
            with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
                self.assertEqual(archive.read("media/public/" + image), PNG)
        finally:
            self.call("/api/public/entries/" + created, "DELETE")

    def test_public_export_contains_only_public_content_and_offline_assets(self):
        private_text = "绝不能出现在公开导出中的私人文字"
        private_entry = self.call(
            "/api/private/entries", "POST",
            {"kind": "notes", "data": {"title": private_text}},
        )["id"]
        image = self.call("/api/public/images", "POST", PNG, "image/png")["name"]
        public_entry = self.call(
            "/api/public/entries", "POST",
            {"kind": "projects", "data": {"title": "离线项目", "image": image}},
        )["id"]
        try:
            with zipfile.ZipFile(io.BytesIO(self.call("/api/public/export"))) as archive:
                names = set(archive.namelist())
                self.assertTrue({
                    "index.html", "public-data.js", "public/style.css",
                    "public/app.js", "public/motion.js", "public/favicon.svg",
                    f"media/public/{image}",
                }.issubset(names))
                self.assertFalse(any(name.startswith("studio/") or "private" in name for name in names))
                self.assertNotIn("public/pond-bridge.js", names)
                self.assertNotIn("public/editor.js", names)
                self.assertIn("public/theme.css", names)
                html = archive.read("index.html").decode("utf-8")
                data = archive.read("public-data.js").decode("utf-8")
                self.assertIn('data-export="true"', html)
                self.assertNotIn('id="wallpaper-diy"', html)
                self.assertNotIn('id="wallpaper-dialog"', html)
                self.assertNotIn('id="studio-dialog"', html)
                self.assertNotIn('src="./public/editor.js"', html)
                self.assertIn('src="./public-data.js"', html)
                self.assertIn('href="./public/style.css"', html)
                self.assertIn('href="./public/theme.css"', html)
                self.assertIn('class="brand" href="#about"', html)
                self.assertNotIn("/studio", html)
                exported = json.loads(data.removeprefix("window.PUBLIC_EXPORT_SNAPSHOT = ").removesuffix(";\n"))
                self.assertTrue(any(
                    item["data"]["title"] == "离线项目"
                    for item in exported["entries"]["projects"]
                ))
                self.assertNotIn(private_text, json.dumps(exported, ensure_ascii=False))
                self.assertEqual(archive.read(f"media/public/{image}"), PNG)
        finally:
            self.call("/api/public/entries/" + public_entry, "DELETE")
            self.call("/api/private/entries/" + private_entry, "DELETE")

    def test_public_order_survives_edits_and_rejects_incomplete_lists(self):
        created = []
        try:
            for title in ("第一项", "第二项", "第三项"):
                result = self.call(
                    "/api/public/entries", "POST",
                    {"kind": "games", "data": {"title": title}},
                )
                created.append(result["id"])
            current = [
                item["id"] for item in self.call("/api/public")["entries"]["games"]
            ]
            desired = list(reversed(current))
            self.call(
                "/api/public/entries/order", "PUT",
                {"kind": "games", "ids": desired},
            )
            self.call(
                "/api/public/entries/" + desired[-1], "PUT",
                {"data": {"title": "编辑后仍在原位"}},
            )
            actual = [
                item["id"] for item in self.call("/api/public")["entries"]["games"]
            ]
            self.assertEqual(actual, desired)
            with self.assertRaises(HTTPError) as error:
                self.call(
                    "/api/public/entries/order", "PUT",
                    {"kind": "games", "ids": desired[:-1]},
                )
            self.assertEqual(error.exception.code, 400)
            self.assertEqual(
                [item["id"] for item in self.call("/api/public")["entries"]["games"]],
                desired,
            )
        finally:
            for entry_id in created:
                self.call("/api/public/entries/" + entry_id, "DELETE")

    def test_existing_database_gains_display_order_without_losing_entries(self):
        previous_data = server.DATA
        try:
            with tempfile.TemporaryDirectory() as temp:
                server.DATA = Path(temp) / "data"
                server.DATA.mkdir()
                with closing(sqlite3.connect(server.db_path("public"))) as db, db:
                    db.execute(
                        "CREATE TABLE entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, "
                        "data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
                    )
                    db.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                    for entry_id, title, updated in (
                        ("a" * 32, "旧项目", "2026-01-01T00:00:00+00:00"),
                        ("b" * 32, "较新项目", "2026-02-01T00:00:00+00:00"),
                    ):
                        db.execute(
                            "INSERT INTO entries VALUES (?, 'projects', ?, ?, ?)",
                            (entry_id, json.dumps({"title": title}), updated, updated),
                        )
                server.initialize()
                self.assertEqual(
                    [item["data"]["title"] for item in server.read_snapshot("public")["entries"]["projects"]],
                    ["较新项目", "旧项目"],
                )
        finally:
            server.DATA = previous_data

    def test_wallpaper_origin_serves_only_configured_assets(self):
        previous_root, previous_origin = server.WALLPAPER_ROOT, server.SITE_ORIGIN
        try:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                (root / "index.html").write_text("<html><body>pond</body></html>", encoding="utf-8")
                (root / "src").mkdir()
                (root / "src" / "app.js").write_text("export const app = {};", encoding="utf-8")
                server.WALLPAPER_ROOT = root.resolve()
                server.SITE_ORIGIN = "http://127.0.0.1:8765"
                wallpaper = HTTPServer(("127.0.0.1", 0), QuietWallpaperHandler)
                thread = threading.Thread(target=wallpaper.serve_forever, daemon=True)
                thread.start()
                base = "http://127.0.0.1:" + str(wallpaper.server_port)
                try:
                    with urlopen(base + "/", timeout=10) as response:
                        html = response.read().decode("utf-8")
                        self.assertIn("/__site-bridge.js", html)
                        self.assertIn("frame-ancestors http://127.0.0.1:8765", response.headers["Content-Security-Policy"])
                    with urlopen(base + "/__site-bridge.js", timeout=10) as response:
                        self.assertIn("http://127.0.0.1:8765", response.read().decode("utf-8"))
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base + "/api/private", timeout=10)
                    self.assertEqual(error.exception.code, 404)
                finally:
                    wallpaper.shutdown()
                    wallpaper.server_close()
                    thread.join()
        finally:
            server.WALLPAPER_ROOT, server.SITE_ORIGIN = previous_root, previous_origin

    def test_diy_wallpaper_switches_and_restores_without_copying_files(self):
        previous = (
            server.WALLPAPER_ROOT, server.DEFAULT_WALLPAPER_ROOT,
            server.CUSTOM_WALLPAPER_ROOT, server.CUSTOM_WALLPAPER_CONFIG,
            server.WALLPAPER_URL, server.SITE_ORIGIN,
        )
        try:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                default = root / "default"
                custom = root / "custom"
                default.mkdir()
                custom.mkdir()
                (default / "index.html").write_text("<body>default</body>", encoding="utf-8")
                (custom / "index.html").write_text("<body>custom</body>", encoding="utf-8")
                (custom / "effect.js").write_text("window.effect = true", encoding="utf-8")
                server.DEFAULT_WALLPAPER_ROOT = default.resolve()
                server.CUSTOM_WALLPAPER_ROOT = None
                server.WALLPAPER_ROOT = default.resolve()
                server.CUSTOM_WALLPAPER_CONFIG = root / "wallpaper.custom.json"
                server.SITE_ORIGIN = self.base
                wallpaper = HTTPServer(("127.0.0.1", 0), QuietWallpaperHandler)
                thread = threading.Thread(target=wallpaper.serve_forever, daemon=True)
                thread.start()
                server.WALLPAPER_URL = "http://127.0.0.1:" + str(wallpaper.server_port)
                try:
                    self.assertFalse(self.call("/api/wallpaper")["custom"])
                    chosen = self.call("/api/wallpaper", "PUT", {"path": str(custom)})
                    self.assertTrue(chosen["available"])
                    self.assertTrue(chosen["custom"])
                    self.assertEqual(chosen["kind"], "html")
                    self.assertEqual(server.WALLPAPER_ROOT, custom.resolve())
                    self.assertTrue(server.CUSTOM_WALLPAPER_CONFIG.is_file())
                    with urlopen(server.WALLPAPER_URL + "/", timeout=10) as response:
                        html = response.read()
                        self.assertIn(b"custom", html)
                        self.assertIn(b"/__site-bridge.js", html)
                        self.assertIn("connect-src 'self'", response.headers["Content-Security-Policy"])
                    with urlopen(server.WALLPAPER_URL + "/effect.js", timeout=10) as response:
                        self.assertIn(b"window.effect", response.read())
                    with urlopen(server.WALLPAPER_URL + "/__site-bridge.js", timeout=10) as response:
                        self.assertIn(b'const isKoi = "html" === "koi"', response.read())
                    with self.assertRaises(HTTPError) as error:
                        self.call("/api/wallpaper", "PUT", {"path": str(root / "missing")})
                    self.assertEqual(error.exception.code, 400)
                    self.assertEqual(server.WALLPAPER_ROOT, custom.resolve())
                    restored = self.call("/api/wallpaper", "DELETE")
                    self.assertFalse(restored["custom"])
                    self.assertEqual(server.WALLPAPER_ROOT, default.resolve())
                    self.assertFalse(server.CUSTOM_WALLPAPER_CONFIG.exists())
                    with urlopen(server.WALLPAPER_URL + "/", timeout=10) as response:
                        self.assertIn(b"default", response.read())
                finally:
                    wallpaper.shutdown()
                    wallpaper.server_close()
                    thread.join()
        finally:
            (
                server.WALLPAPER_ROOT, server.DEFAULT_WALLPAPER_ROOT,
                server.CUSTOM_WALLPAPER_ROOT, server.CUSTOM_WALLPAPER_CONFIG,
                server.WALLPAPER_URL, server.SITE_ORIGIN,
            ) = previous

    def test_old_private_backup_remains_editable_after_restore(self):
        previous_data = server.DATA
        try:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                server.DATA = root / "data"
                server.initialize()
                legacy = root / "legacy.sqlite3"
                with closing(sqlite3.connect(legacy)) as db, db:
                    db.execute(
                        "CREATE TABLE entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL, "
                        "data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
                    )
                    db.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
                    db.execute(
                        "INSERT INTO entries VALUES (?, 'notes', ?, ?, ?)",
                        ("c" * 32, json.dumps({"title": "旧备忘录"}), "2026-01-01", "2026-01-01"),
                    )
                output = io.BytesIO()
                with zipfile.ZipFile(output, "w") as archive:
                    archive.writestr("manifest.json", json.dumps({"version": 1}))
                    archive.write(legacy, "private.sqlite3")
                server.restore_backup(output.getvalue())
                with closing(server.connect("private")) as db, db:
                    db.execute(
                        "INSERT INTO entries(id, kind, data, created_at, updated_at, sort_order) "
                        "VALUES (?, 'notes', ?, ?, ?, NULL)",
                        ("d" * 32, json.dumps({"title": "新备忘录"}), "2026-02-01", "2026-02-01"),
                    )
                titles = [
                    item["data"]["title"]
                    for item in server.read_snapshot("private")["entries"]["notes"]
                ]
                self.assertEqual(titles, ["新备忘录", "旧备忘录"])
        finally:
            server.DATA = previous_data


if __name__ == "__main__":
    unittest.main()
