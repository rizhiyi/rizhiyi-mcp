from __future__ import annotations

import unittest

from rizhiyi_mcp.service_parserrule import ParserRuleService
from tests.support import load_curl_json_fixture


class ParserRuleServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.service = ParserRuleService()

    def _load_verify_fixture(self, fixture_name: str) -> dict:
        fixture = load_curl_json_fixture(fixture_name)
        if "rule" not in fixture and "conf" in fixture:
            fixture["rule"] = fixture["conf"]
        return fixture

    def test_build_verify_request_preserves_single_fixture_shapes(self) -> None:
        fixture = self._load_verify_fixture("verify_single.txt")

        result = self.service.build_verify_request(
            {
                "payload": fixture,
                "domain": "ops",
                "query_logtype": "verify-single",
            }
        )

        self.assertNotIn("error", result)
        payload = result["payload"]
        self.assertEqual(result["queryLogtype"], "verify-single")
        self.assertEqual(payload["logtype"], fixture["logtype"])
        self.assertEqual(payload["rawMessage"], fixture["rawMessage"])
        self.assertEqual(payload["sample_logs"], fixture["sample_logs"])
        self.assertTrue(all(isinstance(item, str) for item in payload["sample_logs"]))

    def test_build_verify_request_preserves_batch_fixture_shapes(self) -> None:
        fixture = self._load_verify_fixture("verifies.txt")

        result = self.service.build_verify_request(fixture)

        self.assertNotIn("error", result)
        payload = result["payload"]
        self.assertIsNone(result["queryLogtype"])
        self.assertEqual(payload["logtype"], fixture["logtype"])
        self.assertEqual(payload["sample_logs"], fixture["sample_logs"])
        self.assertTrue(all(isinstance(item, dict) for item in payload["sample_logs"]))
        self.assertEqual(payload["rawMessage"], fixture["sample_logs"][0]["raw_message"])

    def test_build_verify_request_rejects_invalid_logtype_shape(self) -> None:
        fixture = self._load_verify_fixture("verify_single.txt")

        result = self.service.build_verify_request(
            {
                "payload": {
                    "rule": fixture["rule"],
                    "conf": fixture["conf"],
                    "sample_logs": fixture["sample_logs"],
                    "enable": fixture["enable"],
                    "logtype": {"unexpected": "shape"},
                }
            }
        )

        self.assertIn("error", result)
        self.assertEqual(result["error"]["error_code"], "INVALID_PARAM_TYPE")
        self.assertIn("logtype", result["error"]["error"])

    def test_generate_draft_request_accepts_object_sample_log(self) -> None:
        result = self.service.build_generate_draft_request(
            {"sample_logs": {"raw_message": "level=info message=ok"}}
        )

        self.assertNotIn("error", result)
        self.assertEqual(result["payload"]["sample_logs"], ["level=info message=ok"])


if __name__ == "__main__":
    unittest.main()
