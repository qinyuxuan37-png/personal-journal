"""File-serving memory bounds and cache privacy, using disposable files."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import server


class Sink:
    def __init__(self):
        self.sizes = []

    def write(self, chunk):
        self.sizes.append(len(chunk))


class Response(server.FileResponseMixin):
    def __init__(self, headers=None):
        self.headers = headers or {}
        self.wfile = Sink()

    def _headers(self, *args, **kwargs):
        self.response = args, kwargs


class FileResponseTest(unittest.TestCase):
    def test_large_file_is_chunked_and_closed_without_read_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "asset.bin"
            path.write_bytes(b"x" * (3 * 1024 * 1024 + 1))
            response = Response()
            with patch.object(Path, "read_bytes", side_effect=AssertionError("whole-file read")):
                response.send_file(path, "application/octet-stream", revalidate=True)
            self.assertLessEqual(max(response.wfile.sizes), 64 * 1024)
            self.assertEqual(sum(response.wfile.sizes), path.stat().st_size)
            self.assertEqual(response.response[1]["cache"], "no-cache")
            etag = response.response[1]["etag"]
            cached = Response({"If-None-Match": f'"other", {etag}'})
            cached.send_file(path, "application/octet-stream", revalidate=True)
            self.assertEqual(cached.response[0][0], 304)
            self.assertEqual(cached.wfile.sizes, [])
            path.write_bytes(b"changed")
            changed = Response({"If-None-Match": etag})
            changed.send_file(path, "application/octet-stream", revalidate=True)
            self.assertEqual(changed.response[0][0], 200)

    def test_private_media_never_honors_conditional_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "private.png"
            path.write_bytes(b"private")
            response = Response({"If-None-Match": "*"})
            response.send_file(path, "image/png")
            self.assertEqual(response.response[0][0], 200)
            self.assertEqual(response.response[1], {"cache": "no-store", "etag": None})
            self.assertEqual(sum(response.wfile.sizes), 7)

    def test_disconnected_transfer_releases_file(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "asset.bin"
            path.write_bytes(b"asset")
            response = Response()
            with patch.object(response.wfile, "write", side_effect=BrokenPipeError):
                response.send_file(path, "application/octet-stream")
            # On Windows an open handle would prevent this rename.
            path.rename(path.with_suffix(".done"))

    def test_archive_stream_closes_temporary_file_on_success_disconnect_and_failure(self):
        factory = tempfile.TemporaryFile
        for outcome in ("success", "disconnect", "writer-error"):
            files = []
            def temporary_file(*args, **kwargs):
                result = factory(*args, **kwargs)
                files.append(result)
                return result
            response = object.__new__(server.Handler)
            response.send_response = Mock()
            response.send_header = Mock()
            response.end_headers = Mock()
            response.wfile = Sink()
            if outcome == "disconnect":
                response.wfile.write = Mock(side_effect=BrokenPipeError)
            def writer(output):
                for _ in range(32):
                    output.write(b"x" * (64 * 1024))
                if outcome == "writer-error":
                    raise ValueError("test failure")
            with patch.object(server.tempfile, "TemporaryFile", temporary_file):
                if outcome == "writer-error":
                    with self.assertRaises(ValueError):
                        response.send_archive(writer, "test.zip")
                else:
                    response.send_archive(writer, "test.zip")
            self.assertTrue(files[0].closed, outcome)
            if outcome == "success":
                self.assertEqual(sum(response.wfile.sizes), 2 * 1024 * 1024)
                self.assertLessEqual(max(response.wfile.sizes), 64 * 1024)
                response.send_header.assert_any_call("Cache-Control", "no-store")
