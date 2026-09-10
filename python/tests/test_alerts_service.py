from __future__ import annotations

import unittest

from rizhiyi_mcp.service_alerts import AlertService


class AlertServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.service = AlertService()

    def test_extract_mutation_body_accepts_object(self) -> None:
        result = self.service.extract_mutation_body(
            {"rule": {"name": "t", "category": 0, "enabled": True}},
            "rule",
            "create_alert",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"]["name"], "t")

    def test_extract_mutation_body_accepts_json_string(self) -> None:
        result = self.service.extract_mutation_body(
            {"rule": '{"name":"t","category":0,"enabled":true}'},
            "rule",
            "create_alert",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"]["category"], 0)

    def test_extract_mutation_body_rejects_invalid_json(self) -> None:
        result = self.service.extract_mutation_body({"rule": "{bad json"}, "rule", "create_alert")
        self.assertIn("error", result)
        self.assertEqual(result["error"]["error_code"], "INVALID_JSON_STRING")

    def test_extract_mutation_body_drops_non_write_fields(self) -> None:
        result = self.service.extract_mutation_body(
            {"rule": {"name": "t", "category": 0, "enabled": True, "not_a_field": 123}},
            "rule",
            "create_alert",
        )
        self.assertNotIn("error", result)
        self.assertNotIn("not_a_field", result["value"])

    def test_category0_statistics_field_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 0, "statistics_field": "apache.req_time"},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category1_missing_field_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 1, "check_condition": {"function": "max"}},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category1_with_field_ok(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 1, "check_condition": {"field": "apache.req_time", "function": "max"}},
            "create_alert",
        )
        self.assertIsNone(result)

    def test_category2_missing_base_value_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 2, "check_condition": {"function": "count"}},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category5_missing_topic_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 5, "check_condition": {"timerange": "m"}},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category19_missing_composite_info_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts({"category": 19}, "create_alert")
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_no_category_skips_validation(self) -> None:
        result = self.service.validate_category_field_conflicts({"name": "t"}, "create_alert")
        self.assertIsNone(result)

    def test_preprocess_json_fields_serializes_object(self) -> None:
        result = self.service.preprocess_json_fields(
            {"check_condition": {"field": "a", "function": "count"}},
            "create_alert.rule",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"]["check_condition"], '{"field": "a", "function": "count"}')

    def test_preprocess_json_fields_preserves_valid_string(self) -> None:
        result = self.service.preprocess_json_fields(
            {"check_condition": '{"field":"a"}'},
            "create_alert.rule",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"]["check_condition"], '{"field":"a"}')

    def test_preprocess_json_fields_rejects_invalid_json_string(self) -> None:
        result = self.service.preprocess_json_fields(
            {"check_condition": "{not-json"},
            "create_alert.rule",
        )
        self.assertIn("error", result)
        self.assertEqual(result["error"]["error_code"], "INVALID_JSON_STRING")

    def test_snake_to_camel_alert(self) -> None:
        converted = self.service.snake_to_camel_alert(
            {"check_interval": 300, "app_id": 1, "extend_conf": "{}", "dataset_ids": "[]", "name": "t"}
        )
        self.assertEqual(converted["checkInterval"], 300)
        self.assertEqual(converted["appId"], 1)
        self.assertEqual(converted["extendConf"], "{}")
        self.assertEqual(converted["datasetIds"], "[]")

    def test_normalize_id_list_accepts_array(self) -> None:
        result = self.service.normalize_id_list({"ids": [1178, 1180, 214]})
        self.assertNotIn("error", result)
        self.assertEqual(result["value"], "1178,1180,214")

    def test_normalize_id_list_accepts_comma_string(self) -> None:
        result = self.service.normalize_id_list({"ids": "214,1178"})
        self.assertNotIn("error", result)
        self.assertEqual(result["value"], "214,1178")

    def test_normalize_id_list_required_missing(self) -> None:
        result = self.service.normalize_id_list({}, required=True)
        self.assertIn("error", result)
        self.assertEqual(result["error"]["error_code"], "MISSING_REQUIRED_PARAM")

    def test_extract_batch_items_accepts_json_string_array(self) -> None:
        result = self.service.extract_batch_items(
            {"items": '[{"id":1,"enabled":true}]'},
            "update_alerts_batch",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"], [{"id": 1, "enabled": True}])

    def test_extract_batch_items_rejects_non_array_json(self) -> None:
        result = self.service.extract_batch_items({"items": '{"id":1}'}, "update_alerts_batch")
        self.assertIn("error", result)
        self.assertEqual(result["error"]["error_code"], "INVALID_PARAM_TYPE")

    def test_resolve_requested_category_by_name(self) -> None:
        self.assertEqual(self.service.resolve_requested_category({"category": "SPL 统计监控"}), 4)
        self.assertEqual(self.service.resolve_requested_category({"category": "3"}), 3)
        self.assertEqual(self.service.resolve_requested_category({"type": 2}), 2)
        self.assertIsNone(self.service.resolve_requested_category({}))

    def test_resolve_required_fields_for_create(self) -> None:
        self.assertEqual(
            self.service.resolve_required_fields_for_create(5),
            ("name", "query", "topic", "category", "enabled", "check_condition"),
        )
        self.assertEqual(
            self.service.resolve_required_fields_for_create(19),
            ("name", "composite_info", "category", "enabled"),
        )

    def test_get_alert_category_reference_full_and_single(self) -> None:
        full = self.service.get_alert_category_reference({})
        self.assertEqual(len(full["data"]["categories"]), 8)
        single = self.service.get_alert_category_reference({"category": "0"})
        self.assertEqual(single["data"]["requested_category"], 0)

    def test_create_typed_alert_assembles_rule_with_category(self) -> None:
        result = self.service.build_typed_rule(
            {"name": "t", "query": "*", "check_interval": 300, "check_condition": {"timerange": "-5min", "function": "count", "operator": ">", "threshold": "high:0"}},
            0,
            "create_keyword_alert",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"]["category"], 0)
        self.assertEqual(result["value"]["name"], "t")
        self.assertEqual(result["value"]["check_interval"], 300)

    def test_create_typed_alert_injects_default_enabled(self) -> None:
        value = self.service.build_typed_rule({"name": "t", "query": "*"}, 4, "create_spl_alert")["value"]
        self.assertEqual(value["category"], 4)
        self.assertTrue(value["enabled"])

    def test_create_typed_alert_locks_category_ignores_user_input(self) -> None:
        value = self.service.build_typed_rule({"name": "t", "query": "*", "category": 1}, 0, "create_keyword_alert")["value"]
        self.assertEqual(value["category"], 0)
        extra_overridden = self.service.build_typed_rule({"name": "t", "query": "*", "extra": {"category": 6}}, 19, "create_composite_alert")["value"]
        self.assertEqual(extra_overridden["category"], 19)

    def test_create_typed_alert_merges_extra_object(self) -> None:
        value = self.service.build_typed_rule(
            {"name": "t", "query": "*", "extra": {"timezone": "Asia/Shanghai", "not_a_field": 1}},
            1,
            "create_field_stat_alert",
        )["value"]
        self.assertEqual(value["timezone"], "Asia/Shanghai")
        self.assertNotIn("not_a_field", value)

    def test_create_typed_alert_merges_extra_json_string(self) -> None:
        value = self.service.build_typed_rule({"name": "t", "query": "*", "extra": '{"timezone":"Asia/Shanghai"}'}, 1, "create_field_stat_alert")["value"]
        self.assertEqual(value["timezone"], "Asia/Shanghai")
        self.assertEqual(value["category"], 1)

    def test_create_typed_alert_rejects_bad_extra(self) -> None:
        result = self.service.build_typed_rule({"name": "t", "query": "*", "extra": "{bad json"}, 0, "create_keyword_alert")
        self.assertIn("error", result)
        self.assertEqual(result["error"]["error_code"], "INVALID_JSON_STRING")

    def test_create_typed_alert_categories(self) -> None:
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_keyword_alert"], 0)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_field_stat_alert"], 1)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_baseline_alert"], 2)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_surge_alert"], 3)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_spl_alert"], 4)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_stream_lookup_alert"], 5)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_stream_agg_alert"], 6)
        self.assertEqual(self.service.CREATE_TYPED_ALERT_CATEGORIES["create_composite_alert"], 19)

    def test_is_pretest_done(self) -> None:
        self.assertFalse(self.service.is_pretest_done({"finished": False}))
        self.assertTrue(self.service.is_pretest_done({"finished": True}))
        self.assertTrue(self.service.is_pretest_done({"result": []}))
        self.assertTrue(self.service.is_pretest_done({"result": {"a": 1}}))
        self.assertTrue(self.service.is_pretest_done({"meta": {"state": "done"}}))


if __name__ == "__main__":
    unittest.main()
