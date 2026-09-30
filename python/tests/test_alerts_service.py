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
            {"category": 1, "executor_id": 1, "check_condition": {"function": "max", "timerange": "-10m"}},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category1_with_field_ok(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 1, "executor_id": 1, "check_condition": {"field": "apache.req_time", "function": "max", "timerange": "-10m"}},
            "create_alert",
        )
        self.assertIsNone(result)

    def test_category2_missing_base_value_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 2, "executor_id": 1, "check_condition": {"function": "count", "timerange": "-10m"}},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category5_missing_topic_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts(
            {"category": 5, "executor_id": 1, "check_condition": {"timerange": "m"}},
            "create_alert",
        )
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_category19_missing_composite_info_conflict(self) -> None:
        result = self.service.validate_category_field_conflicts({"category": 19, "executor_id": 1}, "create_alert")
        self.assertIsNotNone(result)
        self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_missing_timerange_conflict(self) -> None:
        for category in (0, 1, 2, 3, 4):
            result = self.service.validate_category_field_conflicts(
                {"category": category, "executor_id": 1, "check_condition": {"function": "count"}},
                "create_alert",
            )
            self.assertIsNotNone(result, f"category={category} 应缺少 timerange")
            self.assertEqual(result["error_code"], "CATEGORY_FIELD_CONFLICT")

    def test_missing_executor_id_conflict(self) -> None:
        for category in (0, 1, 2, 3, 4, 5, 6, 19):
            result = self.service.validate_category_field_conflicts(
                {"category": category, "check_condition": {"timerange": "-5min"}},
                "create_alert",
            )
            self.assertIsNotNone(result, f"category={category} 应缺少 executor_id")
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
            ("name", "query", "topic", "category", "enabled", "check_condition", "executor_id"),
        )
        self.assertEqual(
            self.service.resolve_required_fields_for_create(19),
            ("name", "composite_info", "category", "enabled", "executor_id"),
        )

    def test_get_alert_category_reference_full_and_single(self) -> None:
        full = self.service.get_alert_category_reference({})
        self.assertEqual(len(full["data"]["categories"]), 8)
        single = self.service.get_alert_category_reference({"category": "0"})
        self.assertEqual(single["data"]["requested_category"], 0)

    def test_create_typed_alert_assembles_rule_with_category(self) -> None:
        result = self.service.build_typed_rule(
            {"name": "t", "query": "*", "executor_id": 1, "check_interval": 300, "check_condition": {"timerange": "-5min", "function": "count", "operator": ">", "threshold": "high:0"}},
            0,
            "create_keyword_alert",
        )
        self.assertNotIn("error", result)
        self.assertEqual(result["value"]["category"], 0)
        self.assertEqual(result["value"]["name"], "t")
        self.assertEqual(result["value"]["check_interval"], 300)

    def test_create_typed_alert_injects_default_enabled(self) -> None:
        value = self.service.build_typed_rule({"name": "t", "query": "*", "executor_id": 1}, 4, "create_spl_alert")["value"]
        self.assertEqual(value["category"], 4)
        self.assertTrue(value["enabled"])

    def test_create_typed_alert_locks_category_ignores_user_input(self) -> None:
        value = self.service.build_typed_rule({"name": "t", "query": "*", "executor_id": 1, "category": 1}, 0, "create_keyword_alert")["value"]
        self.assertEqual(value["category"], 0)
        extra_overridden = self.service.build_typed_rule({"name": "t", "query": "*", "executor_id": 1, "extra": {"category": 6}}, 19, "create_composite_alert")["value"]
        self.assertEqual(extra_overridden["category"], 19)

    def test_create_typed_alert_merges_extra_object(self) -> None:
        value = self.service.build_typed_rule(
            {"name": "t", "query": "*", "executor_id": 1, "extra": {"timezone": "Asia/Shanghai", "not_a_field": 1}},
            1,
            "create_field_stat_alert",
        )["value"]
        self.assertEqual(value["timezone"], "Asia/Shanghai")
        self.assertNotIn("not_a_field", value)

    def test_create_typed_alert_merges_extra_json_string(self) -> None:
        value = self.service.build_typed_rule({"name": "t", "query": "*", "executor_id": 1, "extra": '{"timezone":"Asia/Shanghai"}'}, 1, "create_field_stat_alert")["value"]
        self.assertEqual(value["timezone"], "Asia/Shanghai")
        self.assertEqual(value["category"], 1)

    def test_create_typed_alert_rejects_bad_extra(self) -> None:
        result = self.service.build_typed_rule({"name": "t", "query": "*", "executor_id": 1, "extra": "{bad json"}, 0, "create_keyword_alert")
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


TRIGGERED_ROW = {
    "alert_name": "交换机_华为S12700_高级别事件告警",
    "alert_id": 75,
    "alert_level": "high",
    "event_level": "high",
    "value": 64,
    "timestamp": 1790682665059,
    "event_time": 1790682665059,
    "trigger_timestamp": 1790682665059,
    "start_timestamp": 1790682365059,
    "end_timestamp": 1790682665059,
    "issue_alert": "true",
    "is_recovery": "false",
    "alert_history_id": "75_1790682665059_0",
    "appname": "alert_record",
    "search_url": "http://rizhiyi.com/search/?title=demo",
    "result.name": "交换机_华为S12700_高级别事件告警",
    "result.alert_id": 75,
    "result.level": "high",
    "result.result.value": 64,
    "result.description": "",
    "result.strategy.description": "事件数监控",
    "result.strategy.trigger.level": "high",
    "result.strategy.trigger.compare": ">",
    "result.strategy.trigger.compare_value": 20,
    "result.strategy.trigger.compare_desc_text": "计数大于20",
    "result.alert_condition_strategy.alert_level": "high",
    "result.alert_condition_strategy.trigger_time": 1790682665059,
    "result.search.query": "logtype:switch tag:huawei_S12700 switch.severity:<4",
    "result.trigger_timestamp": 1790682665059,
    "result.exec_time": 1790682675420,
    "result.plugin.plugin_result": (
        "<br>告警名称: 交换机_华为S12700_高级别事件告警<br>告警级别：高<br>告警描述: <br>"
        "告警产生时间: 2026年9月29日 19:51:15<br>最近事件: appname:switch, hostname:VM_16_9_centos"
    ),
}

SEGMENTED_ROW = {
    "alert_name": "监控告警演示(字段数统计_错误返回码url调用量统计)",
    "alert_id": 1227,
    "alert_level": "critical",
    "timestamp": 1790682660000,
    "is_recovery": "false",
    # 研发确认：result.is_segmentation=true 时，result.segmentation_field 记实体字段名，
    # result.segmentation_specify_value 记实体字段值。
    "result.is_segmentation": True,
    "result.segmentation_field": "json.URL",
    "result.segmentation_specify_value": "/api/v1/orders",
    "result.appname": "order-service",
    "result.ip": "10.0.1.13",
    "result.result.value": 12800,
    "result.description": "json.URL出现次数超过10,000次",
}

# 只有 is_segmentation 标记、没有值的记录（= 当前环境未真正触发的形态），不应产出实体。
SEGMENTED_NO_VALUE_ROW = {
    "alert_name": "监控告警演示(事件数目统计_日志错误返回码)",
    "alert_id": 1226,
    "alert_level": "high",
    "timestamp": 1790739960000,
    "issue_alert": "false",
    "is_recovery": "false",
    "result.is_segmentation": True,
    "result.segmentation_field": "appname",
    "result.appname": "alert_record",
    "result.description": "计数大于100,000",
}

# 更早环境的历史写法：扁平 segmentation_field / segmentation_value。
LEGACY_SEGMENTED_ROW = {
    "alert_name": "历史环境分段告警",
    "alert_id": 1490,
    "alert_level": "high",
    "timestamp": 1790682660000,
    "is_recovery": "false",
    "segmentation_field": "src_ip",
    "segmentation_value": "10.0.1.99",
}

SPL_STAT_ROW = {
    "alert_name": "服务调用报错-示例zyt",
    "alert_id": 1489,
    "alert_level": "critical",
    "timestamp": 1790736207687,
    "is_recovery": "false",
    "result.result.value": 35,
    "result.result.complex_value": "cnt:35",
    "result.result.columns.name": ["service", "error_message", "cnt", "alert_msg"],
    "result.description": "-1m内收到来自的35条日志，触发条件是计数>[10]",
}

SPARSE_ROW = {
    "timestamp": 1790682665059,
    "is_recovery": "false",
    "appname": "alert_record",
    "result.alert_id": 74,
    "result.plugin.plugin_result": "<br>告警名称: 交换机_华为S12700_错误告警<br>告警级别：高<br>",
}

RECOVERY_ROW = {
    "alert_name": "eventgen断采",
    "alert_id": 1128,
    "alert_level": "no_alert",
    "timestamp": 1790736209047,
    "is_recovery": "false",
    "result.description": "-10m内字段的统计值为，触发条件",
}


class AlertHistoryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.service = AlertService()

    def plan(self, params: dict) -> dict:
        built = self.service.build_history_query(params)
        self.assertNotIn("error", built, built.get("error"))
        return built["value"]

    # ---- 查询构造 ----

    def test_build_query_defaults(self) -> None:
        plan = self.plan({})
        self.assertTrue(plan["query"].startswith(
            "index=monitor appname:alert_record 'issue_alert':true NOT 'is_recovery':true "
            "| sort by -timestamp | fields "
        ))
        self.assertIn("'result.appname', 'result.ip',", plan["query"])
        self.assertIn("'result.plugin.plugin_result'", plan["query"])
        self.assertEqual(plan["time_range"], "-24h,now")
        self.assertEqual(plan["entity_fields"], ["result.appname", "result.ip"])
        self.assertEqual(plan["size"], 20)
        self.assertEqual(plan["page"], 0)
        self.assertFalse(plan["include_recovery"])
        self.assertFalse(plan["include_search_url"])
        # 已移除的"内部实现旋钮"不应再出现在 plan 里
        self.assertNotIn("only_triggered", plan)
        self.assertNotIn("include_notification_text", plan)
        self.assertNotIn("description_max_chars", plan)

    def test_build_query_default_is_system_wide(self) -> None:
        """不传监控项 = 全系统总体查询，且不需要通配符占位。"""
        query = self.plan({})["query"]
        # 只看过滤子句（投影里本来就有 alert_name 字段名，不能整串判）
        filters = query.split(" | sort by ")[0]
        self.assertEqual(
            filters,
            "index=monitor appname:alert_record 'issue_alert':true NOT 'is_recovery':true",
        )
        self.assertNotIn("alert_id:", filters)
        self.assertNotIn("alert_name:", filters)
        self.assertNotIn("alert_level:", filters)  # levels 不传 = 全部级别

    def test_build_query_has_no_hardcoded_limit(self) -> None:
        """SPL 里不能写死 | limit，否则 HTTP page 参数翻不动页（实测 page>=1 恒 0 行）。"""
        self.assertNotIn("| limit ", self.plan({})["query"])
        self.assertNotIn("| limit ", self.plan({"size": 999})["query"])

    def test_normalize_time_range(self) -> None:
        normalize = self.service.normalize_history_time_range
        # 新版日志易只接受 `-<N><unit>,now`，故统一把 `now-<N><unit>` 归一化
        self.assertEqual(normalize("now-24h,now"), "-24h,now")
        self.assertEqual(normalize("now-7d,now"), "-7d,now")
        self.assertEqual(normalize("now - 30m , now"), "-30m,now")
        # 已是通用写法 / 绝对时间 / epoch 毫秒 → 原样透传
        self.assertEqual(normalize("-24h,now"), "-24h,now")
        self.assertEqual(normalize("earliest,now"), "earliest,now")
        self.assertEqual(normalize("1790076698110,1790681498110"), "1790076698110,1790681498110")
        # 空值走默认
        self.assertEqual(normalize(None), "-24h,now")
        self.assertEqual(normalize("   "), "-24h,now")
        # 非「两段」写法不强行改动
        self.assertEqual(normalize("now-24h"), "now-24h")
        # build_history_query 走同一归一化
        self.assertEqual(self.plan({"time_range": "now-7d,now"})["time_range"], "-7d,now")

    def test_build_query_filters(self) -> None:
        plan = self.plan({
            "alert_id": 1489,
            "alert_name": "demo-name",
            "levels": ["critical", "mid"],
            "size": 999,
            "sort": "alert_id",
        })
        self.assertIn("alert_id:1489", plan["query"])
        self.assertIn(r"alert_name:demo\-name", plan["query"])
        self.assertIn('(alert_level:"critical" OR alert_level:"mid")', plan["query"])
        self.assertIn("| sort by alert_id | fields ", plan["query"])
        self.assertNotIn("| limit ", plan["query"])
        self.assertEqual(plan["size"], 200)

    def test_build_query_issue_alert_is_constant(self) -> None:
        """本工具只服务"已触发告警"，issue_alert:true 是恒定条件，不再有开关。"""
        self.assertIn("'issue_alert':true", self.plan({})["query"])
        self.assertIn("'issue_alert':true", self.plan({"include_recovery": True})["query"])

    def test_build_query_include_recovery_drops_only_recovery_clause(self) -> None:
        plan = self.plan({"include_recovery": True})
        self.assertNotIn("NOT 'is_recovery':true", plan["query"])

    def test_build_query_entity_fields_accepts_comma_string(self) -> None:
        plan = self.plan({"entity_fields": "result.hostname,result.src_ip"})
        self.assertEqual(plan["entity_fields"], ["result.hostname", "result.src_ip"])
        self.assertIn("'result.hostname', 'result.src_ip',", plan["query"])

    def test_build_query_rejects_unknown_level(self) -> None:
        built = self.service.build_history_query({"levels": ["bogus"]})
        self.assertIn("error", built)
        self.assertEqual(built["error"]["error_code"], "INVALID_PARAM_VALUE")

    # ---- alert_name 的字面量转义 ----

    def test_escape_spl_term_escapes_ascii_punct_only(self) -> None:
        """ASCII 非字母数字一律前置反斜杠；汉字/全角标点原样保留。"""
        build = self.service.escape_spl_term
        # 纯字母数字汉字 → 不动
        self.assertEqual(build("交换机_华为S12700_高级别事件告警"), r"交换机\_华为S12700\_高级别事件告警")
        self.assertEqual(build("RDP Brute Force Attack"), r"RDP\ Brute\ Force\ Attack")
        # 用户给的 env2 真实样例：`K8s_kube-dns / CoreDNS_转发错误`
        self.assertEqual(
            build("K8s_kube-dns / CoreDNS_转发错误"),
            r"K8s\_kube\-dns\ \/\ CoreDNS\_转发错误",
        )
        # 各种会破坏语句的字符
        self.assertEqual(build("[内置监控]"), r"\[内置监控\]")
        self.assertEqual(build("a(b)c"), r"a\(b\)c")
        self.assertEqual(build("a|b:c"), r"a\|b\:c")
        self.assertEqual(build("a.b,c"), r"a\.b\,c")
        self.assertEqual(build('a"b'), r'a\"b')
        self.assertEqual(build("a\\b"), r"a\\b")
        self.assertEqual(build("a!b<c>d"), r"a\!b\<c\>d")

    def test_escape_spl_term_keeps_star_when_wildcard(self) -> None:
        build = self.service.escape_spl_term
        # 默认（精确匹配）里 `*` 是字面量，必须转义
        self.assertEqual(build("交换机*"), r"交换机\*")
        # keep_wildcard=True 时 `*` 保留通配语义，其余照旧转义
        self.assertEqual(build("交换机*", keep_wildcard=True), "交换机*")
        self.assertEqual(build("*Brute Force*", keep_wildcard=True), r"*Brute\ Force*")
        self.assertEqual(build("[内置监控]*", keep_wildcard=True), r"\[内置监控\]*")
        self.assertEqual(build("*攻击*", keep_wildcard=True), "*攻击*")

    def test_name_filter_exact_match_uses_index_clause(self) -> None:
        built = self.service.build_history_name_filter("交换机")
        self.assertEqual(built["value"]["clause"], "alert_name:交换机")
        self.assertNotIn("stage", built["value"])

    def test_name_filter_escapes_real_world_name(self) -> None:
        """env2 上真实存在的告警名，必须转义成不带引号的索引子句。"""
        built = self.service.build_history_name_filter("K8s_kube-dns / CoreDNS_转发错误")
        self.assertEqual(
            built["value"]["clause"],
            r"alert_name:K8s\_kube\-dns\ \/\ CoreDNS\_转发错误",
        )

    def test_name_filter_wildcard_stays_in_main_query(self) -> None:
        """通配不再走 `| where like` 管道，而是留在主查询里吃索引。"""
        built = self.service.build_history_name_filter("交换机*")
        self.assertEqual(built["value"]["clause"], "alert_name:交换机*")
        query = self.plan({"alert_name": "交换机*"})["query"]
        self.assertNotIn("| where like", query)
        self.assertIn("alert_name:交换机*", query)

    def test_name_filter_star_only_means_no_filter(self) -> None:
        """用户直觉上会传 * 占位，必须等价于不过滤，而不是匹配字面星号（否则静默返回 0 条）。"""
        for raw in ("*", "**", "", "   ", None):
            built = self.service.build_history_name_filter(raw)
            self.assertEqual(built["value"]["clause"], "", raw)

    def test_name_filter_escapes_instead_of_rejecting(self) -> None:
        """`"` 与 `\\` 以前被拒，实测 `\\"` / `\\\\` 都能当字面量用，改为转义。"""
        self.assertEqual(self.service.build_history_name_filter('a"b')["value"]["clause"], r'alert_name:a\"b')
        self.assertEqual(self.service.build_history_name_filter("a\\b")["value"]["clause"], r"alert_name:a\\b")

    def test_name_filter_wildcard_keeps_spaces_escaped(self) -> None:
        """含空格的名字走通配时靠 `\\ ` 保住空格，空格不会再切碎语句。"""
        query = self.plan({"alert_name": "*Brute Force*"})["query"]
        self.assertIn(r"alert_name:*Brute\ Force*", query)
        self.assertIn("| sort by -timestamp", query)

    def test_build_query_never_uses_where_like(self) -> None:
        """回归：like() 是管道过滤、不走索引，任何 alert_name 写法都不该再产生它。"""
        for raw in ("交换机", "交换机*", "*攻击*", "[内置监控]*", "RDP Brute Force Attack"):
            self.assertNotIn("| where like", self.plan({"alert_name": raw})["query"], raw)

    def test_resolve_history_sort_falls_back(self) -> None:
        self.assertEqual(self.service.resolve_history_sort("alert_level"), "alert_level")
        self.assertEqual(self.service.resolve_history_sort("-value"), "-value")
        self.assertEqual(self.service.resolve_history_sort("drop table"), "-timestamp")
        self.assertEqual(self.service.resolve_history_sort(None), "-timestamp")

    def test_resolve_bounded_int(self) -> None:
        self.assertEqual(self.service.resolve_bounded_int(None, 20, 1, 200), 20)
        self.assertEqual(self.service.resolve_bounded_int("0", 20, 1, 200), 1)
        self.assertEqual(self.service.resolve_bounded_int("999", 20, 1, 200), 200)
        self.assertEqual(self.service.resolve_bounded_int("abc", 20, 1, 200), 20)
        self.assertEqual(self.service.resolve_bounded_int(True, 20, 1, 200), 20)

    # ---- 字段回退链 ----

    def test_normalize_triggered_row(self) -> None:
        plan = self.plan({})
        item = self.service.normalize_history_row(TRIGGERED_ROW, plan)
        self.assertEqual(item["alert_name"], "交换机_华为S12700_高级别事件告警")
        self.assertEqual(item["alert_id"], 75)
        self.assertEqual(item["alert_history_id"], "75_1790682665059_0")
        self.assertEqual(item["trigger_time"], "2026-09-29T19:51:05+08:00")
        self.assertEqual(item["trigger_time_ms"], 1790682665059)
        self.assertEqual(item["level"], "high")
        self.assertEqual(item["value"], 64)
        self.assertEqual(item["description"], "计数大于20")
        self.assertEqual(item["description_source"], "strategy_trigger_desc")
        self.assertFalse(item["is_recovery"])
        self.assertNotIn("search_url", item)

    def test_normalize_row_falls_back_to_notification_text(self) -> None:
        plan = self.plan({})
        item = self.service.normalize_history_row(SPARSE_ROW, plan)
        self.assertEqual(item["alert_name"], "交换机_华为S12700_错误告警")
        self.assertEqual(item["alert_id"], 74)
        self.assertEqual(item["description"], "告警名称: 交换机_华为S12700_错误告警 告警级别：高")
        self.assertEqual(item["description_source"], "notification_text")
        self.assertIsNone(item["value"])

    def test_normalize_row_without_name_uses_alert_id(self) -> None:
        plan = self.plan({})
        row = {"timestamp": 1, "is_recovery": "false"}
        item = self.service.normalize_history_row(row, plan)
        self.assertIsNone(item["alert_name"])
        self.assertIsNone(item["alert_id"])

        row_with_id = {"timestamp": 1, "is_recovery": "false", "result.alert_id": 9}
        item_with_id = self.service.normalize_history_row(row_with_id, plan)
        self.assertEqual(item_with_id["alert_name"], "alert_id=9")

    def test_normalize_row_trigger_time_falls_back_to_exec_time(self) -> None:
        plan = self.plan({})
        row = {"alert_name": "x", "is_recovery": "false", "result.exec_time": 1790682675420}
        item = self.service.normalize_history_row(row, plan)
        self.assertEqual(item["trigger_time_ms"], 1790682675420)

    def test_normalize_row_marks_recovery_by_level(self) -> None:
        plan = self.plan({"include_recovery": True})
        item = self.service.normalize_history_row(RECOVERY_ROW, plan)
        self.assertEqual(item["level"], "no_alert")
        self.assertTrue(item["is_recovery"])

    def test_normalize_row_includes_search_url_when_requested(self) -> None:
        plan = self.plan({"include_search_url": True})
        item = self.service.normalize_history_row(TRIGGERED_ROW, plan)
        self.assertEqual(item["search_url"], "http://rizhiyi.com/search/?title=demo")

    # ---- 实体识别 ----

    def test_entities_prefer_segmentation_value(self) -> None:
        entities, source = self.service.resolve_history_entities(
            SEGMENTED_ROW, ["result.appname", "result.ip"]
        )
        self.assertEqual(source, "segmentation_value")
        self.assertEqual(entities["json.URL"], "/api/v1/orders")
        self.assertEqual(entities["result.appname"], "order-service")
        self.assertEqual(entities["result.ip"], "10.0.1.13")

    def test_entities_segmentation_uses_result_prefixed_fields(self) -> None:
        # 只有 result.* 三个字段、没有扁平字段时，分段实体依然能取到。
        row = {
            "result.is_segmentation": True,
            "result.segmentation_field": "json.DST_IP",
            "result.segmentation_specify_value": "10.0.1.99",
        }
        entities, source = self.service.resolve_history_entities(row, ["result.ip"])
        self.assertEqual(source, "segmentation_value")
        self.assertEqual(entities, {"json.DST_IP": "10.0.1.99"})

    def test_entities_segmentation_flag_without_value_falls_through(self) -> None:
        # 有标记没值 → 不产出分段实体，且 appname=alert_record 无意义 → 落空。
        entities, source = self.service.resolve_history_entities(
            SEGMENTED_NO_VALUE_ROW, ["result.appname", "result.ip"]
        )
        self.assertEqual((entities, source), ({}, "none"))

    def test_entity_candidates_include_segmentation_field_name(self) -> None:
        # 实体落空时，分段字段名（appname）应作为候选字段给出，引导调用方换字段下钻。
        candidates = self.service.collect_entity_candidates([SEGMENTED_NO_VALUE_ROW])
        self.assertIn("appname", candidates)

    def test_entities_legacy_flat_segmentation_fields(self) -> None:
        entities, source = self.service.resolve_history_entities(LEGACY_SEGMENTED_ROW, ["result.ip"])
        self.assertEqual(source, "segmentation_value")
        self.assertEqual(entities, {"src_ip": "10.0.1.99"})

    def test_entities_from_entity_fields(self) -> None:
        row = {
            key: value
            for key, value in SEGMENTED_ROW.items()
            if key not in ("result.segmentation_specify_value", "segmentation_value")
        }
        entities, source = self.service.resolve_history_entities(row, ["result.ip", "result.hostname"])
        self.assertEqual(source, "entity_fields")
        self.assertEqual(entities, {"result.ip": "10.0.1.13"})

    def test_entities_accepts_bare_field_name_with_result_prefix(self) -> None:
        row = {
            key: value
            for key, value in SEGMENTED_ROW.items()
            if key not in ("result.segmentation_specify_value", "segmentation_value")
        }
        entities, source = self.service.resolve_history_entities(row, ["ip"])
        self.assertEqual(source, "entity_fields")
        self.assertEqual(entities, {"result.ip": "10.0.1.13"})

    def test_entities_skip_meaningless_appname(self) -> None:
        entities, source = self.service.resolve_history_entities(
            TRIGGERED_ROW, ["appname", "ip"]
        )
        self.assertEqual(entities, {})
        self.assertEqual(source, "none")

    def test_entities_fall_back_to_complex_value(self) -> None:
        row = dict(SPL_STAT_ROW)
        row["result.result.complex_value"] = "service:order-api, cnt:35"
        entities, source = self.service.resolve_history_entities(row, ["result.ip"])
        self.assertEqual(source, "complex_value")
        self.assertEqual(entities, {"service": "order-api"})

    def test_entities_none_when_nothing_matches(self) -> None:
        entities, source = self.service.resolve_history_entities(TRIGGERED_ROW, ["result.ip"])
        self.assertEqual((entities, source), ({}, "none"))

    # ---- 描述 / 文本处理 ----

    def test_strip_html_text(self) -> None:
        self.assertEqual(
            self.service.strip_html_text("<b>a</b>&nbsp;&lt;c&gt;  d"),
            "a <c> d",
        )
        self.assertEqual(self.service.strip_html_text(None), "")

    def test_truncate_text(self) -> None:
        self.assertEqual(self.service.truncate_text("abcdef", 3), "abc")
        self.assertEqual(self.service.truncate_text("abc", 10), "abc")

    # ---- 聚合输出 ----

    def test_normalize_history_aggregates(self) -> None:
        plan = self.plan({"size": 2})
        rows = [TRIGGERED_ROW, SPL_STAT_ROW, SPL_STAT_ROW]
        payload = self.service.normalize_history(rows, plan, 10)
        self.assertEqual(payload["total"], 10)
        self.assertEqual(payload["returned"], 3)
        self.assertTrue(payload["has_more"])
        self.assertEqual(payload["level_counts"], {"high": 1, "critical": 2})
        self.assertEqual(payload["alert_counts"][0], {
            "alert_id": 1489,
            "alert_name": "服务调用报错-示例zyt",
            "count": 2,
        })
        self.assertIn("entity_candidates", payload)
        self.assertIn("service", payload["entity_candidates"])
        self.assertNotIn("cnt", payload["entity_candidates"])
        # 不再回显入参 entity_fields，只保留真正新增的 entity_candidates（避免两者混淆）
        self.assertNotIn("entity_fields", payload)
        self.assertTrue(any("未携带实体信息" in warning for warning in payload["warnings"]))

    def test_normalize_history_has_more_false_on_last_page(self) -> None:
        plan = self.plan({"size": 50, "page": 0})
        payload = self.service.normalize_history([TRIGGERED_ROW], plan, 1)
        self.assertFalse(payload["has_more"])

    def test_normalize_history_warns_on_empty_window(self) -> None:
        plan = self.plan({})
        payload = self.service.normalize_history([], plan, 0)
        self.assertEqual(payload["alerts"], [])
        self.assertTrue(any("没有命中的已触发告警" in warning for warning in payload["warnings"]))

    def test_extract_history_rows_and_total(self) -> None:
        data = {"results": {"total_hits": 7, "sheets": {"rows": [{"a": 1}, "skip"]}}}
        self.assertEqual(self.service.extract_history_rows(data), [{"a": 1}])
        self.assertEqual(self.service.extract_history_total(data), 7)
        self.assertEqual(self.service.extract_history_rows(None), [])
        self.assertIsNone(self.service.extract_history_total({"results": {}}))

    def test_format_history_time_timezone(self) -> None:
        self.assertEqual(
            self.service.format_history_time(1790682665059, "Asia/Shanghai"),
            "2026-09-29T19:51:05+08:00",
        )
        self.assertEqual(
            self.service.format_history_time(1790682665059, "UTC"),
            "2026-09-29T11:51:05+00:00",
        )
        self.assertIsNone(self.service.format_history_time(None, "Asia/Shanghai"))
        self.assertEqual(self.service.resolve_history_timezone("bogus/zone"), "Asia/Shanghai")


if __name__ == "__main__":
    unittest.main()
