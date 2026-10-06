"""Exercise the wallpaper catalog using disposable Workshop folders only."""
import json
import tempfile
import threading
import unittest
from http.server import HTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class QuietMain(server.Handler):
    def log_message(self, *args):
        pass


class QuietWallpaper(server.WallpaperHandler):
    def log_message(self, *args):
        pass


class WallpaperLibraryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.library = self.base / "431960"
        self.web = self.make_item("100", {"type": "Web", "file": "index.html", "title": "Web", "preview": "preview.png"})
        (self.web / "index.html").write_text("<body>wallpaper</body>", encoding="utf-8")
        (self.web / "preview.png").write_bytes(b"image-only")
        self.scene = self.make_item("200", {"type": "scene", "file": "scene.json", "title": "Scene"})
        (self.scene / "scene.pkg").write_bytes(b"test-package")
        self.make_item("300", {"type": "application", "file": "app.exe"})
        self.make_item("400", {"type": "web", "file": "../../private.html", "preview": "../../private.png"})
        (self.base / "private.png").write_bytes(b"private")
        (self.base / "private.html").write_text("private", encoding="utf-8")
        self.globals = patch.multiple(server, DEFAULT_WALLPAPER_ROOT=self.web,
            WALLPAPER_ROOT=self.web, CUSTOM_WALLPAPER_ROOT=None,
            CUSTOM_WALLPAPER_CONFIG=self.base / "custom.json")
        self.globals.start()
        self.main = HTTPServer(("127.0.0.1", 0), QuietMain)
        self.wall = HTTPServer(("127.0.0.1", 0), QuietWallpaper)
        self.origin = f"http://127.0.0.1:{self.main.server_port}"
        self.wall_origin = f"http://127.0.0.1:{self.wall.server_port}"
        self.origins = patch.multiple(server, WALLPAPER_URL=self.wall_origin, SITE_ORIGIN=self.origin)
        self.origins.start()
        self.threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in (self.main, self.wall)]
        for thread in self.threads:
            thread.start()

    def tearDown(self):
        server.close_wallpaper_hosts()
        for service in (self.main, self.wall):
            service.shutdown()
            service.server_close()
        for thread in self.threads:
            thread.join()
        self.origins.stop()
        self.globals.stop()
        self.temp.cleanup()

    def make_item(self, item_id, metadata):
        root = self.library / item_id
        root.mkdir(parents=True)
        (root / "project.json").write_text(json.dumps(metadata), encoding="utf-8")
        return root

    def request(self, path, payload=None, wallpaper=False):
        req = Request((self.wall_origin if wallpaper else self.origin) + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"X-Local-Request": "1", "Content-Type": "application/json"},
            method="PUT" if payload is not None else "GET")
        return urlopen(req, timeout=10)

    def test_catalog_select_refresh_and_preview_boundaries(self):
        with self.request("/api/wallpaper/library") as response:
            catalog = json.load(response)
        items = {item["id"]: item for item in catalog["items"]}
        self.assertTrue(items["100"]["selected"])
        self.assertEqual(items["200"]["kind"], "scene")
        self.assertTrue(items["200"]["supported"])
        self.assertFalse(items["300"]["supported"])
        self.assertFalse(items["400"]["supported"])
        self.assertEqual(items["400"]["preview"], "")
        with self.request(items["100"]["preview"]) as response:
            self.assertEqual(response.read(), b"image-only")
        for item_id in ["400", "999", "%2e%2e"]:
            with self.assertRaises(HTTPError) as error:
                self.request(f"/api/wallpaper/library/{item_id}/preview")
            self.assertEqual(error.exception.code, 404)
        with self.request("/api/wallpaper", {"libraryId": "200"}) as response:
            self.assertEqual(json.load(response)["kind"], "scene")
        self.assertEqual(server.WALLPAPER_ROOT, self.scene)
        self.assertEqual(json.loads((self.base / "custom.json").read_text())["path"], str(self.scene))
        self.assertEqual(server.configured_custom_wallpaper(), self.scene)
        for bad in ["../private", "300", "400", 100, "999"]:
            with self.assertRaises(HTTPError) as error:
                self.request("/api/wallpaper", {"libraryId": bad})
            self.assertEqual(error.exception.code, 400)
        self.assertEqual(server.WALLPAPER_ROOT, self.scene)
        (self.web / "project.json").unlink()
        with self.request("/api/wallpaper/library") as response:
            self.assertEqual(len(json.load(response)["items"]), 3)

    def test_scene_host_is_isolated_and_vendor_is_local(self):
        with self.request("/api/wallpaper", {"libraryId": "200"}):
            pass
        with self.request("/", wallpaper=True) as response:
            self.assertIn(b"/__scene-player.js", response.read())
            self.assertIn("'unsafe-eval'", response.headers["Content-Security-Policy"])
            self.assertIn("connect-src 'self'", response.headers["Content-Security-Policy"])
        with self.request("/") as response:
            self.assertNotIn("'unsafe-eval'", response.headers["Content-Security-Policy"])
        with self.request("/__vendor/webwallgl.mjs", wallpaper=True) as response:
            self.assertEqual(response.headers.get_content_type(), "text/javascript")
            self.assertIn(b"function httpSource", response.read())
        with self.request("/scene.pkg", wallpaper=True) as response:
            self.assertEqual(response.read(), b"test-package")
        for path in ["/api/private", "/../../private.png", "/__vendor/../../server.py"]:
            with self.assertRaises(HTTPError):
                self.request(path, wallpaper=True)
        with self.request("/api/wallpaper", {"libraryId": "100"}):
            pass
        with self.request("/", wallpaper=True) as response:
            self.assertIn(b"__site-bridge.js", response.read())
            self.assertIn("'unsafe-eval'", response.headers["Content-Security-Policy"])
            self.assertIn("connect-src 'self'", response.headers["Content-Security-Policy"])

    def test_declared_web_entry_and_bad_metadata(self):
        nested = self.make_item("500", {"type": "web", "file": "start.html"})
        (nested / "start.html").write_text("<body>nested</body>", encoding="utf-8")
        self.assertEqual(server.validate_custom_wallpaper(str(nested)), nested)
        with self.request("/api/wallpaper", {"libraryId": "500"}):
            pass
        with self.request("/", wallpaper=True) as response:
            self.assertIn(b"<body>nested</body>", response.read())
        (nested / "project.json").write_text("[]", encoding="utf-8")
        self.assertEqual(server.wallpaper_metadata(nested), {})

    def test_prepare_does_not_change_selection_and_pins_asset_origin(self):
        req = Request(self.origin + "/api/wallpaper/prepare", data=b'{"libraryId":"200"}',
            method="POST", headers={"X-Local-Request": "1", "Content-Type": "application/json"})
        with urlopen(req) as response:
            prepared = json.load(response)
        self.assertEqual(server.WALLPAPER_ROOT, self.web)
        self.assertFalse((self.base / "custom.json").exists())
        with urlopen(prepared["url"] + "/scene.pkg") as response:
            self.assertEqual(response.read(), b"test-package")
        # The global selection changes, but the prepared origin remains pinned.
        server.WALLPAPER_ROOT = self.web
        with urlopen(prepared["url"] + "/scene.pkg") as response:
            self.assertEqual(response.read(), b"test-package")
        (self.scene / "sample.skel").write_bytes(b"skeleton")
        with urlopen(prepared["url"] + "/sample.skel") as response:
            self.assertEqual(response.read(), b"skeleton")

    def test_subscription_details_do_not_confuse_retained_installs(self):
        acf = self.library.parent.parent / "appworkshop_431960.acf"
        # Use a dedicated workshop/content/431960 hierarchy, never the system temp parent.
        root = self.base / "workshop" / "content" / "431960"
        root.mkdir(parents=True)
        acf = root.parent.parent / "appworkshop_431960.acf"
        acf.write_text('"AppWorkshop" { "WorkshopItemsInstalled" { "100" {} "200" {} } "WorkshopItemDetails" { "100" { "subscribedby" "1" } } }')
        self.assertEqual(server.wallpaper_subscriptions(root), {"100"})
        acf.write_text('"AppWorkshop" { "WorkshopItemDetails" {')
        self.assertIsNone(server.wallpaper_subscriptions(root))
        acf.unlink()
        self.assertIsNone(server.wallpaper_subscriptions(root))


if __name__ == "__main__":
    unittest.main()
