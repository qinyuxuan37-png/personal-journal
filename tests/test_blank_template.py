"""A clean checkout must initialize without anybody's personal content."""
import tempfile
import unittest
from pathlib import Path
import server


class BlankTemplateTest(unittest.TestCase):
    def test_fresh_database_has_no_content_or_profile(self):
        previous = server.DATA
        try:
            with tempfile.TemporaryDirectory() as temporary:
                server.DATA = Path(temporary)
                server.initialize()
                for scope in server.KINDS:
                    snapshot = server.read_snapshot(scope)
                    self.assertEqual(snapshot['settings'], {})
                    self.assertTrue(all(not rows for rows in snapshot['entries'].values()))
                    self.assertEqual(list(server.media_dir(scope).iterdir()), [])
        finally:
            server.DATA = previous
