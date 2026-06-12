from __future__ import annotations

import asyncio
import itertools
import math
import re
from collections import Counter
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from .types import ApiResponse

RequestJson = Callable[..., Awaitable[ApiResponse[dict[str, Any]]]]

_DURATION_RE = re.compile(r"^([+-])?(\d+)([smhdw])$")
_NUMBER_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


class LogToolsBusinessService:
    def __init__(self, request_json: RequestJson) -> None:
        self._request_json = request_json

    async def execute_log_reduce_pattern(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str = "yotta",
        pattern_options: dict[str, Any] | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        options = pattern_options or {}
        response = await self._request_json(
            "/api/v3/search/logreduce/",
            params={
                "query": query,
                "time_range": time_range,
                "index_name": index_name,
                "mask_url": True,
                "initial_dist": str(options.get("initial_dist", "0.01")),
                "alpha": str(options.get("alpha", "1.8")),
                "multi_align_threshold": str(options.get("multi_align_threshold", "0.1")),
                "pattern_discover_align_threshold": str(options.get("pattern_discover_align_threshold", "0.05")),
                "find_cluster_align_threshold": str(options.get("find_cluster_align_threshold", "0.2")),
                "stop_threshold": str(options.get("stop_threshold", "0.5")),
            },
        )
        if response.error or response.data is None:
            return response
        return ApiResponse(
            status=response.status,
            data=response.data,
            message="日志聚类分析任务提交成功",
        )

    async def execute_log_reduce_preview(
        self,
        *,
        sid: str,
        max_retries: int = 10,
        retry_interval_ms: int = 5000,
    ) -> ApiResponse[dict[str, Any]]:
        last_response: ApiResponse[dict[str, Any]] | None = None
        retries = max(1, max_retries)
        wait_seconds = max(0, retry_interval_ms) / 1000

        for attempt in range(retries):
            response = await self._request_json(
                "/api/v3/search/preview/logreduce/",
                params={"sid": sid},
            )
            last_response = response
            if response.error or response.data is None:
                return response

            data = response.data
            job_status = str(data.get("job_status") or "").upper()
            if job_status in {"COMPLETED", "FAILED"} or self._extract_log_reduce_patterns(data):
                patterns = self._extract_log_reduce_patterns(data)
                self._strip_cluster_raw_fields(patterns)
                return ApiResponse(
                    status=response.status,
                    data={
                        "sid": data.get("sid") or sid,
                        "job_status": data.get("job_status"),
                        "total_hits": self._coerce_int(
                            self._dig(data, ["result", "total_hits"]),
                            default=0,
                            minimum=0,
                        ),
                        "result": patterns,
                    },
                    message="日志聚类结果获取成功" if job_status != "FAILED" else "日志聚类任务失败",
                )

            if attempt < retries - 1 and wait_seconds > 0:
                await asyncio.sleep(wait_seconds)

        if last_response is not None and last_response.data is not None:
            data = last_response.data
            return ApiResponse(
                status=last_response.status,
                error="聚类任务未完成",
                error_code="LOG_REDUCE_TIMEOUT",
                suggestion="请增大 max_retries 或 retry_interval 后重试。",
                retryable=True,
                details={"sid": sid, "job_status": data.get("job_status")},
                message="在指定重试次数内未拿到聚类完成结果",
            )

        return ApiResponse(
            error="聚类任务未完成",
            error_code="LOG_REDUCE_TIMEOUT",
            suggestion="请增大 max_retries 或 retry_interval 后重试。",
            retryable=True,
            message="在指定重试次数内未拿到聚类完成结果",
        )

    def analyze_pattern_results(
        self,
        patterns: list[dict[str, Any]],
        total_hits: int = 0,
        limit: int = 20,
    ) -> dict[str, Any]:
        analyzed: list[dict[str, Any]] = []
        for index, pattern in enumerate(patterns):
            count = self._coerce_int(pattern.get("count"), default=0, minimum=0)
            timeline_rows = self._extract_timeline_rows(pattern)
            counts = [self._coerce_float(item.get("count"), default=0.0) for item in timeline_rows]
            activity_ratio = (len([item for item in counts if item > 0]) / len(counts)) if counts else 0.0
            burstiness = self._safe_divide(self._stddev(counts), self._mean(counts)) if counts else 0.0
            periodicity = self._detect_periodicity(counts)
            anomaly_points = self._detect_anomalies_zscore(counts, 2.0)
            significance = min(
                1.0,
                (self._safe_divide(count, total_hits) * 0.4 if total_hits > 0 else 0.0)
                + min(activity_ratio, 1.0) * 0.2
                + min(burstiness / 3, 1.0) * 0.2
                + min(periodicity, 1.0) * 0.1
                + min(len(anomaly_points) / max(len(counts), 1), 1.0) * 0.1,
            )
            analyzed.append(
                {
                    "id": pattern.get("id", index),
                    "pattern": pattern.get("pattern_string") or pattern.get("pattern") or pattern.get("name"),
                    "count": count,
                    "coverage": round(self._safe_divide(count, total_hits), 6) if total_hits > 0 else 0.0,
                    "level": pattern.get("level"),
                    "temporal_analysis": {
                        "bucket_count": len(counts),
                        "active_buckets": len([item for item in counts if item > 0]),
                        "activity_ratio": round(activity_ratio, 6),
                        "burstiness": round(burstiness, 6),
                        "periodicity_score": round(periodicity, 6),
                    },
                    "anomaly_analysis": {
                        "has_anomalies": bool(anomaly_points),
                        "anomaly_count": len(anomaly_points),
                        "anomaly_points": anomaly_points[:5],
                    },
                    "classification": self._classify_pattern(activity_ratio, burstiness, periodicity, bool(anomaly_points)),
                    "significance_score": round(significance, 6),
                }
            )

        analyzed.sort(key=lambda item: item["significance_score"], reverse=True)
        top_patterns = analyzed[: max(1, limit)]
        classification_counts = Counter(item["classification"] for item in analyzed)
        return {
            "total_patterns": len(patterns),
            "total_hits": total_hits,
            "patterns": top_patterns,
            "analysis_summary": {
                "classification_counts": dict(classification_counts),
                "top_significance": top_patterns[0]["significance_score"] if top_patterns else 0.0,
                "high_significance_patterns": len([item for item in analyzed if item["significance_score"] >= 0.7]),
            },
        }

    async def execute_trend_summary(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str = "yotta",
        bucket: str | None = None,
        metric_field: str | None = None,
        limit_peaks: int = 3,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._timechart_query(
            query=query,
            time_range=time_range,
            index_name=index_name,
            bucket=bucket,
            metric_field=metric_field,
        )
        if response.error or response.data is None:
            return response
        return self.execute_trend_summary_with_data(
            response.data["series"],
            limit_peaks=limit_peaks,
            status=response.status,
            message="趋势分析完成",
        )

    def execute_trend_summary_with_data(
        self,
        series_input: Any,
        *,
        limit_peaks: int = 3,
        status: int | None = 200,
        message: str = "趋势分析完成（数据复用）",
    ) -> ApiResponse[dict[str, Any]]:
        series = self._normalize_time_series_input(series_input)
        if not series:
            return ApiResponse(error="无数据", message="未找到符合条件的时间序列数据")

        values = [item["value"] for item in series]
        slope, intercept = self._linear_regression(values)
        change_rate = 0.0
        if len(values) > 1 and abs(values[0]) > 1e-9:
            change_rate = (values[-1] - values[0]) / values[0]
        peaks = self._detect_peaks(values, max(1, limit_peaks))
        anomalies = self._detect_anomalies_zscore(values, 2.0)

        return ApiResponse(
            status=status,
            data={
                "series": series,
                "slope": slope,
                "intercept": intercept,
                "changeRate": change_rate,
                "peaks": [
                    {
                        "index": peak["index"],
                        "value": peak["value"],
                        "timestamp": series[peak["index"]]["timestamp"],
                    }
                    for peak in peaks
                ],
                "anomalies": [
                    {
                        "index": anomaly["index"],
                        "value": anomaly["value"],
                        "threshold": anomaly["threshold"],
                        "reason": anomaly["reason"],
                        "timestamp": series[anomaly["index"]]["timestamp"],
                    }
                    for anomaly in anomalies
                ],
                "summary": self._generate_trend_summary(values, slope, change_rate),
            },
            message=message,
        )

    async def execute_anomaly_points(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str = "yotta",
        bucket: str | None = None,
        metric_field: str | None = None,
        method: str = "zscore",
        sensitivity: float = 3,
        min_support: int = 0,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._timechart_query(
            query=query,
            time_range=time_range,
            index_name=index_name,
            bucket=bucket,
            metric_field=metric_field,
        )
        if response.error or response.data is None:
            return response
        return self.execute_anomaly_points_with_data(
            response.data["series"],
            method=method,
            sensitivity=sensitivity,
            min_support=min_support,
            status=response.status,
            message="异常检测完成",
        )

    def execute_anomaly_points_with_data(
        self,
        series_input: Any,
        *,
        method: str = "zscore",
        sensitivity: float = 3,
        min_support: int = 0,
        status: int | None = 200,
        message: str = "异常检测完成（数据复用）",
    ) -> ApiResponse[dict[str, Any]]:
        series = self._normalize_time_series_input(series_input)
        if not series:
            return ApiResponse(error="无数据", message="未找到符合条件的时间序列数据")

        values = [item["value"] for item in series]
        if method == "iqr":
            anomalies = self._detect_anomalies_iqr(values, sensitivity)
        else:
            anomalies = self._detect_anomalies_zscore(values, sensitivity)

        if min_support > 0:
            anomalies = [item for item in anomalies if item["value"] >= min_support]

        return ApiResponse(
            status=status,
            data={
                "anomalies": [
                    {
                        "index": item["index"],
                        "value": item["value"],
                        "threshold": item["threshold"],
                        "reason": item["reason"],
                        "timestamp": series[item["index"]]["timestamp"],
                    }
                    for item in anomalies
                ],
                "method": method,
                "threshold": sensitivity,
                "series": series,
            },
            message=message,
        )

    async def execute_period_compare(
        self,
        *,
        query: str,
        time_range_a: str,
        time_range_b: str,
        index_name: str = "yotta",
        bucket: str | None = None,
        compare_fields: list[str] | None = None,
        topk: int = 10,
        metric_field: str | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        response_a, response_b = await asyncio.gather(
            self._timechart_query(
                query=query,
                time_range=time_range_a,
                index_name=index_name,
                bucket=bucket,
                metric_field=metric_field,
            ),
            self._timechart_query(
                query=query,
                time_range=time_range_b,
                index_name=index_name,
                bucket=bucket,
                metric_field=metric_field,
            ),
        )
        if response_a.error or response_a.data is None:
            return response_a
        if response_b.error or response_b.data is None:
            return response_b

        return await self.execute_period_compare_with_data(
            response_a.data["series"],
            response_b.data["series"],
            query=query,
            time_range_a=time_range_a,
            time_range_b=time_range_b,
            index_name=index_name,
            compare_fields=compare_fields or [],
            topk=topk,
            status=max(response_a.status or 200, response_b.status or 200),
            message="时间段对比分析完成",
        )

    async def execute_period_compare_with_data(
        self,
        series_a_input: Any,
        series_b_input: Any,
        *,
        query: str = "*",
        time_range_a: str | None = None,
        time_range_b: str | None = None,
        index_name: str = "yotta",
        compare_fields: list[str] | None = None,
        topk: int = 10,
        status: int | None = 200,
        message: str = "时间段对比分析完成（数据复用）",
    ) -> ApiResponse[dict[str, Any]]:
        series_a = self._normalize_time_series_input(series_a_input)
        series_b = self._normalize_time_series_input(series_b_input)
        if not series_a or not series_b:
            return ApiResponse(error="数据不完整", message="无法获取完整的时间段数据")

        values_a = [item["value"] for item in series_a]
        values_b = [item["value"] for item in series_b]
        field_differences: list[dict[str, Any]] = []
        if compare_fields:
            field_differences = await self._compare_fields(
                query=query,
                time_range_a=time_range_a or "",
                time_range_b=time_range_b or "",
                index_name=index_name,
                fields=compare_fields,
                topk=max(1, topk),
            )

        return ApiResponse(
            status=status,
            data={
                "period_a": self._build_period_metrics(series_a, values_a),
                "period_b": self._build_period_metrics(series_b, values_b),
                "differences": {
                    "total_change": sum(values_b) - sum(values_a),
                    "avg_change": self._mean(values_b) - self._mean(values_a),
                    "max_change": max(values_b) - max(values_a),
                    "min_change": min(values_b) - min(values_a),
                },
                "field_differences": field_differences[: max(1, topk)],
            },
            message=message,
        )

    async def execute_correlation_analysis(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str = "yotta",
        fields: list[str] | None = None,
        mode: str = "auto",
        bucket: str | None = None,
        max_lag: int = 3,
        min_support: float = 0.05,
        min_confidence: float = 0.6,
        sample_size: int = 500,
        limit: int = 20,
        input_rows: list[dict[str, Any]] | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        target_fields = [field for field in (fields or []) if field]
        if len(target_fields) < 2:
            return ApiResponse(error="字段不足", message="需要至少 2 个字段进行关联性分析")

        rows = [row for row in (input_rows or []) if isinstance(row, dict)]
        if not rows:
            sample_response = await self._search_rows(
                query=query,
                time_range=time_range,
                index_name=index_name,
                size=max(1, sample_size),
                fields=target_fields,
            )
            if sample_response.error or sample_response.data is None:
                return sample_response
            rows = sample_response.data["hits"]
        if not rows:
            return ApiResponse(error="无数据", message="未找到符合条件的数据")

        field_types = self._detect_correlation_field_types(rows, target_fields)
        resolved_mode = self._resolve_correlation_mode(mode, field_types)
        if "error" in resolved_mode:
            return ApiResponse(
                error="字段类型不匹配",
                message=resolved_mode["error"],
                details={"requested_mode": mode, "field_types": field_types},
            )

        if resolved_mode["mode"] == "lagged_pearson":
            return await self._execute_lagged_pearson(
                query=query,
                time_range=time_range,
                index_name=index_name,
                fields=target_fields,
                field_types=field_types,
                requested_mode=mode,
                bucket=bucket,
                max_lag=max_lag,
                limit=limit,
                sample_size=sample_size,
            )

        return self._execute_fp_growth(
            query=query,
            rows=rows,
            fields=target_fields,
            field_types=field_types,
            requested_mode=mode,
            min_support=min_support,
            min_confidence=min_confidence,
            limit=limit,
            sample_size=sample_size,
        )

    async def execute_root_cause_suggestions(
        self,
        *,
        query: str,
        anomaly_window: str,
        baseline_window: str,
        index_name: str = "yotta",
        candidate_fields: list[str] | None = None,
        significance_threshold: float = 0.1,
        topk: int = 5,
        field_value_limit: int = 20,
        sample_size: int = 300,
        slice_max_depth: int = 2,
        min_slice_support: float = 0.05,
        min_slice_lift: float = 2,
        input_rows: list[dict[str, Any]] | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        anomaly_rows = [row for row in (input_rows or []) if isinstance(row, dict)]
        baseline_sample_response = await self._search_rows(
            query=query,
            time_range=baseline_window,
            index_name=index_name,
            size=max(1, sample_size),
        )
        if baseline_sample_response.error or baseline_sample_response.data is None:
            return baseline_sample_response
        baseline_rows = baseline_sample_response.data["hits"]

        if not anomaly_rows:
            anomaly_sample_response = await self._search_rows(
                query=query,
                time_range=anomaly_window,
                index_name=index_name,
                size=max(1, sample_size),
            )
            if anomaly_sample_response.error or anomaly_sample_response.data is None:
                return anomaly_sample_response
            anomaly_rows = anomaly_sample_response.data["hits"]

        available_anomaly_fields = self._extract_row_fields(anomaly_rows)
        available_baseline_fields = self._extract_row_fields(baseline_rows)
        fields_to_analyze = [field for field in (candidate_fields or []) if field]
        if not fields_to_analyze:
            fields_to_analyze = self._select_root_cause_fields(
                baseline_fields=available_baseline_fields,
                anomaly_fields=available_anomaly_fields,
                limit=max(topk * 2, 6),
            )

        distribution_drift: list[dict[str, Any]] = []
        for field in fields_to_analyze:
            baseline_counts, anomaly_counts = await asyncio.gather(
                self._get_field_distribution(
                    query=query,
                    time_range=baseline_window,
                    index_name=index_name,
                    field=field,
                    limit=field_value_limit,
                ),
                self._get_field_distribution(
                    query=query,
                    time_range=anomaly_window,
                    index_name=index_name,
                    field=field,
                    limit=field_value_limit,
                ),
            )
            drift = self._analyze_field_distribution_drift(
                baseline_counts=baseline_counts,
                anomaly_counts=anomaly_counts,
                topk=max(1, min(field_value_limit, 10)),
            )
            if drift is None or drift["drift_score"] < significance_threshold:
                continue
            drift["field"] = field
            drift["hypothesis"] = self._generate_distribution_hypothesis(field, drift["changed_values"])
            distribution_drift.append(drift)
        distribution_drift.sort(key=lambda item: item["drift_score"], reverse=True)

        suspicious_slices = await self._mine_suspicious_slices(
            query=query,
            anomaly_window=anomaly_window,
            baseline_window=baseline_window,
            index_name=index_name,
            fields=fields_to_analyze,
            anomaly_rows=anomaly_rows,
            baseline_rows=baseline_rows,
            sample_size=sample_size,
            slice_max_depth=slice_max_depth,
            min_slice_support=min_slice_support,
            min_slice_lift=min_slice_lift,
            topk=topk,
        )

        anomaly_total, baseline_total = await asyncio.gather(
            self._get_exact_query_count(query=query, time_range=anomaly_window, index_name=index_name),
            self._get_exact_query_count(query=query, time_range=baseline_window, index_name=index_name),
        )
        return ApiResponse(
            status=200,
            data={
                "analyzed_fields": fields_to_analyze,
                "distribution_drift": distribution_drift[: max(1, topk)],
                "suspicious_slices": suspicious_slices[: max(1, topk)],
                "suggested_queries": self._generate_root_cause_queries(
                    query=query,
                    distribution_drift=distribution_drift,
                    suspicious_slices=suspicious_slices,
                ),
                "summary": self._generate_root_cause_summary(
                    query=query,
                    distribution_drift=distribution_drift,
                    suspicious_slices=suspicious_slices,
                    anomaly_total=anomaly_total,
                    baseline_total=baseline_total,
                ),
            },
            message="根因分析建议生成完成",
        )

    async def execute_trend_forecast(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str = "yotta",
        bucket: str | None = None,
        horizon: int = 12,
        method: str = "linear_regression",
        confidence: float = 0.95,
        metric_field: str | None = None,
        window: int = 10,
        alpha: float = 0.3,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._timechart_query(
            query=query,
            time_range=time_range,
            index_name=index_name,
            bucket=bucket,
            metric_field=metric_field,
        )
        if response.error or response.data is None:
            return response
        return self.execute_trend_forecast_with_data(
            response.data["series"],
            horizon=horizon,
            method=method,
            confidence=confidence,
            window=window,
            alpha=alpha,
            status=response.status,
            message="趋势预测完成",
        )

    def execute_trend_forecast_with_data(
        self,
        series_input: Any,
        *,
        horizon: int = 12,
        method: str = "linear_regression",
        confidence: float = 0.95,
        window: int = 10,
        alpha: float = 0.3,
        status: int | None = 200,
        message: str = "趋势预测完成（数据复用）",
    ) -> ApiResponse[dict[str, Any]]:
        series = self._normalize_time_series_input(series_input)
        if not series:
            return ApiResponse(error="无数据", message="未找到符合条件的时间序列数据")

        values = [item["value"] for item in series]
        resolved_horizon = max(1, horizon)
        if method == "moving_average":
            ma = self._simple_moving_average(values, max(1, window))
            result = {
                "forecast": [ma["forecast"] for _ in range(resolved_horizon)],
                "trend": ma["trend"],
            }
        elif method == "exponential_smoothing":
            es = self._exponential_smoothing(values, alpha=max(0.0, min(alpha, 1.0)), horizon=resolved_horizon)
            result = {
                "forecast": es["forecast"],
                "trend": es["trend"],
            }
        else:
            lr = self._linear_trend_forecast(values, resolved_horizon, confidence)
            result = {
                "forecast": lr["forecast"],
                "confidence_lower": lr["confidence_lower"],
                "confidence_upper": lr["confidence_upper"],
                "trend": lr["trend"],
                "r_squared": lr["r_squared"],
            }

        return ApiResponse(
            status=status,
            data={**result, "method": method, "series": series},
            message=message,
        )

    async def execute_anomaly_alert(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str = "yotta",
        bucket: str | None = None,
        method: str = "prediction_band",
        threshold: float = 3.0,
        alert_on: str = "both",
        min_anomaly_points: int = 3,
        forecast_horizon: int = 6,
        metric_field: str | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._timechart_query(
            query=query,
            time_range=time_range,
            index_name=index_name,
            bucket=bucket,
            metric_field=metric_field,
        )
        if response.error or response.data is None:
            return response
        return self.execute_anomaly_alert_with_data(
            response.data["series"],
            method=method,
            threshold=threshold,
            alert_on=alert_on,
            min_anomaly_points=min_anomaly_points,
            forecast_horizon=forecast_horizon,
            status=response.status,
            message="异常告警检测完成",
        )

    def execute_anomaly_alert_with_data(
        self,
        series_input: Any,
        *,
        method: str = "prediction_band",
        threshold: float = 3.0,
        alert_on: str = "both",
        min_anomaly_points: int = 3,
        forecast_horizon: int = 6,
        status: int | None = 200,
        message: str = "异常告警检测完成（数据复用）",
    ) -> ApiResponse[dict[str, Any]]:
        series = self._normalize_time_series_input(series_input)
        if not series:
            return ApiResponse(error="无数据", message="未找到符合条件的时间序列数据")

        values = [item["value"] for item in series]
        anomalies: list[dict[str, Any]] = []
        resolved_alert_on = alert_on if alert_on in {"upper", "lower", "both"} else "both"
        resolved_horizon = max(1, min(forecast_horizon, len(values)))

        if method == "prediction_band":
            forecast = self._linear_trend_forecast(values, resolved_horizon, 0.95)
            recent_values = values[-resolved_horizon:]
            for index, value in enumerate(recent_values):
                lower = forecast["confidence_lower"][index]
                upper = forecast["confidence_upper"][index]
                actual_index = len(values) - resolved_horizon + index
                if value < lower and resolved_alert_on in {"lower", "both"}:
                    anomalies.append(
                        {
                            "index": actual_index,
                            "value": value,
                            "threshold": lower,
                            "reason": f"值 {value} 低于预测区间下界 {lower:.2f}",
                        }
                    )
                elif value > upper and resolved_alert_on in {"upper", "both"}:
                    anomalies.append(
                        {
                            "index": actual_index,
                            "value": value,
                            "threshold": upper,
                            "reason": f"值 {value} 高于预测区间上界 {upper:.2f}",
                        }
                    )
        elif method == "adaptive":
            anomalies = self._detect_anomalies_iqr(values, threshold)
        else:
            anomalies = self._detect_anomalies_zscore(values, threshold)

        if method != "prediction_band":
            mean_value = self._mean(values)
            anomalies = [
                item
                for item in anomalies
                if (
                    resolved_alert_on == "both"
                    or (resolved_alert_on == "upper" and item["value"] > mean_value)
                    or (resolved_alert_on == "lower" and item["value"] < mean_value)
                )
            ]

        alert_triggered = len(anomalies) >= max(1, min_anomaly_points)
        return ApiResponse(
            status=status,
            data={
                "alert_triggered": alert_triggered,
                "anomaly_count": len(anomalies),
                "min_anomaly_points": min_anomaly_points,
                "alert_reasons": [item["reason"] for item in anomalies[:5]],
                "anomalies": [
                    {
                        "index": item["index"],
                        "value": item["value"],
                        "threshold": item["threshold"],
                        "reason": item["reason"],
                        "timestamp": series[item["index"]]["timestamp"],
                    }
                    for item in anomalies[:10]
                ],
                "method": method,
                "threshold": threshold,
                "alert_on": resolved_alert_on,
                "timestamps": [item["timestamp"] for item in series],
                "values": values,
                "series": series,
            },
            message=message,
        )

    async def _timechart_query(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str,
        bucket: str | None,
        metric_field: str | None,
    ) -> ApiResponse[dict[str, Any]]:
        bucket_used = bucket or self._choose_bucket(self._parse_duration_ms(time_range))[0]
        if metric_field:
            executed_query = f"{query or '*'} | timechart span={bucket_used} avg({metric_field}) as value"
            aggregation_type = "avg"
        else:
            executed_query = f"{query or '*'} | timechart span={bucket_used} count() as cnt"
            aggregation_type = "count"

        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": executed_query,
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": 100,
            },
        )
        if response.error or response.data is None:
            return response

        rows = self._extract_rows(response.data)
        return ApiResponse(
            status=response.status,
            data={
                "series": self._normalize_time_series_input(rows),
                "bucket_used": bucket_used,
                "query_executed": executed_query,
                "aggregation_type": aggregation_type,
                "metric_field": metric_field,
            },
            message="时间序列数据获取成功" if rows else "未找到符合条件的时间序列数据",
        )

    async def _search_rows(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str,
        size: int,
        fields: list[str] | None = None,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": query,
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": size,
            },
        )
        if response.error or response.data is None:
            return response

        hits = [row for row in self._extract_rows(response.data) if isinstance(row, dict)]
        if fields:
            projected_hits: list[dict[str, Any]] = []
            for row in hits:
                projected_hits.append({field: row[field] for field in fields if field in row})
            hits = projected_hits

        return ApiResponse(
            status=response.status,
            data={
                "hits": hits,
                "total": self._coerce_int(
                    self._dig(response.data, ["results", "total_hits"]),
                    default=len(hits),
                    minimum=0,
                ),
            },
            message="日志搜索成功",
        )

    async def _list_fields(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str,
    ) -> ApiResponse[dict[str, Any]]:
        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": query,
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": 0,
                "fields": True,
            },
        )
        if response.error or response.data is None:
            return response

        raw_fields = self._dig(response.data, ["results", "fields"])
        fields: list[dict[str, Any]] = []
        if isinstance(raw_fields, list):
            for item in raw_fields:
                if not isinstance(item, dict):
                    continue
                fields.append(
                    {
                        "name": item.get("name"),
                        "type": item.get("type") or "unknown",
                        "distinct_count": self._coerce_int(item.get("dc"), default=0, minimum=0),
                        "total": self._coerce_int(item.get("total"), default=0, minimum=0),
                    }
                )
        return ApiResponse(status=response.status, data={"fields": fields}, message="字段列表获取成功")

    async def _get_field_distribution(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str,
        field: str,
        limit: int,
    ) -> dict[str, int]:
        field_query = f"{query} | stats count by {field}" if query != "*" else f"* | stats count by {field}"
        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": field_query,
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": max(1, limit),
                "fields": True,
            },
        )
        if response.error or response.data is None:
            return {}

        distribution: dict[str, int] = {}
        for row in self._extract_rows(response.data)[: max(1, limit)]:
            if not isinstance(row, dict):
                continue
            value = row.get(field)
            if value in (None, ""):
                continue
            distribution[str(value)] = self._coerce_int(row.get("count"), default=0, minimum=0)
        return distribution

    async def _compare_fields(
        self,
        *,
        query: str,
        time_range_a: str,
        time_range_b: str,
        index_name: str,
        fields: list[str],
        topk: int,
    ) -> list[dict[str, Any]]:
        differences: list[dict[str, Any]] = []
        for field in fields:
            counts_a, counts_b = await asyncio.gather(
                self._get_field_distribution(
                    query=query,
                    time_range=time_range_a,
                    index_name=index_name,
                    field=field,
                    limit=max(20, topk),
                ),
                self._get_field_distribution(
                    query=query,
                    time_range=time_range_b,
                    index_name=index_name,
                    field=field,
                    limit=max(20, topk),
                ),
            )
            for item in self._calculate_distribution_differences(counts_a, counts_b, topk):
                differences.append(
                    {
                        "field": field,
                        "value": item["value"],
                        "count_a": item["baseline_count"],
                        "count_b": item["anomaly_count"],
                        "change": item["change_ratio"],
                        "jsd": item["jsd"],
                    }
                )

        differences.sort(key=lambda item: item["jsd"], reverse=True)
        return differences[: max(1, topk)]

    async def _execute_lagged_pearson(
        self,
        *,
        query: str,
        time_range: str,
        index_name: str,
        fields: list[str],
        field_types: list[dict[str, Any]],
        requested_mode: str,
        bucket: str | None,
        max_lag: int,
        limit: int,
        sample_size: int,
    ) -> ApiResponse[dict[str, Any]]:
        series_results = await asyncio.gather(
            *[
                self._timechart_query(
                    query=query,
                    time_range=time_range,
                    index_name=index_name,
                    bucket=bucket,
                    metric_field=field,
                )
                for field in fields
            ]
        )
        for response in series_results:
            if response.error or response.data is None:
                return response

        pair_results: list[dict[str, Any]] = []
        for left_index, left_field in enumerate(fields):
            for right_index in range(left_index + 1, len(fields)):
                right_field = fields[right_index]
                left_series = series_results[left_index].data["series"]
                right_series = series_results[right_index].data["series"]
                lag_scores = self._calculate_lagged_pearson_scores(left_series, right_series, max_lag)
                if not lag_scores:
                    continue
                sorted_scores = sorted(
                    lag_scores,
                    key=lambda item: (abs(item["correlation"]), item["aligned_points"]),
                    reverse=True,
                )
                best = sorted_scores[0]
                pair_results.append(
                    {
                        "kind": "lagged_pearson",
                        "field1": left_field,
                        "field2": right_field,
                        "best_lag": best["lag"],
                        "best_correlation": best["correlation"],
                        "best_alignment_points": best["aligned_points"],
                        "relationship": self._describe_lag_relationship(left_field, right_field, best["lag"]),
                        "lag_scores": sorted_scores,
                        "score": abs(best["correlation"]),
                    }
                )

        results = sorted(
            pair_results,
            key=lambda item: (abs(item["best_correlation"]), item["best_alignment_points"]),
            reverse=True,
        )[: max(1, limit)]
        if not results:
            return ApiResponse(
                error="数据不足",
                message="未能从时间序列中构造足够的对齐数据来计算 lagged Pearson 相关。",
            )

        return ApiResponse(
            status=max(response.status or 200 for response in series_results),
            data={
                "mode": "lagged_pearson",
                "requested_mode": requested_mode,
                "results": results,
                "summary": self._build_lagged_pearson_summary(results),
                "evidence": {
                    "field_types": field_types,
                    "bucket_used": series_results[0].data["bucket_used"],
                    "query_executed": [response.data["query_executed"] for response in series_results],
                    "sample_size": sample_size,
                    "max_lag": max_lag,
                    "warnings": [],
                },
            },
            message="关联性分析完成",
        )

    def _execute_fp_growth(
        self,
        *,
        query: str,
        rows: list[dict[str, Any]],
        fields: list[str],
        field_types: list[dict[str, Any]],
        requested_mode: str,
        min_support: float,
        min_confidence: float,
        limit: int,
        sample_size: int,
    ) -> ApiResponse[dict[str, Any]]:
        transactions = self._build_transactions_from_rows(rows, fields)
        if not transactions:
            return ApiResponse(error="无有效事务", message="样本中没有足够的离散字段值，无法进行 FP-Growth 分析。")

        min_support_count = max(1, math.ceil(len(transactions) * min_support))
        itemsets = self._mine_frequent_itemsets(
            transactions=transactions,
            min_support_count=min_support_count,
            max_pattern_size=min(len(fields), 4),
        )
        support_map = {self._serialize_itemset(item["items"]): item["support_count"] for item in itemsets}
        frequent_itemsets = [
            {
                "kind": "frequent_itemset",
                "items": item["items"],
                "support_count": item["support_count"],
                "support": item["support_count"] / len(transactions),
                "score": (item["support_count"] / len(transactions)) * len(item["items"]),
            }
            for item in itemsets
        ]
        rules = self._generate_association_rules(
            itemsets=itemsets,
            transaction_count=len(transactions),
            min_confidence=min_confidence,
            support_map=support_map,
        )
        results = sorted(rules + frequent_itemsets, key=lambda item: item.get("score", 0), reverse=True)[
            : max(1, limit)
        ]

        return ApiResponse(
            status=200,
            data={
                "mode": "fp_growth",
                "requested_mode": requested_mode,
                "results": results,
                "summary": self._build_fp_growth_summary(results, query),
                "evidence": {
                    "field_types": field_types,
                    "total_transactions": len(transactions),
                    "sample_size": sample_size,
                    "warnings": [] if itemsets else ["当前支持度阈值下未发现频繁项集，可尝试降低 min_support。"],
                },
            },
            message="关联性分析完成",
        )

    async def _mine_suspicious_slices(
        self,
        *,
        query: str,
        anomaly_window: str,
        baseline_window: str,
        index_name: str,
        fields: list[str],
        anomaly_rows: list[dict[str, Any]],
        baseline_rows: list[dict[str, Any]],
        sample_size: int,
        slice_max_depth: int,
        min_slice_support: float,
        min_slice_lift: float,
        topk: int,
    ) -> list[dict[str, Any]]:
        if not fields or not anomaly_rows:
            return []

        sampled_fields = fields[: max(4, min(len(fields), 6))]
        per_field_limit = 3
        min_sample_count = max(1, math.ceil(len(anomaly_rows) * min_slice_support))
        terms_by_field: dict[str, list[dict[str, str]]] = {}

        for field in sampled_fields:
            counts: Counter[str] = Counter()
            for row in anomaly_rows:
                for value in self._normalize_discrete_values(row.get(field)):
                    if self._should_skip_slice_value(value):
                        continue
                    counts[value] += 1
            terms = [
                {"field": field, "value": value}
                for value, count in counts.most_common(per_field_limit)
                if count >= min_sample_count
            ]
            if terms:
                terms_by_field[field] = terms

        candidates = self._generate_slice_candidates(terms_by_field, max_depth=max(1, min(slice_max_depth, 3)))
        if not candidates:
            return []

        anomaly_total, baseline_total = await asyncio.gather(
            self._get_exact_query_count(query=query, time_range=anomaly_window, index_name=index_name),
            self._get_exact_query_count(query=query, time_range=baseline_window, index_name=index_name),
        )
        if anomaly_total <= 0 or baseline_total <= 0:
            return []

        approximate_candidates = []
        for terms in candidates:
            anomaly_count = self._count_slice_matches(anomaly_rows, terms)
            baseline_count = self._count_slice_matches(baseline_rows, terms)
            anomaly_support = anomaly_count / max(len(anomaly_rows), 1)
            baseline_support = baseline_count / max(len(baseline_rows), 1)
            lift = self._calculate_lift(anomaly_support, baseline_support, len(baseline_rows))
            score = self._calculate_slice_score(anomaly_support, lift, len(terms))
            if anomaly_support >= min_slice_support and lift >= min_slice_lift:
                approximate_candidates.append(
                    {
                        "terms": terms,
                        "score": score,
                    }
                )

        exact_slices: list[dict[str, Any]] = []
        for candidate in sorted(approximate_candidates, key=lambda item: item["score"], reverse=True)[
            : max(10, topk * 3)
        ]:
            terms = candidate["terms"]
            slice_query = self._build_slice_query(query, terms)
            exact_anomaly, exact_baseline = await asyncio.gather(
                self._get_exact_query_count(query=slice_query, time_range=anomaly_window, index_name=index_name),
                self._get_exact_query_count(query=slice_query, time_range=baseline_window, index_name=index_name),
            )
            anomaly_support = exact_anomaly / anomaly_total
            baseline_support = exact_baseline / baseline_total
            lift = self._calculate_lift(anomaly_support, baseline_support, baseline_total)
            if anomaly_support < min_slice_support or lift < min_slice_lift:
                continue
            exact_slices.append(
                {
                    "slice": {term["field"]: term["value"] for term in terms},
                    "slice_terms": [f'{term["field"]}={term["value"]}' for term in terms],
                    "depth": len(terms),
                    "anomaly_count": exact_anomaly,
                    "baseline_count": exact_baseline,
                    "anomaly_support": anomaly_support,
                    "baseline_support": baseline_support,
                    "lift": lift,
                    "score": self._calculate_slice_score(anomaly_support, lift, len(terms)),
                    "query": slice_query,
                }
            )

        unique: dict[str, dict[str, Any]] = {}
        for item in exact_slices:
            unique.setdefault(item["query"], item)
        return sorted(unique.values(), key=lambda item: item["score"], reverse=True)[: max(1, topk)]

    async def _get_exact_query_count(self, *, query: str, time_range: str, index_name: str) -> int:
        response = await self._request_json(
            "/api/v3/search/sheets/",
            params={
                "query": f"{query} | stats count() as count",
                "time_range": time_range,
                "index_name": index_name,
                "page": 0,
                "size": 1,
            },
        )
        if response.error or response.data is None:
            return 0
        rows = self._extract_rows(response.data)
        if rows and isinstance(rows[0], dict):
            return self._coerce_int(rows[0].get("count"), default=0, minimum=0)
        return 0

    def _normalize_time_series_input(self, input_value: Any) -> list[dict[str, Any]]:
        if isinstance(input_value, dict):
            for key in ("series", "points", "source_series"):
                candidate = input_value.get(key)
                if isinstance(candidate, list):
                    return self._normalize_time_series_input(candidate)
            data_candidate = input_value.get("data")
            if isinstance(data_candidate, dict):
                return self._normalize_time_series_input(data_candidate)
            if isinstance(input_value.get("timestamps"), list) and isinstance(input_value.get("values"), list):
                timestamps = input_value["timestamps"]
                values = input_value["values"]
                normalized = []
                for index, timestamp in enumerate(timestamps):
                    value = self._coerce_float(values[index] if index < len(values) else 0, default=0.0)
                    normalized.append(
                        {
                            "timestamp": str(timestamp),
                            "value": value,
                            "count": value,
                        }
                    )
                return normalized

        if not isinstance(input_value, list):
            return []

        normalized: list[dict[str, Any]] = []
        for item in input_value:
            if not isinstance(item, dict):
                continue
            timestamp = (
                item.get("timestamp")
                or item.get("_time")
                or item.get("time")
                or item.get("ts")
                or item.get("_timestamp")
            )
            if timestamp in (None, ""):
                continue
            value = self._coerce_float(
                item.get("value", item.get("count", item.get("cnt", 0))),
                default=0.0,
            )
            normalized.append(
                {
                    "timestamp": str(timestamp),
                    "value": value,
                    "count": self._coerce_float(item.get("count", value), default=value),
                }
            )
        return normalized

    def _extract_rows(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        rows = self._dig(data, ["results", "sheets", "rows"])
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
        results = data.get("results")
        if isinstance(results, list):
            return [row for row in results if isinstance(row, dict)]
        hits = data.get("hits")
        if isinstance(hits, list):
            return [row for row in hits if isinstance(row, dict)]
        return []

    def _extract_log_reduce_patterns(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        result_body = self._dig(data, ["result", "body"])
        if isinstance(result_body, list):
            return [item for item in result_body if isinstance(item, dict)]
        clusters = self._dig(data, ["tree_layer", "clusters"])
        if isinstance(clusters, list):
            return [item for item in clusters if isinstance(item, dict)]
        direct = data.get("result")
        if isinstance(direct, list):
            return [item for item in direct if isinstance(item, dict)]
        return []

    def _strip_cluster_raw_fields(self, patterns: list[dict[str, Any]]) -> None:
        for pattern in patterns:
            pattern.pop("_cus_raw", None)

    def _extract_timeline_rows(self, pattern: dict[str, Any]) -> list[dict[str, Any]]:
        timeline = pattern.get("timeline")
        if isinstance(timeline, dict):
            rows = timeline.get("rows")
            if isinstance(rows, list):
                return [item for item in rows if isinstance(item, dict)]
        return []

    def _classify_pattern(
        self,
        activity_ratio: float,
        burstiness: float,
        periodicity: float,
        has_anomalies: bool,
    ) -> str:
        if has_anomalies:
            return "anomalous"
        if burstiness > 2:
            return "bursty"
        if periodicity > 0.7:
            return "periodic"
        if activity_ratio < 0.2:
            return "sparse"
        if activity_ratio > 0.8:
            return "continuous"
        return "normal"

    def _build_period_metrics(self, series: list[dict[str, Any]], values: list[float]) -> dict[str, Any]:
        return {
            "total": sum(values),
            "avg": self._mean(values),
            "max": max(values),
            "min": min(values),
            "series": series,
        }

    def _detect_correlation_field_types(
        self,
        rows: list[dict[str, Any]],
        fields: list[str],
    ) -> list[dict[str, Any]]:
        detected: list[dict[str, Any]] = []
        for field in fields:
            sample_count = 0
            numeric_count = 0
            categorical_count = 0
            for row in rows:
                values = row.get(field)
                for value in values if isinstance(values, list) else [values]:
                    if value in (None, ""):
                        continue
                    sample_count += 1
                    if self._is_numeric_like(value):
                        numeric_count += 1
                    else:
                        categorical_count += 1
            field_type = "unknown"
            if sample_count > 0:
                if numeric_count > 0 and categorical_count == 0:
                    field_type = "numeric"
                elif categorical_count > 0 and numeric_count == 0:
                    field_type = "categorical"
                elif numeric_count > 0 and categorical_count > 0:
                    field_type = "mixed"
            detected.append(
                {
                    "field": field,
                    "detected_type": field_type,
                    "sample_count": sample_count,
                    "numeric_count": numeric_count,
                    "categorical_count": categorical_count,
                }
            )
        return detected

    def _resolve_correlation_mode(
        self,
        requested_mode: str,
        field_types: list[dict[str, Any]],
    ) -> dict[str, str]:
        numeric = [item for item in field_types if item["detected_type"] == "numeric"]
        categorical = [item for item in field_types if item["detected_type"] == "categorical"]
        problematic = [
            item
            for item in field_types
            if item["detected_type"] in {"mixed", "unknown"}
        ]
        if problematic:
            return {
                "error": "字段类型判断不明确："
                + ", ".join(f'{item["field"]}={item["detected_type"]}' for item in problematic)
                + "。请改用纯数值字段或纯离散字段，避免混合输入。"
            }
        if requested_mode == "lagged_pearson":
            if len(numeric) != len(field_types):
                return {
                    "error": "lagged_pearson 仅支持纯数值字段，当前检测到非数值字段："
                    + ", ".join(item["field"] for item in field_types if item["detected_type"] != "numeric")
                    + "。"
                }
            return {"mode": "lagged_pearson"}
        if requested_mode == "fp_growth":
            if len(categorical) != len(field_types):
                return {
                    "error": "fp_growth 仅支持纯离散字段，当前检测到非离散字段："
                    + ", ".join(item["field"] for item in field_types if item["detected_type"] != "categorical")
                    + "。"
                }
            return {"mode": "fp_growth"}
        if len(numeric) == len(field_types):
            return {"mode": "lagged_pearson"}
        if len(categorical) == len(field_types):
            return {"mode": "fp_growth"}
        return {
            "error": "auto 模式要求 fields 全部为数值字段或全部为离散字段，当前检测结果为："
            + ", ".join(f'{item["field"]}={item["detected_type"]}' for item in field_types)
            + "。"
        }

    def _calculate_lagged_pearson_scores(
        self,
        left_series: list[dict[str, Any]],
        right_series: list[dict[str, Any]],
        max_lag: int,
    ) -> list[dict[str, Any]]:
        timeline = self._merge_timeline(left_series, right_series)
        left_map = {item["timestamp"]: item["value"] for item in left_series}
        right_map = {item["timestamp"]: item["value"] for item in right_series}
        left_values = [left_map.get(timestamp) for timestamp in timeline]
        right_values = [right_map.get(timestamp) for timestamp in timeline]

        scores: list[dict[str, Any]] = []
        for lag in range(-max_lag, max_lag + 1):
            aligned_left: list[float] = []
            aligned_right: list[float] = []
            for index in range(len(timeline)):
                shifted = index + lag
                if shifted < 0 or shifted >= len(timeline):
                    continue
                left_value = left_values[index]
                right_value = right_values[shifted]
                if left_value is None or right_value is None:
                    continue
                aligned_left.append(float(left_value))
                aligned_right.append(float(right_value))
            if len(aligned_left) < 2:
                continue
            scores.append(
                {
                    "lag": lag,
                    "correlation": self._calculate_correlation(aligned_left, aligned_right),
                    "aligned_points": len(aligned_left),
                }
            )
        return scores

    def _merge_timeline(
        self,
        left_series: list[dict[str, Any]],
        right_series: list[dict[str, Any]],
    ) -> list[str]:
        timestamps = {item["timestamp"] for item in left_series}
        timestamps.update(item["timestamp"] for item in right_series)
        return sorted(timestamps, key=self._timestamp_sort_key)

    def _describe_lag_relationship(self, field1: str, field2: str, lag: int) -> str:
        if lag == 0:
            return f"{field1} 与 {field2} 基本同步变化"
        if lag > 0:
            return f"{field1} 领先 {field2} {lag} 个桶"
        return f"{field2} 领先 {field1} {abs(lag)} 个桶"

    def _build_lagged_pearson_summary(self, results: list[dict[str, Any]]) -> str:
        top = results[0] if results else None
        if not top:
            return "未发现可解释的滞后相关关系。"
        return (
            f'{top["field1"]} 与 {top["field2"]} 的最佳相关系数为 '
            f'{float(top["best_correlation"]):.4f}，最佳 lag 为 {top["best_lag"]}，'
            f'说明 {top["relationship"]}。'
        )

    def _build_transactions_from_rows(self, rows: list[dict[str, Any]], fields: list[str]) -> list[list[str]]:
        transactions: list[list[str]] = []
        for row in rows:
            transaction: set[str] = set()
            for field in fields:
                for value in self._normalize_discrete_values(row.get(field)):
                    transaction.add(f"{field}={value}")
            if transaction:
                transactions.append(sorted(transaction))
        return transactions

    def _normalize_discrete_values(self, value: Any) -> list[str]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            flattened: set[str] = set()
            for item in value:
                flattened.update(self._normalize_discrete_values(item))
            return sorted(flattened)
        if isinstance(value, dict):
            return [str(value)]
        return [str(value)]

    def _mine_frequent_itemsets(
        self,
        *,
        transactions: list[list[str]],
        min_support_count: int,
        max_pattern_size: int,
    ) -> list[dict[str, Any]]:
        counts: dict[tuple[str, ...], int] = {}
        unique_transactions = [sorted(set(transaction)) for transaction in transactions]
        for transaction in unique_transactions:
            upper = min(len(transaction), max_pattern_size)
            for size in range(1, upper + 1):
                for combo in itertools.combinations(transaction, size):
                    counts[combo] = counts.get(combo, 0) + 1
        itemsets = [
            {"items": list(items), "support_count": support_count}
            for items, support_count in counts.items()
            if support_count >= min_support_count
        ]
        itemsets.sort(key=lambda item: (item["support_count"], len(item["items"])), reverse=True)
        return itemsets

    def _generate_association_rules(
        self,
        *,
        itemsets: list[dict[str, Any]],
        transaction_count: int,
        min_confidence: float,
        support_map: dict[str, int],
    ) -> list[dict[str, Any]]:
        rules: list[dict[str, Any]] = []
        for itemset in itemsets:
            items = itemset["items"]
            if len(items) < 2:
                continue
            for subset_size in range(1, len(items)):
                for antecedent in itertools.combinations(items, subset_size):
                    antecedent_list = list(antecedent)
                    consequent = [item for item in items if item not in antecedent_list]
                    antecedent_support = support_map.get(self._serialize_itemset(antecedent_list))
                    consequent_support = support_map.get(self._serialize_itemset(consequent))
                    if not antecedent_support or not consequent_support:
                        continue
                    support = itemset["support_count"] / transaction_count
                    confidence = itemset["support_count"] / antecedent_support
                    consequent_ratio = consequent_support / transaction_count
                    lift = confidence / consequent_ratio if consequent_ratio > 0 else 0
                    if confidence < min_confidence:
                        continue
                    rules.append(
                        {
                            "kind": "association_rule",
                            "antecedent": antecedent_list,
                            "consequent": consequent,
                            "support_count": itemset["support_count"],
                            "support": support,
                            "confidence": confidence,
                            "lift": lift,
                            "score": lift * confidence,
                        }
                    )
        rules.sort(key=lambda item: (item["score"], item["support"]), reverse=True)
        return rules

    def _serialize_itemset(self, items: list[str]) -> str:
        return " || ".join(sorted(items))

    def _build_fp_growth_summary(self, results: list[dict[str, Any]], query: str) -> str:
        top_rule = next((item for item in results if item.get("kind") == "association_rule"), None)
        if top_rule:
            return (
                f'在查询 "{query}" 的样本中，规则 '
                f'{", ".join(top_rule["antecedent"])} => {", ".join(top_rule["consequent"])} '
                f'的置信度为 {float(top_rule["confidence"]):.4f}，提升度为 {float(top_rule["lift"]):.4f}。'
            )
        top_itemset = next((item for item in results if item.get("kind") == "frequent_itemset"), None)
        if top_itemset:
            return (
                f'在查询 "{query}" 的样本中，频繁组合 {", ".join(top_itemset["items"])} 的支持度为 '
                f'{float(top_itemset["support"]):.4f}。'
            )
        return "当前支持度和置信度阈值下未发现明显的离散字段组合。"

    def _extract_row_fields(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        field_samples: dict[str, int] = {}
        for row in rows:
            for key, value in row.items():
                if key.startswith("_"):
                    continue
                if value in (None, "", [], {}):
                    continue
                field_samples[key] = field_samples.get(key, 0) + 1
        return [{"name": key, "sample_count": count} for key, count in field_samples.items()]

    def _select_root_cause_fields(
        self,
        *,
        baseline_fields: list[dict[str, Any]],
        anomaly_fields: list[dict[str, Any]],
        limit: int,
    ) -> list[str]:
        anomaly_names = {item["name"] for item in anomaly_fields}
        ranked = [
            item
            for item in baseline_fields
            if item["name"] in anomaly_names and not item["name"].startswith("_")
        ]
        ranked.sort(key=lambda item: item.get("sample_count", 0), reverse=True)
        return [item["name"] for item in ranked[: max(1, limit)]]

    def _analyze_field_distribution_drift(
        self,
        *,
        baseline_counts: dict[str, int],
        anomaly_counts: dict[str, int],
        topk: int,
    ) -> dict[str, Any] | None:
        all_values = sorted(set(baseline_counts) | set(anomaly_counts))
        baseline_total = sum(baseline_counts.values())
        anomaly_total = sum(anomaly_counts.values())
        if not all_values or baseline_total == 0 or anomaly_total == 0:
            return None

        baseline_distribution = [(baseline_counts.get(value, 0) / baseline_total) for value in all_values]
        anomaly_distribution = [(anomaly_counts.get(value, 0) / anomaly_total) for value in all_values]
        drift_score = self._jensen_shannon_divergence(baseline_distribution, anomaly_distribution)

        changed_values = []
        for value in all_values:
            baseline_count = baseline_counts.get(value, 0)
            anomaly_count = anomaly_counts.get(value, 0)
            baseline_support = baseline_count / baseline_total
            anomaly_support = anomaly_count / anomaly_total
            support_delta = anomaly_support - baseline_support
            if baseline_count > 0:
                change_ratio = (anomaly_count - baseline_count) / baseline_count
            else:
                change_ratio = float(anomaly_count)
            changed_values.append(
                {
                    "value": value,
                    "baseline_count": baseline_count,
                    "anomaly_count": anomaly_count,
                    "baseline_support": baseline_support,
                    "anomaly_support": anomaly_support,
                    "support_delta": support_delta,
                    "change_ratio": change_ratio,
                    "contribution_score": abs(support_delta),
                    "direction": "up" if support_delta > 0 else "down" if support_delta < 0 else "flat",
                }
            )

        changed_values.sort(key=lambda item: item["contribution_score"], reverse=True)
        return {
            "drift_score": drift_score,
            "baseline_total": baseline_total,
            "anomaly_total": anomaly_total,
            "changed_values": changed_values[: max(1, topk)],
        }

    def _generate_distribution_hypothesis(self, field: str, changed_values: list[dict[str, Any]]) -> str:
        if not changed_values:
            return f"字段 {field} 有轻微漂移，但没有足够突出的值变化。"
        top = changed_values[0]
        direction = "上升" if top["direction"] == "up" else "下降" if top["direction"] == "down" else "波动"
        return (
            f'字段 {field} 的分布发生明显漂移，最突出的值是 "{top["value"]}"，'
            f'在异常窗口中的占比{direction}到 {top["anomaly_support"] * 100:.1f}%。'
        )

    def _generate_root_cause_queries(
        self,
        *,
        query: str,
        distribution_drift: list[dict[str, Any]],
        suspicious_slices: list[dict[str, Any]],
    ) -> list[str]:
        queries: list[str] = []
        for item in suspicious_slices:
            queries.append(item["query"])
        for item in distribution_drift:
            top_change = next((change for change in item["changed_values"] if change["direction"] == "up"), None)
            if top_change:
                queries.append(
                    self._build_slice_query(query, [{"field": item["field"], "value": top_change["value"]}])
                )
        return list(dict.fromkeys(queries))[:5]

    def _generate_root_cause_summary(
        self,
        *,
        query: str,
        distribution_drift: list[dict[str, Any]],
        suspicious_slices: list[dict[str, Any]],
        anomaly_total: int,
        baseline_total: int,
    ) -> str:
        if not distribution_drift and not suspicious_slices:
            return "未发现明显的分布漂移或可疑切片。建议扩大时间窗口、补充候选字段，或适当降低切片支持度/提升度阈值。"
        parts = [f'基于查询 "{query}"，异常窗口日志量 {anomaly_total}，基线窗口日志量 {baseline_total}。']
        if distribution_drift:
            top_drift = distribution_drift[0]
            parts.append(f'分布漂移最明显的字段是 {top_drift["field"]}，漂移分数为 {top_drift["drift_score"]:.4f}。')
        if suspicious_slices:
            top_slice = suspicious_slices[0]
            parts.append(
                f'最可疑的切片是 {" AND ".join(top_slice["slice_terms"])}，异常支持度 '
                f'{top_slice["anomaly_support"] * 100:.1f}%，提升度 {top_slice["lift"]:.2f}。'
            )
        return "\n".join(parts)

    def _generate_slice_candidates(
        self,
        terms_by_field: dict[str, list[dict[str, str]]],
        *,
        max_depth: int,
    ) -> list[list[dict[str, str]]]:
        items = list(terms_by_field.items())
        results: list[list[dict[str, str]]] = []

        def backtrack(start_index: int, current: list[dict[str, str]]) -> None:
            if current:
                results.append([*current])
            if len(current) >= max_depth:
                return
            for index in range(start_index, len(items)):
                _, terms = items[index]
                for term in terms:
                    current.append(term)
                    backtrack(index + 1, current)
                    current.pop()

        backtrack(0, [])
        return results

    def _count_slice_matches(self, rows: list[dict[str, Any]], terms: list[dict[str, str]]) -> int:
        return sum(1 for row in rows if self._slice_matches_row(row, terms))

    def _slice_matches_row(self, row: dict[str, Any], terms: list[dict[str, str]]) -> bool:
        for term in terms:
            values = self._normalize_discrete_values(row.get(term["field"]))
            if term["value"] not in values:
                return False
        return True

    def _should_skip_slice_value(self, value: str) -> bool:
        stripped = value.strip()
        return len(stripped) == 0 or len(stripped) > 80 or "\n" in stripped

    def _build_slice_query(self, query: str, terms: list[dict[str, str]]) -> str:
        clauses = [f'{term["field"]}:"{self._escape_query_value(term["value"])}"' for term in terms]
        if query in {"", "*"}:
            return " AND ".join(clauses)
        return f'({query}) AND {" AND ".join(clauses)}'

    def _escape_query_value(self, value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    def _calculate_lift(self, anomaly_support: float, baseline_support: float, baseline_total: int) -> float:
        if baseline_support > 0:
            return anomaly_support / baseline_support
        if anomaly_support <= 0:
            return 0.0
        return anomaly_support / (1 / max(baseline_total, 1))

    def _calculate_slice_score(self, anomaly_support: float, lift: float, depth: int) -> float:
        return round(anomaly_support * math.log2(lift + 1) * depth, 6)

    def _calculate_distribution_differences(
        self,
        baseline_counts: dict[str, int],
        anomaly_counts: dict[str, int],
        topk: int,
    ) -> list[dict[str, Any]]:
        all_keys = sorted(set(baseline_counts) | set(anomaly_counts))
        baseline_total = sum(baseline_counts.values())
        anomaly_total = sum(anomaly_counts.values())
        if baseline_total == 0 or anomaly_total == 0:
            return []

        differences: list[dict[str, Any]] = []
        for key in all_keys:
            baseline_count = baseline_counts.get(key, 0)
            anomaly_count = anomaly_counts.get(key, 0)
            baseline_prob = baseline_count / baseline_total
            anomaly_prob = anomaly_count / anomaly_total
            change_ratio = ((anomaly_count - baseline_count) / baseline_count) if baseline_count > 0 else 0.0
            differences.append(
                {
                    "value": key,
                    "baseline_count": baseline_count,
                    "anomaly_count": anomaly_count,
                    "change_ratio": change_ratio,
                    "jsd": self._jensen_shannon_divergence([baseline_prob], [anomaly_prob]),
                }
            )
        differences.sort(key=lambda item: item["jsd"], reverse=True)
        return differences[: max(1, topk)]

    def _jensen_shannon_divergence(self, p: list[float], q: list[float]) -> float:
        m = [(left + right) / 2 for left, right in zip(p, q, strict=False)]
        return (self._kullback_leibler_divergence(p, m) + self._kullback_leibler_divergence(q, m)) / 2

    def _kullback_leibler_divergence(self, p: list[float], q: list[float]) -> float:
        divergence = 0.0
        for left, right in zip(p, q, strict=False):
            if left > 0 and right > 0:
                divergence += left * math.log(left / right)
        return divergence

    def _parse_duration_ms(self, time_range: str) -> int:
        if not isinstance(time_range, str) or "," not in time_range:
            return 0
        start_raw, end_raw = [part.strip() for part in time_range.split(",", 1)]
        now = datetime.now(timezone.utc)
        start = self._parse_time_value(start_raw, now)
        end = self._parse_time_value(end_raw, now)
        if start is None or end is None:
            return 0
        return max(0, int((end - start).total_seconds() * 1000))

    def _parse_time_value(self, value: str, now: datetime) -> datetime | None:
        if value == "now":
            return now
        if value.endswith("/d"):
            base = self._parse_time_value(value[:-2], now)
            if base is None:
                return None
            return base.replace(hour=0, minute=0, second=0, microsecond=0)
        if value.startswith("now"):
            delta_expr = value[3:]
            if not delta_expr:
                return now
            match = _DURATION_RE.match(delta_expr)
            if not match:
                return None
            sign, amount_raw, unit = match.groups()
            amount = int(amount_raw)
            delta_map = {
                "s": timedelta(seconds=amount),
                "m": timedelta(minutes=amount),
                "h": timedelta(hours=amount),
                "d": timedelta(days=amount),
                "w": timedelta(weeks=amount),
            }
            delta = delta_map[unit]
            return now - delta if sign != "+" else now + delta
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    def _choose_bucket(self, duration_ms: int) -> tuple[str, int]:
        minute = 60 * 1000
        hour = 60 * minute
        day = 24 * hour
        if duration_ms <= 30 * minute:
            return ("1m", 60)
        if duration_ms <= 6 * hour:
            return ("5m", 300)
        if duration_ms <= day:
            return ("15m", 900)
        if duration_ms <= 7 * day:
            return ("1h", 3600)
        if duration_ms <= 30 * day:
            return ("6h", 21600)
        return ("1d", 86400)

    def _mean(self, values: list[float]) -> float:
        if not values:
            return 0.0
        return sum(values) / len(values)

    def _stddev(self, values: list[float]) -> float:
        if not values:
            return 0.0
        avg = self._mean(values)
        return math.sqrt(sum((value - avg) ** 2 for value in values) / len(values))

    def _linear_regression(self, values: list[float]) -> tuple[float, float]:
        if not values:
            return (0.0, 0.0)
        count = len(values)
        xs = list(range(count))
        sum_x = sum(xs)
        sum_y = sum(values)
        sum_xy = sum(index * value for index, value in enumerate(values))
        sum_xx = sum(index * index for index in xs)
        denominator = count * sum_xx - sum_x * sum_x
        if denominator == 0:
            return (0.0, sum_y / count)
        slope = (count * sum_xy - sum_x * sum_y) / denominator
        intercept = (sum_y - slope * sum_x) / count
        return (slope, intercept)

    def _detect_peaks(self, values: list[float], limit: int) -> list[dict[str, Any]]:
        threshold = self._mean(values) + 2 * self._stddev(values)
        peaks: list[dict[str, Any]] = []
        for index in range(1, len(values) - 1):
            if values[index] > values[index - 1] and values[index] > values[index + 1] and values[index] > threshold:
                peaks.append({"index": index, "value": values[index]})
        peaks.sort(key=lambda item: item["value"], reverse=True)
        return peaks[: max(1, limit)]

    def _detect_anomalies_zscore(self, values: list[float], threshold: float) -> list[dict[str, Any]]:
        if len(values) < 2:
            return []
        mean_value = self._mean(values)
        std_value = self._stddev(values)
        if std_value == 0:
            return []
        anomalies: list[dict[str, Any]] = []
        for index, value in enumerate(values):
            z_score = abs((value - mean_value) / std_value)
            if z_score > threshold:
                anomalies.append(
                    {
                        "index": index,
                        "value": value,
                        "threshold": z_score,
                        "reason": f"Z-score {z_score:.2f} 超过阈值 {threshold}",
                    }
                )
        return anomalies

    def _detect_anomalies_iqr(self, values: list[float], sensitivity: float) -> list[dict[str, Any]]:
        if not values:
            return []
        sorted_values = sorted(values)
        q1 = self._percentile(sorted_values, 25)
        q3 = self._percentile(sorted_values, 75)
        iqr = q3 - q1
        lower = q1 - sensitivity * iqr
        upper = q3 + sensitivity * iqr
        anomalies: list[dict[str, Any]] = []
        for index, value in enumerate(values):
            if value < lower:
                anomalies.append(
                    {
                        "index": index,
                        "value": value,
                        "threshold": lower,
                        "reason": f"值 {value} 小于下界 {lower:.2f}",
                    }
                )
            elif value > upper:
                anomalies.append(
                    {
                        "index": index,
                        "value": value,
                        "threshold": upper,
                        "reason": f"值 {value} 大于上界 {upper:.2f}",
                    }
                )
        return anomalies

    def _generate_trend_summary(self, values: list[float], slope: float, change_rate: float) -> str:
        avg = self._mean(values)
        maximum = max(values)
        minimum = min(values)
        if abs(change_rate) < 0.05:
            trend = "整体趋势平稳"
        elif change_rate > 0:
            trend = f"整体呈上升趋势，变化率 {(change_rate * 100):.1f}%"
        else:
            trend = f"整体呈下降趋势，变化率 {(change_rate * 100):.1f}%"
        slope_text = "斜率较小，趋势变化缓慢。" if abs(slope) <= 0.1 else f"斜率为 {slope:.3f}，表明趋势较为明显。"
        return f"时间序列分析结果：平均值={avg:.2f}，最大值={maximum:.2f}，最小值={minimum:.2f}。{trend}，{slope_text}"

    def _simple_moving_average(self, values: list[float], window: int) -> dict[str, Any]:
        if not values:
            return {"forecast": 0.0, "trend": "stable"}
        resolved_window = min(max(1, window), len(values))
        recent = values[-resolved_window:]
        forecast = self._mean(recent)
        midpoint = max(1, len(recent) // 2)
        first_avg = self._mean(recent[:midpoint])
        second_avg = self._mean(recent[midpoint:])
        change = self._safe_divide(second_avg - first_avg, first_avg)
        trend = "stable"
        if change > 0.1:
            trend = "increasing"
        elif change < -0.1:
            trend = "decreasing"
        return {"forecast": forecast, "trend": trend}

    def _exponential_smoothing(self, values: list[float], alpha: float, horizon: int) -> dict[str, Any]:
        if not values:
            return {"forecast": [], "trend": "stable"}
        smoothed = values[0]
        history = []
        for value in values:
            smoothed = alpha * value + (1 - alpha) * smoothed
            history.append(smoothed)
        midpoint = max(1, len(history) // 2)
        change = self._safe_divide(self._mean(history[midpoint:]) - self._mean(history[:midpoint]), self._mean(history[:midpoint]))
        trend = "stable"
        if change > 0.1:
            trend = "increasing"
        elif change < -0.1:
            trend = "decreasing"
        return {"forecast": [smoothed for _ in range(max(1, horizon))], "trend": trend}

    def _linear_trend_forecast(
        self,
        values: list[float],
        horizon: int,
        confidence: float,
    ) -> dict[str, Any]:
        if not values:
            zeros = [0.0 for _ in range(max(1, horizon))]
            return {
                "forecast": zeros,
                "confidence_lower": zeros,
                "confidence_upper": zeros,
                "trend": "stable",
                "r_squared": 0.0,
            }
        slope, intercept = self._linear_regression(values)
        forecast = [slope * (len(values) + step) + intercept for step in range(max(1, horizon))]
        predicted = [slope * index + intercept for index in range(len(values))]
        residuals = [actual - estimate for actual, estimate in zip(values, predicted, strict=False)]
        residual_std = self._stddev(residuals)
        z_value = 1.96 if confidence >= 0.95 else 1.64 if confidence >= 0.9 else 1.28
        margin = z_value * residual_std
        total_ss = sum((value - self._mean(values)) ** 2 for value in values)
        residual_ss = sum((actual - estimate) ** 2 for actual, estimate in zip(values, predicted, strict=False))
        r_squared = 0.0 if total_ss == 0 else 1 - residual_ss / total_ss
        trend = "stable"
        if slope > 0.1:
            trend = "increasing"
        elif slope < -0.1:
            trend = "decreasing"
        return {
            "forecast": forecast,
            "confidence_lower": [value - margin for value in forecast],
            "confidence_upper": [value + margin for value in forecast],
            "trend": trend,
            "r_squared": r_squared,
        }

    def _percentile(self, values: list[float], percentile: float) -> float:
        if not values:
            return 0.0
        index = max(0, min(len(values) - 1, math.ceil(len(values) * percentile / 100) - 1))
        return values[index]

    def _calculate_correlation(self, left: list[float], right: list[float]) -> float:
        if len(left) != len(right) or not left:
            return 0.0
        mean_left = self._mean(left)
        mean_right = self._mean(right)
        numerator = 0.0
        square_left = 0.0
        square_right = 0.0
        for left_value, right_value in zip(left, right, strict=False):
            diff_left = left_value - mean_left
            diff_right = right_value - mean_right
            numerator += diff_left * diff_right
            square_left += diff_left * diff_left
            square_right += diff_right * diff_right
        denominator = math.sqrt(square_left * square_right)
        if denominator == 0:
            return 0.0
        return numerator / denominator

    def _detect_periodicity(self, values: list[float]) -> float:
        if len(values) < 4:
            return 0.0
        best = 0.0
        for period in range(2, len(values) // 2 + 1):
            matches = 0
            comparisons = 0
            for index in range(len(values) - period):
                left = values[index]
                right = values[index + period]
                if left > 0 or right > 0:
                    comparisons += 1
                    if left > 0 and right > 0:
                        matches += 1
            if comparisons > 0:
                best = max(best, matches / comparisons)
        return best

    def _timestamp_sort_key(self, value: str) -> tuple[int, float | str]:
        if _NUMBER_RE.match(value):
            return (0, float(value))
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return (1, value)
        return (0, parsed.timestamp())

    def _is_numeric_like(self, value: Any) -> bool:
        if isinstance(value, bool):
            return False
        if isinstance(value, (int, float)):
            return math.isfinite(float(value))
        if not isinstance(value, str):
            return False
        stripped = value.strip()
        if not stripped:
            return False
        return bool(_NUMBER_RE.match(stripped))

    def _coerce_int(self, value: Any, *, default: int, minimum: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(minimum, parsed)

    def _coerce_float(self, value: Any, *, default: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return default
        if math.isnan(parsed) or math.isinf(parsed):
            return default
        return parsed

    def _safe_divide(self, numerator: float, denominator: float) -> float:
        if abs(denominator) <= 1e-9:
            return 0.0
        return numerator / denominator

    def _dig(self, payload: dict[str, Any], path: list[str]) -> Any:
        current: Any = payload
        for key in path:
            if not isinstance(current, dict):
                return None
            current = current.get(key)
        return current
