from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from mcp2cli.converter.config_disabler import disable_server


class TestDisableServer(unittest.TestCase):
    def test_missing_config_file_is_ignored(self):
        with TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "missing.json"
            ok = disable_server("demo-server", config_path, "cursor_json")
            self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
