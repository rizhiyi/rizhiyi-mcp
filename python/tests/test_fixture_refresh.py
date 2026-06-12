from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tests.refresh_api_fixtures import load_env_overrides, normalize_output_path, resolve_live_settings


class FixtureRefreshTestCase(unittest.TestCase):
    def test_load_env_overrides_supports_comments_and_export_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_file = Path(temp_dir) / ".env"
            env_file.write_text(
                "\n".join(
                    [
                        "# comment",
                        "export LOGEASE_BASE_URL=http://demo.example",
                        "LOGEASE_API_KEY=admin:secret",
                        "OTHER_VALUE='ok'",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            values = load_env_overrides(env_file)

        self.assertEqual(values["LOGEASE_BASE_URL"], "http://demo.example")
        self.assertEqual(values["LOGEASE_API_KEY"], "admin:secret")
        self.assertEqual(values["OTHER_VALUE"], "ok")

    def test_resolve_live_settings_prefers_auth_header(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_file = Path(temp_dir) / ".env"
            env_file.write_text(
                "\n".join(
                    [
                        "LOGEASE_BASE_URL=http://demo.example/",
                        "LOGEASE_AUTH_HEADER=apikey explicit:header",
                        "LOGEASE_API_KEY=ignored:value",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            base_url, auth_header = resolve_live_settings(env_file)

        self.assertEqual(base_url, "http://demo.example")
        self.assertEqual(auth_header, "apikey explicit:header")

    def test_normalize_output_path_resolves_repo_relative_path(self) -> None:
        output_path = normalize_output_path("api-responses/test-refresh-output.json")
        self.assertTrue(output_path.is_absolute())
        self.assertEqual(output_path.name, "test-refresh-output.json")
        self.assertEqual(output_path.parent.name, "api-responses")


if __name__ == "__main__":
    unittest.main()
