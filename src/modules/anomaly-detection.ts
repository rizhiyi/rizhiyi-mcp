import { LogEaseClient } from '../client.js';
import { ApiResponse, PeriodComparisonResult, CorrelationResult, RootCauseAnalysisResult, TimeSeriesPoint } from '../types.js';
import { analyzeTimeline } from './series-analysis.js';
import { StatisticsModule } from './statistics.js';

type DistributionValueChange = RootCauseAnalysisResult['distribution_drift'][number]['changed_values'][number];
type DistributionDriftItem = RootCauseAnalysisResult['distribution_drift'][number];
type SuspiciousSliceItem = RootCauseAnalysisResult['suspicious_slices'][number];
type SliceTerm = { field: string; value: string };

export class AnomalyDetectionModule {
    private statistics: StatisticsModule;
    private logSearch: LogSearchModule;
    private timechartQuery: TimechartQueryModule;

    constructor(private client: LogEaseClient) {
        this.statistics = new StatisticsModule(client);
        this.logSearch = new LogSearchModule(client);
        this.timechartQuery = new TimechartQueryModule(client);
    }

    /**
     * 计算JS散度
     */
    jensenShannonDivergence(p: number[], q: number[]): number {
        const m = p.map((pi, i) => (pi + q[i]) / 2);
        const klPm = this.kullbackLeiblerDivergence(p, m);
        const klQm = this.kullbackLeiblerDivergence(q, m);
        return (klPm + klQm) / 2;
    }

    /**
     * 计算KL散度
     */
    kullbackLeiblerDivergence(p: number[], q: number[]): number {
        let divergence = 0;
        for (let i = 0; i < p.length; i++) {
            if (p[i] > 0 && q[i] > 0) {
                divergence += p[i] * Math.log(p[i] / q[i]);
            }
        }
        return divergence;
    }

    /**
     * 计算分布差异
     */
    calculateDistributionDifferences(
        baselineCounts: Record<string, number>,
        anomalyCounts: Record<string, number>,
        topk: number = 10
    ): Array<{value: string, baseline_count: number, anomaly_count: number, change_ratio: number, jsd: number}> {
        const allKeys = new Set([...Object.keys(baselineCounts), ...Object.keys(anomalyCounts)]);
        const differences: Array<{value: string, baseline_count: number, anomaly_count: number, change_ratio: number, jsd: number}> = [];

        // 计算总数
        const baselineTotal = Object.values(baselineCounts).reduce((sum, count) => sum + count, 0);
        const anomalyTotal = Object.values(anomalyCounts).reduce((sum, count) => sum + count, 0);

        if (baselineTotal === 0 || anomalyTotal === 0) return [];

        // 计算每个值的分布差异
        allKeys.forEach(key => {
            const baselineCount = baselineCounts[key] || 0;
            const anomalyCount = anomalyCounts[key] || 0;
            
            const baselineProb = baselineCount / baselineTotal;
            const anomalyProb = anomalyCount / anomalyTotal;
            
            // 计算变化率
            const changeRatio = baselineCount > 0 ? (anomalyCount - baselineCount) / baselineCount : 0;
            
            // 计算JS散度
            const jsd = this.jensenShannonDivergence([baselineProb], [anomalyProb]);
            
            differences.push({
                value: key,
                baseline_count: baselineCount,
                anomaly_count: anomalyCount,
                change_ratio: changeRatio,
                jsd
            });
        });

        // 按JS散度排序并返回前k个
        return differences
            .filter(d => d.baseline_count > 0 || d.anomaly_count > 0)
            .sort((a, b) => b.jsd - a.jsd)
            .slice(0, topk);
    }

    analyzePatternResults(patterns: any[], totalHits: number = 0, limit: number = 20): {
        total_patterns: number;
        total_hits: number;
        patterns: Array<any>;
        analysis_summary: any;
    } {
        const analysisResults = this.analyzePatterns(patterns, totalHits);
        const analyzedPatterns = analysisResults.patterns
            .sort((a, b) => b.significance_score - a.significance_score)
            .slice(0, limit);

        return {
            total_patterns: patterns.length,
            total_hits: totalHits,
            patterns: analyzedPatterns,
            analysis_summary: analysisResults.summary
        };
    }

    /**
     * 高级模式分析 - 对日志聚类结果进行深度分析
     * 分析每个模式的时间分布、频率变化、异常检测等
     */
    private analyzePatterns(patterns: any[], totalHits: number): {
        patterns: Array<any>;
        summary: any;
    } {
        const analyzedPatterns = patterns.map(pattern => {
            const seriesAnalysis = analyzeTimeline(pattern.timeline);
            const timelineAnalysis = {
                has_timeline: seriesAnalysis.has_timeline,
                total_time_buckets: seriesAnalysis.total_time_buckets,
                active_buckets: seriesAnalysis.active_buckets,
                activity_ratio: seriesAnalysis.activity_ratio,
                temporal_distribution: seriesAnalysis.temporal_distribution,
                burstiness: seriesAnalysis.burstiness,
                periodicity_score: seriesAnalysis.periodicity_score,
                temporal_clustering: seriesAnalysis.temporal_clustering,
                peak_activity: seriesAnalysis.peak_activity,
                quiet_periods: seriesAnalysis.quiet_periods,
                time_range: seriesAnalysis.time_range
            };
            const frequencyAnalysis = this.analyzePatternFrequency(pattern, totalHits);
            const anomalyAnalysis = {
                has_anomalies: seriesAnalysis.has_anomalies,
                statistical_anomalies: seriesAnalysis.statistical_anomalies,
                temporal_anomalies: seriesAnalysis.temporal_anomalies,
                anomaly_score: seriesAnalysis.anomaly_score
            };
            
            return {
                id: pattern.id,
                pattern: pattern.pattern_string,
                count: pattern.count,
                coverage: totalHits > 0 ? ((pattern.count / totalHits) * 100).toFixed(2) + '%' : '0%',
                level: pattern.level,
                
                // 时间分析结果
                temporal_analysis: timelineAnalysis,
                
                // 频率分析结果
                frequency_analysis: frequencyAnalysis,
                
                // 异常检测结果
                anomaly_analysis: anomalyAnalysis,
                
                // 综合重要性评分
                significance_score: this.calculateSignificanceScore(
                    pattern, 
                    timelineAnalysis, 
                    frequencyAnalysis, 
                    anomalyAnalysis
                ),
                
                // 模式分类
                classification: this.classifyPattern(pattern, timelineAnalysis, anomalyAnalysis)
            };
        });

        // 生成整体分析摘要
        const summary = this.generatePatternSummary(analyzedPatterns, totalHits);

        return {
            patterns: analyzedPatterns,
            summary
        };
    }

    /**
     * 分析模式的时间分布特征
     */
    private analyzePatternTimeline(pattern: any): any {
        if (!pattern.timeline?.rows || !Array.isArray(pattern.timeline.rows)) {
            return {
                has_timeline: false,
                total_time_buckets: 0,
                active_buckets: 0,
                temporal_distribution: 'unknown',
                burstiness: 0,
                periodicity_score: 0
            };
        }

        const timeline = pattern.timeline;
        const rows = timeline.rows;
        
        // 基础统计
        const counts = rows.map((row: any) => row.count || 0);
        const activeBuckets = counts.filter((count: number) => count > 0).length;
        const totalBuckets = counts.length;
        
        // 时间分布特征
        const temporalDistribution = this.analyzeTemporalDistribution(counts);
        
        // 突发性分析 (burstiness)
        const burstiness = this.calculateBurstiness(counts);
        
        // 周期性分析
        const periodicityScore = this.detectPeriodicity(counts);
        
        // 时间聚集度
        const temporalClustering = this.calculateTemporalClustering(counts);

        return {
            has_timeline: true,
            total_time_buckets: totalBuckets,
            active_buckets: activeBuckets,
            activity_ratio: totalBuckets > 0 ? activeBuckets / totalBuckets : 0,
            temporal_distribution: temporalDistribution,
            burstiness: burstiness,
            periodicity_score: periodicityScore,
            temporal_clustering: temporalClustering,
            peak_activity: this.findPeakActivity(counts),
            quiet_periods: this.identifyQuietPeriods(counts),
            time_range: {
                start: timeline.start_ts,
                end: timeline.end_ts,
                duration: timeline.end_ts - timeline.start_ts,
                interval: timeline.interval
            }
        };
    }

    /**
     * 分析模式的频率特征
     */
    private analyzePatternFrequency(pattern: any, totalHits: number): any {
        const count = pattern.count;
        const coverage = totalHits > 0 ? count / totalHits : 0;
        
        // 基于历史数据的频率分类（这里使用启发式方法）
        let frequencyCategory = 'rare';
        if (coverage >= 0.1) frequencyCategory = 'high';
        else if (coverage >= 0.05) frequencyCategory = 'medium';
        else if (coverage >= 0.01) frequencyCategory = 'low';
        
        return {
            count: count,
            coverage: coverage,
            coverage_percentage: (coverage * 100).toFixed(2) + '%',
            frequency_category: frequencyCategory,
            relative_importance: this.calculateRelativeImportance(count, totalHits)
        };
    }

    /**
     * 检测模式中的异常
     */
    private detectPatternAnomalies(pattern: any): any {
        if (!pattern.timeline?.rows) {
            return { has_anomalies: false, anomalies: [] };
        }

        const counts = pattern.timeline.rows.map((row: any) => row.count || 0);
        
        // 使用统计学方法检测异常
        const anomalies = this.detectStatisticalAnomalies(counts);
        
        // 检测时间模式异常
        const temporalAnomalies = this.detectTemporalAnomalies(pattern.timeline);

        return {
            has_anomalies: anomalies.length > 0 || temporalAnomalies.length > 0,
            statistical_anomalies: anomalies,
            temporal_anomalies: temporalAnomalies,
            anomaly_score: Math.max(anomalies.length, temporalAnomalies.length)
        };
    }

    /**
     * 分析时间分布特征
     */
    private analyzeTemporalDistribution(counts: number[]): string {
        const activeCount = counts.filter(c => c > 0).length;
        const ratio = activeCount / counts.length;
        
        if (ratio > 0.8) return 'continuous';
        if (ratio > 0.5) return 'frequent';
        if (ratio > 0.2) return 'intermittent';
        return 'sparse';
    }

    /**
     * 计算突发性指标
     */
    private calculateBurstiness(counts: number[]): number {
        if (counts.length < 2) return 0;
        
        const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
        if (mean === 0) return 0;
        
        const variance = counts.reduce((sum: number, count: number) => sum + Math.pow(count - mean, 2), 0) / counts.length;
        const stdDev = Math.sqrt(variance);
        
        // 突发性指标：标准差与均值的比值
        return stdDev / mean;
    }

    /**
     * 检测周期性
     */
    private detectPeriodicity(counts: number[]): number {
        if (counts.length < 4) return 0;
        
        // 简单的周期性检测：寻找重复模式
        let maxPeriodicity = 0;
        
        // 尝试不同的周期长度
        for (let period = 2; period <= Math.floor(counts.length / 2); period++) {
            let matches = 0;
            let comparisons = 0;
            
            for (let i = 0; i < counts.length - period; i++) {
                if (counts[i] > 0 && counts[i + period] > 0) {
                    matches++;
                }
                if (counts[i] > 0 || counts[i + period] > 0) {
                    comparisons++;
                }
            }
            
            if (comparisons > 0) {
                const periodicity = matches / comparisons;
                maxPeriodicity = Math.max(maxPeriodicity, periodicity);
            }
        }
        
        return maxPeriodicity;
    }

    /**
     * 计算时间聚集度
     */
    private calculateTemporalClustering(counts: number[]): number {
        if (counts.length < 3) return 0;
        
        let clusteringScore = 0;
        let windows = 0;
        
        // 使用滑动窗口检测聚集
        for (let i = 1; i < counts.length - 1; i++) {
            const localActivity = counts[i - 1] + counts[i] + counts[i + 1];
            if (localActivity > 0) {
                clusteringScore += localActivity;
                windows++;
            }
        }
        
        return windows > 0 ? clusteringScore / windows : 0;
    }

    /**
     * 寻找峰值活动
     */
    private findPeakActivity(counts: number[]): any {
        if (counts.length === 0) return null;
        
        const maxCount = Math.max(...counts);
        const maxIndex = counts.indexOf(maxCount);
        
        return {
            max_count: maxCount,
            peak_index: maxIndex,
            peak_ratio: maxCount > 0 ? maxCount / counts.reduce((a, b) => Math.max(a, b)) : 0
        };
    }

    /**
     * 识别安静期
     */
    private identifyQuietPeriods(counts: number[]): any[] {
        const quietPeriods = [];
        let currentStart = null;
        
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] === 0) {
                if (currentStart === null) {
                    currentStart = i;
                }
            } else {
                if (currentStart !== null) {
                    quietPeriods.push({
                        start_index: currentStart,
                        end_index: i - 1,
                        duration: i - currentStart
                    });
                    currentStart = null;
                }
            }
        }
        
        if (currentStart !== null) {
            quietPeriods.push({
                start_index: currentStart,
                end_index: counts.length - 1,
                duration: counts.length - currentStart
            });
        }
        
        return quietPeriods;
    }

    /**
     * 计算相对重要性
     */
    private calculateRelativeImportance(count: number, total: number): number {
        if (total === 0) return 0;
        
        // 使用对数缩放避免大数值主导
        const ratio = count / total;
        return Math.log(1 + ratio * 100) / Math.log(101);
    }

    /**
     * 检测统计异常
     */
    private detectStatisticalAnomalies(counts: number[]): any[] {
        if (counts.length < 3) return [];
        
        const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
        const variance = counts.reduce((sum: number, count: number) => sum + Math.pow(count - mean, 2), 0) / counts.length;
        const stdDev = Math.sqrt(variance);
        
        const anomalies = [];
        const threshold = 2.0; // 2个标准差
        
        for (let i = 0; i < counts.length; i++) {
            const zScore = stdDev > 0 ? Math.abs(counts[i] - mean) / stdDev : 0;
            if (zScore > threshold) {
                anomalies.push({
                    index: i,
                    value: counts[i],
                    z_score: zScore,
                    type: counts[i] > mean ? 'spike' : 'drop'
                });
            }
        }
        
        return anomalies;
    }

    /**
     * 检测时间异常
     */
    private detectTemporalAnomalies(timeline: any): any[] {
        if (!timeline.rows || timeline.rows.length < 3) return [];
        
        const anomalies = [];
        const rows = timeline.rows;
        
        // 检测不规则的时间间隔
        const intervals = [];
        for (let i = 1; i < rows.length; i++) {
            const interval = rows[i].start_ts - rows[i-1].start_ts;
            intervals.push(interval);
        }
        
        const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const threshold = meanInterval * 2;
        
        for (let i = 0; i < intervals.length; i++) {
            if (intervals[i] > threshold) {
                anomalies.push({
                    type: 'irregular_interval',
                    index: i,
                    interval: intervals[i],
                    expected_interval: meanInterval
                });
            }
        }
        
        return anomalies;
    }

    /**
     * 计算综合重要性评分
     */
    private calculateSignificanceScore(
        pattern: any, 
        timelineAnalysis: any, 
        frequencyAnalysis: any, 
        anomalyAnalysis: any
    ): number {
        let score = 0;
        
        // 频率权重 (30%)
        score += frequencyAnalysis.relative_importance * 0.3;
        
        // 时间活跃度权重 (25%)
        if (timelineAnalysis.has_timeline) {
            score += timelineAnalysis.activity_ratio * 0.25;
        }
        
        // 突发性权重 (20%)
        if (timelineAnalysis.has_timeline) {
            const burstinessScore = Math.min(timelineAnalysis.burstiness / 5, 1); // 归一化
            score += burstinessScore * 0.2;
        }
        
        // 异常权重 (15%)
        const anomalyScore = Math.min(anomalyAnalysis.anomaly_score / 3, 1);
        score += anomalyScore * 0.15;
        
        // 周期性权重 (10%)
        if (timelineAnalysis.has_timeline) {
            score += timelineAnalysis.periodicity_score * 0.1;
        }
        
        return Math.min(score, 1); // 确保不超过1
    }

    /**
     * 分类模式
     */
    private classifyPattern(pattern: any, timelineAnalysis: any, anomalyAnalysis: any): string {
        if (anomalyAnalysis.has_anomalies) {
            return 'anomalous';
        }
        
        if (timelineAnalysis.has_timeline) {
            if (timelineAnalysis.burstiness > 2) {
                return 'bursty';
            }
            if (timelineAnalysis.periodicity_score > 0.7) {
                return 'periodic';
            }
            if (timelineAnalysis.activity_ratio < 0.2) {
                return 'sparse';
            }
            if (timelineAnalysis.activity_ratio > 0.8) {
                return 'continuous';
            }
        }
        
        return 'normal';
    }

    /**
     * 生成模式分析摘要
     */
    private generatePatternSummary(analyzedPatterns: any[], totalHits: number): any {
        const totalPatterns = analyzedPatterns.length;
        const classifications = analyzedPatterns.reduce((acc, pattern) => {
            const classification = pattern.classification;
            acc[classification] = (acc[classification] || 0) + 1;
            return acc;
        }, {});
        
        const avgSignificance = analyzedPatterns.reduce((sum, p) => sum + p.significance_score, 0) / totalPatterns;
        const highSignificancePatterns = analyzedPatterns.filter(p => p.significance_score > 0.7).length;
        const anomalousPatterns = analyzedPatterns.filter(p => p.classification === 'anomalous').length;
        
        return {
            total_patterns: totalPatterns,
            total_hits: totalHits,
            pattern_classifications: classifications,
            average_significance_score: avgSignificance,
            high_significance_patterns: highSignificancePatterns,
            anomalous_patterns: anomalousPatterns,
            key_insights: this.generateKeyInsights(analyzedPatterns, classifications)
        };
    }

    /**
     * 生成关键洞察
     */
    private generateKeyInsights(analyzedPatterns: any[], classifications: any): string[] {
        const insights = [];
        
        if (classifications.anomalous > 0) {
            insights.push(`发现 ${classifications.anomalous} 个异常模式，建议优先关注`);
        }
        
        if (classifications.bursty > 0) {
            insights.push(`发现 ${classifications.bursty} 个突发模式，可能存在间歇性问题`);
        }
        
        if (classifications.periodic > 0) {
            insights.push(`发现 ${classifications.periodic} 个周期性模式，可能存在定时任务或规律性行为`);
        }
        
        const highSignificance = analyzedPatterns.filter(p => p.significance_score > 0.7).length;
        if (highSignificance > 0) {
            insights.push(`发现 ${highSignificance} 个高重要性模式，占总模式的 ${((highSignificance / analyzedPatterns.length) * 100).toFixed(1)}%`);
        }
        
        if (insights.length === 0) {
            insights.push('模式分布正常，未发现明显异常或特殊模式');
        }
        
        return insights;
    }

    /**
     * 使用已有时间序列数据进行跨时间段对比分析 - 支持数据复用
     */
    private normalizeReusedTimeSeries(input: any): TimeSeriesPoint[] {
        const rawSeries = input?.data?.series || input?.series;
        if (Array.isArray(rawSeries) && rawSeries.length > 0) {
            return rawSeries.map((point: any) => {
                const rawValue = point?.value ?? point?.count ?? point?.cnt ?? 0;
                const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 0;
                const timestamp = point?.timestamp ?? point?.time ?? point?._time ?? point?.ts ?? '';

                return {
                    timestamp: String(timestamp),
                    value,
                    count: point?.count ?? value
                };
            });
        }

        const rawPoints = input?.data?.points || input?.points;
        if (Array.isArray(rawPoints) && rawPoints.length > 0) {
            return rawPoints.map((point: any) => {
                const rawValue = point?.count ?? point?.value ?? point?.cnt ?? 0;
                const value = typeof rawValue === 'number' ? rawValue : Number(rawValue) || 0;
                const timestamp = point?.time ?? point?.timestamp ?? point?._time ?? point?.ts ?? '';

                return {
                    timestamp: String(timestamp),
                    value,
                    count: value
                };
            });
        }

        return [];
    }

    async executePeriodCompareWithData(
        timeSeriesA: any,
        timeSeriesB: any,
        options: {
            compare_fields?: string[],
            topk?: number,
            query?: string,
            time_range_a?: string,
            time_range_b?: string,
            index_name?: string
        } = {}
    ): Promise<ApiResponse<PeriodComparisonResult>> {
        try {
            const { compare_fields = [], topk = 10, query = '*' } = options;

            const seriesA = this.normalizeReusedTimeSeries(timeSeriesA);
            const seriesB = this.normalizeReusedTimeSeries(timeSeriesB);

            if (seriesA.length === 0 || seriesB.length === 0) {
                return {
                    error: '数据不完整',
                    message: '无法获取完整的时间段数据'
                };
            }

            // 提取数值用于统计分析
            const valuesA = seriesA.map((point: TimeSeriesPoint) => point.value || point.count || 0);
            const valuesB = seriesB.map((point: TimeSeriesPoint) => point.value || point.count || 0);

            // 计算基础统计信息
            const totalA = valuesA.reduce((sum: number, val: number) => sum + val, 0);
            const totalB = valuesB.reduce((sum: number, val: number) => sum + val, 0);

            const avgA = this.statistics.mean(valuesA);
            const avgB = this.statistics.mean(valuesB);

            const maxA = Math.max(...valuesA);
            const maxB = Math.max(...valuesB);

            const minA = Math.min(...valuesA);
            const minB = Math.min(...valuesB);

            // 计算差异
            const differences = {
                total_change: totalB - totalA,
                avg_change: avgB - avgA,
                max_change: maxB - maxA,
                min_change: minB - minA
            };

            // 字段对比分析
            let fieldDifferences: any[] = [];
            if (compare_fields.length > 0) {
                // 使用提供的时间范围参数进行字段对比
                fieldDifferences = await this.compareFields(
                    query, 
                    options.time_range_a || '', 
                    options.time_range_b || '', 
                    options.index_name || 'yotta', 
                    compare_fields, 
                    topk
                );
            }

            return {
                status: 200,
                data: {
                    period_a: {
                        total: totalA,
                        avg: avgA,
                        max: maxA,
                        min: minA,
                        series: seriesA
                    },
                    period_b: {
                        total: totalB,
                        avg: avgB,
                        max: maxB,
                        min: minB,
                        series: seriesB
                    },
                    differences,
                    field_differences: fieldDifferences
                },
                message: '时间段对比分析完成（数据复用）'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行时间段对比分析出错: ${error.message}`
            };
        }
    }

    /**
     * 跨时间段对比分析 - 复用统一 timechart 查询层
     */
    async executePeriodCompare(params: {
        query?: string;
        time_range_a: string;
        time_range_b: string;
        index_name?: string;
        bucket?: string;
        compare_fields?: string[];
        topk?: number;
        metric_field?: string;
    }): Promise<ApiResponse<PeriodComparisonResult>> {
        try {
            const {
                query = '*',
                time_range_a,
                time_range_b,
                index_name = 'yotta',
                bucket,
                compare_fields = [],
                topk = 10,
                metric_field
            } = params;

            const [periodAResult, periodBResult] = await Promise.all([
                this.timechartQuery.execute({
                    query,
                    time_range: time_range_a,
                    index_name,
                    bucket,
                    metric_field
                }),
                this.timechartQuery.execute({
                    query,
                    time_range: time_range_b,
                    index_name,
                    bucket,
                    metric_field
                })
            ]);

            if (periodAResult.error) {
                return {
                    error: periodAResult.error,
                    message: periodAResult.message || '获取时间段A数据失败'
                };
            }
            if (periodBResult.error) {
                return {
                    error: periodBResult.error,
                    message: periodBResult.message || '获取时间段B数据失败'
                };
            }

            const seriesA: TimeSeriesPoint[] = periodAResult.data?.series || [];
            const seriesB: TimeSeriesPoint[] = periodBResult.data?.series || [];

            if (seriesA.length === 0 || seriesB.length === 0) {
                return {
                    error: '数据不完整',
                    message: '无法获取完整的时间段数据'
                };
            }

            // 提取数值用于统计分析
            const valuesA = seriesA.map((point: TimeSeriesPoint) => point.value || point.count || 0);
            const valuesB = seriesB.map((point: TimeSeriesPoint) => point.value || point.count || 0);

            // 计算基础统计信息
            const totalA = valuesA.reduce((sum: number, val: number) => sum + val, 0);
            const totalB = valuesB.reduce((sum: number, val: number) => sum + val, 0);

            const avgA = this.statistics.mean(valuesA);
            const avgB = this.statistics.mean(valuesB);

            const maxA = Math.max(...valuesA);
            const maxB = Math.max(...valuesB);

            const minA = Math.min(...valuesA);
            const minB = Math.min(...valuesB);

            // 计算差异
            const differences = {
                total_change: totalB - totalA,
                avg_change: avgB - avgA,
                max_change: maxB - maxA,
                min_change: minB - minA
            };

            // 字段对比分析
            let fieldDifferences: any[] = [];
            if (compare_fields.length > 0) {
                fieldDifferences = await this.compareFields(
                    query, time_range_a, time_range_b, index_name, compare_fields, topk
                );
            }

            return {
                status: Math.max(periodAResult.status || 200, periodBResult.status || 200),
                data: {
                    period_a: {
                        total: totalA,
                        avg: avgA,
                        max: maxA,
                        min: minA,
                        series: seriesA
                    },
                    period_b: {
                        total: totalB,
                        avg: avgB,
                        max: maxB,
                        min: minB,
                        series: seriesB
                    },
                    differences,
                    field_differences: fieldDifferences,
                    bucket_used: periodAResult.data?.bucket_used || periodBResult.data?.bucket_used,
                    query_executed: periodAResult.data?.query_executed || periodBResult.data?.query_executed
                },
                message: '时间段对比分析完成'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行时间段对比分析出错: ${error.message}`
            };
        }
    }

    /**
     * 对比字段分布
     */
    private async compareFields(
        query: string,
        timeRangeA: string,
        timeRangeB: string,
        indexName: string,
        fields: string[],
        topk: number
    ): Promise<any[]> {
        const fieldDifferences: any[] = [];

        for (const field of fields) {
            // 获取两个时间段的字段值分布
            const [distA, distB] = await Promise.all([
                this.getFieldDistribution(query, timeRangeA, indexName, field),
                this.getFieldDistribution(query, timeRangeB, indexName, field)
            ]);

            const differences = this.calculateDistributionDifferences(distA, distB, topk);
            
            differences.forEach(diff => {
                fieldDifferences.push({
                    field,
                    value: diff.value,
                    count_a: diff.baseline_count,
                    count_b: diff.anomaly_count,
                    change: diff.change_ratio,
                    jsd: diff.jsd
                });
            });
        }

        return fieldDifferences
            .sort((a, b) => b.jsd - a.jsd)
            .slice(0, topk);
    }

    /**
     * 获取字段分布
     */
    private async getFieldDistribution(
        query: string,
        timeRange: string,
        indexName: string,
        field: string,
        limit: number = 20
    ): Promise<Record<string, number>> {
        const result = await this.logSearch.executeListFieldValues(
            field,
            query,
            timeRange,
            indexName,
            limit
        );

        if (result.error || !Array.isArray(result.data?.values)) {
            return {};
        }

        const distribution: Record<string, number> = {};
        result.data.values.forEach((item: any) => {
            const value = item?.value;
            if (value === null || value === undefined || value === '') {
                return;
            }
            distribution[String(value)] = Number(item?.count || 0);
        });

        return distribution;
    }

    /**
     * 关联性分析 - 复用 log-search.ts 的日志搜索功能
     */
    async executeCorrelationAnalysis(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        fields?: string[];
        mode?: 'lagged_pearson' | 'fp_growth' | 'auto';
        bucket?: string;
        max_lag?: number;
        min_support?: number;
        min_confidence?: number;
        sample_size?: number;
        limit?: number;
    }): Promise<ApiResponse<CorrelationResult>> {
        try {
            const {
                query = '*',
                time_range,
                index_name = 'yotta',
                fields = [],
                mode = 'auto',
                bucket,
                max_lag = 3,
                min_support = 0.05,
                min_confidence = 0.6,
                sample_size = 500,
                limit = 20
            } = params;

            if (fields.length < 2) {
                return {
                    error: '字段不足',
                    message: '需要至少2个字段进行关联性分析'
                };
            }

            const searchResult = await this.logSearch.executeLogSearchSheet(
                query,
                time_range,
                index_name,
                { page: 0, size: sample_size },
                fields
            );

            if (searchResult.error) {
                return {
                    error: searchResult.error,
                    message: searchResult.message || '获取日志数据失败'
                };
            }

            const hits = searchResult.data?.hits || [];
            if (hits.length === 0) {
                return {
                    error: '无数据',
                    message: '未找到符合条件的数据'
                };
            }

            const fieldTypes = this.detectCorrelationFieldTypes(hits, fields);
            const resolvedMode = this.resolveCorrelationMode(mode, fieldTypes);
            if ('error' in resolvedMode) {
                return {
                    error: '字段类型不匹配',
                    message: resolvedMode.error,
                    details: {
                        requested_mode: mode,
                        field_types: fieldTypes
                    }
                };
            }

            if (resolvedMode.mode === 'lagged_pearson') {
                return await this.executeLaggedPearsonCorrelation({
                    query,
                    time_range,
                    index_name,
                    fields,
                    fieldTypes,
                    requested_mode: mode,
                    bucket,
                    max_lag,
                    limit,
                    sample_size
                });
            }

            return this.executeFpGrowthCorrelation({
                query,
                time_range,
                index_name,
                fields,
                fieldTypes,
                hits,
                requested_mode: mode,
                min_support,
                min_confidence,
                limit,
                sample_size,
                status: searchResult.status
            });
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行关联性分析出错: ${error.message}`
            };
        }
    }

    /**
     * 判断是否为数值字段
     */
    private detectCorrelationFieldTypes(
        hits: any[],
        fields: string[]
    ): Array<{
        field: string;
        detected_type: 'numeric' | 'categorical' | 'mixed' | 'unknown';
        sample_count: number;
        numeric_count: number;
        categorical_count: number;
    }> {
        return fields.map((field) => {
            let sampleCount = 0;
            let numericCount = 0;
            let categoricalCount = 0;

            hits.forEach((item) => {
                const rawValue = item?.[field];
                const values = Array.isArray(rawValue) ? rawValue : [rawValue];

                values.forEach((value) => {
                    if (value === null || value === undefined || value === '') {
                        return;
                    }

                    sampleCount += 1;
                    if (this.isNumericLike(value)) {
                        numericCount += 1;
                    } else {
                        categoricalCount += 1;
                    }
                });
            });

            let detectedType: 'numeric' | 'categorical' | 'mixed' | 'unknown' = 'unknown';
            if (sampleCount > 0) {
                if (numericCount > 0 && categoricalCount === 0) {
                    detectedType = 'numeric';
                } else if (categoricalCount > 0 && numericCount === 0) {
                    detectedType = 'categorical';
                } else if (numericCount > 0 && categoricalCount > 0) {
                    detectedType = 'mixed';
                }
            }

            return {
                field,
                detected_type: detectedType,
                sample_count: sampleCount,
                numeric_count: numericCount,
                categorical_count: categoricalCount
            };
        });
    }

    /**
     * 自动选择关联分析模式
     */
    private resolveCorrelationMode(
        requestedMode: 'lagged_pearson' | 'fp_growth' | 'auto',
        fieldTypes: Array<{ field: string; detected_type: 'numeric' | 'categorical' | 'mixed' | 'unknown' }>
    ): { mode: 'lagged_pearson' | 'fp_growth' } | { error: string } {
        const numericFields = fieldTypes.filter((item) => item.detected_type === 'numeric');
        const categoricalFields = fieldTypes.filter((item) => item.detected_type === 'categorical');
        const problematicFields = fieldTypes.filter(
            (item) => item.detected_type === 'mixed' || item.detected_type === 'unknown'
        );

        if (problematicFields.length > 0) {
            return {
                error: `字段类型判断不明确：${problematicFields
                    .map((item) => `${item.field}=${item.detected_type}`)
                    .join(', ')}。请改用纯数值字段或纯离散字段，避免混合输入。`
            };
        }

        if (requestedMode === 'lagged_pearson') {
            if (numericFields.length !== fieldTypes.length) {
                return {
                    error: `lagged_pearson 仅支持纯数值字段，当前检测到非数值字段：${fieldTypes
                        .filter((item) => item.detected_type !== 'numeric')
                        .map((item) => item.field)
                        .join(', ')}。`
                };
            }
            return { mode: 'lagged_pearson' };
        }

        if (requestedMode === 'fp_growth') {
            if (categoricalFields.length !== fieldTypes.length) {
                return {
                    error: `fp_growth 仅支持纯离散字段，当前检测到非离散字段：${fieldTypes
                        .filter((item) => item.detected_type !== 'categorical')
                        .map((item) => item.field)
                        .join(', ')}。`
                };
            }
            return { mode: 'fp_growth' };
        }

        if (numericFields.length === fieldTypes.length) {
            return { mode: 'lagged_pearson' };
        }

        if (categoricalFields.length === fieldTypes.length) {
            return { mode: 'fp_growth' };
        }

        return {
            error: `auto 模式要求 fields 全部为数值字段或全部为离散字段，当前检测结果为：${fieldTypes
                .map((item) => `${item.field}=${item.detected_type}`)
                .join(', ')}。`
        };
    }

    /**
     * 数值字段的滞后 Pearson 关联分析
     */
    private async executeLaggedPearsonCorrelation(params: {
        query: string;
        time_range: string;
        index_name: string;
        fields: string[];
        fieldTypes: Array<{
            field: string;
            detected_type: 'numeric' | 'categorical' | 'mixed' | 'unknown';
            sample_count: number;
            numeric_count: number;
            categorical_count: number;
        }>;
        requested_mode: 'lagged_pearson' | 'fp_growth' | 'auto';
        bucket?: string;
        max_lag: number;
        limit: number;
        sample_size: number;
    }): Promise<ApiResponse<CorrelationResult>> {
        const { query, time_range, index_name, fields, fieldTypes, requested_mode, bucket, max_lag, limit, sample_size } = params;
        const timechartResults = await Promise.all(
            fields.map((field) =>
                this.timechartQuery.execute({
                    query,
                    time_range,
                    index_name,
                    bucket,
                    metric_field: field
                })
            )
        );

        const failedResult = timechartResults.find((result) => result.error);
        if (failedResult) {
            return {
                error: failedResult.error,
                message: failedResult.message || '获取数值时间序列失败'
            };
        }

        const pairResults: Array<Record<string, any>> = [];
        for (let i = 0; i < fields.length; i++) {
            for (let j = i + 1; j < fields.length; j++) {
                const leftField = fields[i];
                const rightField = fields[j];
                const leftSeries = timechartResults[i].data?.series || [];
                const rightSeries = timechartResults[j].data?.series || [];
                const lagScores = this.calculateLaggedPearsonScores(leftSeries, rightSeries, max_lag);

                if (lagScores.length === 0) {
                    continue;
                }

                const sortedLagScores = [...lagScores].sort(
                    (a, b) => Math.abs(b.correlation) - Math.abs(a.correlation) || b.aligned_points - a.aligned_points
                );
                const best = sortedLagScores[0];

                pairResults.push({
                    kind: 'lagged_pearson',
                    field1: leftField,
                    field2: rightField,
                    best_lag: best.lag,
                    best_correlation: best.correlation,
                    best_alignment_points: best.aligned_points,
                    relationship: this.describeLagRelationship(leftField, rightField, best.lag),
                    lag_scores: sortedLagScores
                });
            }
        }

        const results = pairResults
            .sort(
                (a, b) =>
                    Math.abs(Number(b.best_correlation) || 0) - Math.abs(Number(a.best_correlation) || 0) ||
                    (Number(b.best_alignment_points) || 0) - (Number(a.best_alignment_points) || 0)
            )
            .slice(0, limit);

        if (results.length === 0) {
            return {
                error: '数据不足',
                message: '未能从时间序列中构造足够的对齐数据来计算 lagged Pearson 相关。'
            };
        }

        const queries = timechartResults
            .map((result) => result.data?.query_executed)
            .filter((item): item is string => Boolean(item));

        return {
            status: Math.max(...timechartResults.map((result) => result.status || 200)),
            data: {
                mode: 'lagged_pearson',
                requested_mode,
                results,
                summary: this.buildLaggedPearsonSummary(results),
                evidence: {
                    field_types: fieldTypes,
                    bucket_used: timechartResults[0].data?.bucket_used,
                    query_executed: queries,
                    sample_size,
                    max_lag,
                    warnings: []
                }
            },
            message: '关联性分析完成'
        };
    }

    /**
     * 离散字段的 FP-Growth 关联分析
     */
    private executeFpGrowthCorrelation(params: {
        query: string;
        time_range: string;
        index_name: string;
        fields: string[];
        fieldTypes: Array<{
            field: string;
            detected_type: 'numeric' | 'categorical' | 'mixed' | 'unknown';
            sample_count: number;
            numeric_count: number;
            categorical_count: number;
        }>;
        hits: any[];
        requested_mode: 'lagged_pearson' | 'fp_growth' | 'auto';
        min_support: number;
        min_confidence: number;
        limit: number;
        sample_size: number;
        status?: number;
    }): ApiResponse<CorrelationResult> {
        const {
            query,
            fields,
            fieldTypes,
            hits,
            requested_mode,
            min_support,
            min_confidence,
            limit,
            sample_size,
            status = 200
        } = params;

        const transactions = this.buildTransactionsFromHits(hits, fields);
        if (transactions.length === 0) {
            return {
                error: '无有效事务',
                message: '样本中没有足够的离散字段值，无法进行 FP-Growth 分析。'
            };
        }

        const minSupportCount = Math.max(1, Math.ceil(transactions.length * min_support));
        const rawItemsets = this.mineFrequentItemsetsWithFPGrowth(
            transactions,
            minSupportCount,
            Math.min(fields.length, 4)
        );
        const supportMap = new Map<string, number>();
        rawItemsets.forEach((itemset) => {
            supportMap.set(this.serializeItemset(itemset.items), itemset.support_count);
        });

        const frequentItemsets = rawItemsets
            .map((itemset) => ({
                kind: 'frequent_itemset',
                items: itemset.items,
                support_count: itemset.support_count,
                support: itemset.support_count / transactions.length,
                score: (itemset.support_count / transactions.length) * itemset.items.length
            }))
            .sort((a, b) => b.score - a.score || b.support_count - a.support_count);

        const associationRules = this.generateAssociationRules(
            rawItemsets,
            transactions.length,
            min_confidence,
            supportMap
        );

        const results = [...associationRules, ...frequentItemsets]
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .slice(0, limit);

        return {
            status,
            data: {
                mode: 'fp_growth',
                requested_mode,
                results,
                summary: this.buildFpGrowthSummary(results, query),
                evidence: {
                    field_types: fieldTypes,
                    total_transactions: transactions.length,
                    sample_size,
                    warnings: frequentItemsets.length === 0
                        ? ['当前支持度阈值下未发现频繁项集，可尝试降低 min_support。']
                        : []
                }
            },
            message: '关联性分析完成'
        };
    }

    private calculateLaggedPearsonScores(
        leftSeries: TimeSeriesPoint[],
        rightSeries: TimeSeriesPoint[],
        maxLag: number
    ): Array<{ lag: number; correlation: number; aligned_points: number }> {
        const timeline = this.mergeTimeline(leftSeries, rightSeries);
        const leftMap = new Map(leftSeries.map((point) => [point.timestamp, point.value]));
        const rightMap = new Map(rightSeries.map((point) => [point.timestamp, point.value]));
        const leftValues = timeline.map((timestamp) => leftMap.get(timestamp) ?? null);
        const rightValues = timeline.map((timestamp) => rightMap.get(timestamp) ?? null);

        const scores: Array<{ lag: number; correlation: number; aligned_points: number }> = [];
        for (let lag = -maxLag; lag <= maxLag; lag++) {
            const alignedLeft: number[] = [];
            const alignedRight: number[] = [];

            for (let index = 0; index < timeline.length; index++) {
                const shiftedIndex = index + lag;
                if (shiftedIndex < 0 || shiftedIndex >= timeline.length) {
                    continue;
                }

                const leftValue = leftValues[index];
                const rightValue = rightValues[shiftedIndex];
                if (leftValue === null || rightValue === null) {
                    continue;
                }

                alignedLeft.push(leftValue);
                alignedRight.push(rightValue);
            }

            if (alignedLeft.length < 2) {
                continue;
            }

            scores.push({
                lag,
                correlation: this.statistics.calculateCorrelation(alignedLeft, alignedRight, false),
                aligned_points: alignedLeft.length
            });
        }

        return scores;
    }

    private mergeTimeline(leftSeries: TimeSeriesPoint[], rightSeries: TimeSeriesPoint[]): string[] {
        return Array.from(new Set([
            ...leftSeries.map((point) => point.timestamp),
            ...rightSeries.map((point) => point.timestamp)
        ])).sort((left, right) => this.compareTimestamps(left, right));
    }

    private compareTimestamps(left: string, right: string): number {
        const leftNumber = Number(left);
        const rightNumber = Number(right);

        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
        }

        return left.localeCompare(right);
    }

    private describeLagRelationship(field1: string, field2: string, lag: number): string {
        if (lag === 0) {
            return `${field1} 与 ${field2} 基本同步变化`;
        }

        if (lag > 0) {
            return `${field1} 领先 ${field2} ${lag} 个桶`;
        }

        return `${field2} 领先 ${field1} ${Math.abs(lag)} 个桶`;
    }

    private buildLaggedPearsonSummary(results: Array<Record<string, any>>): string {
        const topResult = results[0];
        if (!topResult) {
            return '未发现可解释的滞后相关关系。';
        }

        return `${topResult.field1} 与 ${topResult.field2} 的最佳相关系数为 ${Number(
            topResult.best_correlation
        ).toFixed(4)}，最佳 lag 为 ${topResult.best_lag}，说明 ${topResult.relationship}。`;
    }

    private buildTransactionsFromHits(hits: any[], fields: string[]): string[][] {
        return hits
            .map((item) => {
                const transaction = new Set<string>();
                fields.forEach((field) => {
                    this.normalizeDiscreteValues(item?.[field]).forEach((value) => {
                        transaction.add(`${field}=${value}`);
                    });
                });
                return Array.from(transaction);
            })
            .filter((transaction) => transaction.length > 0);
    }

    private normalizeDiscreteValues(value: any): string[] {
        if (value === null || value === undefined || value === '') {
            return [];
        }

        if (Array.isArray(value)) {
            return Array.from(
                new Set(
                    value
                        .flatMap((item) => this.normalizeDiscreteValues(item))
                        .filter((item) => item !== '')
                )
            );
        }

        if (typeof value === 'object') {
            return [JSON.stringify(value)];
        }

        return [String(value)];
    }

    private isNumericLike(value: any): boolean {
        if (typeof value === 'number') {
            return Number.isFinite(value);
        }

        if (typeof value !== 'string') {
            return false;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return false;
        }

        return Number.isFinite(Number(trimmed));
    }

    private mineFrequentItemsetsWithFPGrowth(
        transactions: string[][],
        minSupportCount: number,
        maxPatternSize: number
    ): Array<{ items: string[]; support_count: number }> {
        const weightedTransactions = transactions.map((items) => ({ items, count: 1 }));
        const { headerTable } = this.buildFPTree(weightedTransactions, minSupportCount);
        const itemsets: Array<{ items: string[]; support_count: number }> = [];

        this.mineFPTree(headerTable, [], itemsets, minSupportCount, maxPatternSize);

        const uniqueItemsets = new Map<string, { items: string[]; support_count: number }>();
        itemsets.forEach((itemset) => {
            const key = this.serializeItemset(itemset.items);
            const existing = uniqueItemsets.get(key);
            if (!existing || existing.support_count < itemset.support_count) {
                uniqueItemsets.set(key, {
                    items: [...itemset.items].sort(),
                    support_count: itemset.support_count
                });
            }
        });

        return Array.from(uniqueItemsets.values()).sort(
            (a, b) => b.support_count - a.support_count || b.items.length - a.items.length
        );
    }

    private buildFPTree(
        transactions: Array<{ items: string[]; count: number }>,
        minSupportCount: number
    ): {
        headerTable: Map<string, { count: number; nodes: Array<any> }>;
        root: any;
    } {
        const itemCounts = new Map<string, number>();
        transactions.forEach((transaction) => {
            Array.from(new Set(transaction.items)).forEach((item) => {
                itemCounts.set(item, (itemCounts.get(item) || 0) + transaction.count);
            });
        });

        const frequentItems = new Set(
            Array.from(itemCounts.entries())
                .filter(([, count]) => count >= minSupportCount)
                .map(([item]) => item)
        );

        const headerTable = new Map<string, { count: number; nodes: Array<any> }>();
        frequentItems.forEach((item) => {
            headerTable.set(item, {
                count: itemCounts.get(item) || 0,
                nodes: []
            });
        });

        const root = {
            item: null as string | null,
            count: 0,
            parent: null as any,
            children: new Map<string, any>()
        };

        transactions.forEach((transaction) => {
            const filteredItems = Array.from(new Set(transaction.items))
                .filter((item) => frequentItems.has(item))
                .sort((left, right) => {
                    const countDiff = (itemCounts.get(right) || 0) - (itemCounts.get(left) || 0);
                    return countDiff !== 0 ? countDiff : left.localeCompare(right);
                });

            if (filteredItems.length === 0) {
                return;
            }

            this.insertFPTreeTransaction(root, filteredItems, transaction.count, headerTable);
        });

        return { headerTable, root };
    }

    private insertFPTreeTransaction(
        root: any,
        items: string[],
        count: number,
        headerTable: Map<string, { count: number; nodes: Array<any> }>
    ): void {
        let currentNode = root;

        items.forEach((item) => {
            let childNode = currentNode.children.get(item);
            if (!childNode) {
                childNode = {
                    item,
                    count: 0,
                    parent: currentNode,
                    children: new Map<string, any>()
                };
                currentNode.children.set(item, childNode);
                headerTable.get(item)?.nodes.push(childNode);
            }

            childNode.count += count;
            currentNode = childNode;
        });
    }

    private mineFPTree(
        headerTable: Map<string, { count: number; nodes: Array<any> }>,
        suffix: string[],
        results: Array<{ items: string[]; support_count: number }>,
        minSupportCount: number,
        maxPatternSize: number
    ): void {
        const items = Array.from(headerTable.entries()).sort(
            (left, right) => left[1].count - right[1].count || left[0].localeCompare(right[0])
        );

        items.forEach(([item, metadata]) => {
            const pattern = [...suffix, item].sort();
            results.push({
                items: pattern,
                support_count: metadata.count
            });

            if (pattern.length >= maxPatternSize) {
                return;
            }

            const conditionalPatternBase = metadata.nodes
                .map((node) => {
                    const path: string[] = [];
                    let parent = node.parent;
                    while (parent && parent.item) {
                        path.unshift(parent.item);
                        parent = parent.parent;
                    }

                    return {
                        items: path,
                        count: node.count
                    };
                })
                .filter((patternBase) => patternBase.items.length > 0);

            if (conditionalPatternBase.length === 0) {
                return;
            }

            const conditionalTree = this.buildFPTree(conditionalPatternBase, minSupportCount);
            if (conditionalTree.headerTable.size === 0) {
                return;
            }

            this.mineFPTree(
                conditionalTree.headerTable,
                pattern,
                results,
                minSupportCount,
                maxPatternSize
            );
        });
    }

    private generateAssociationRules(
        itemsets: Array<{ items: string[]; support_count: number }>,
        transactionCount: number,
        minConfidence: number,
        supportMap: Map<string, number>
    ): Array<Record<string, any>> {
        const rules: Array<Record<string, any>> = [];

        itemsets
            .filter((itemset) => itemset.items.length >= 2)
            .forEach((itemset) => {
                const subsets = this.generateNonEmptyProperSubsets(itemset.items);
                subsets.forEach((antecedent) => {
                    const consequent = itemset.items.filter((item) => !antecedent.includes(item));
                    if (consequent.length === 0) {
                        return;
                    }

                    const antecedentSupportCount = supportMap.get(this.serializeItemset(antecedent));
                    const consequentSupportCount = supportMap.get(this.serializeItemset(consequent));
                    if (!antecedentSupportCount || !consequentSupportCount) {
                        return;
                    }

                    const support = itemset.support_count / transactionCount;
                    const confidence = itemset.support_count / antecedentSupportCount;
                    const consequentSupport = consequentSupportCount / transactionCount;
                    const lift = consequentSupport > 0 ? confidence / consequentSupport : 0;

                    if (confidence < minConfidence) {
                        return;
                    }

                    rules.push({
                        kind: 'association_rule',
                        antecedent,
                        consequent,
                        support_count: itemset.support_count,
                        support,
                        confidence,
                        lift,
                        score: lift * confidence
                    });
                });
            });

        return rules.sort(
            (a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.support || 0) - Number(a.support || 0)
        );
    }

    private generateNonEmptyProperSubsets(items: string[]): string[][] {
        const subsets: string[][] = [];
        const total = 1 << items.length;

        for (let mask = 1; mask < total - 1; mask++) {
            const subset: string[] = [];
            for (let bit = 0; bit < items.length; bit++) {
                if ((mask & (1 << bit)) !== 0) {
                    subset.push(items[bit]);
                }
            }
            subsets.push(subset);
        }

        return subsets;
    }

    private serializeItemset(items: string[]): string {
        return [...items].sort().join(' || ');
    }

    private buildFpGrowthSummary(results: Array<Record<string, any>>, query: string): string {
        const topRule = results.find((item) => item.kind === 'association_rule');
        if (topRule) {
            return `在查询 "${query}" 的样本中，规则 ${topRule.antecedent.join(', ')} => ${topRule.consequent.join(
                ', '
            )} 的置信度为 ${Number(topRule.confidence).toFixed(4)}，提升度为 ${Number(topRule.lift).toFixed(4)}。`;
        }

        const topItemset = results.find((item) => item.kind === 'frequent_itemset');
        if (topItemset) {
            return `在查询 "${query}" 的样本中，频繁组合 ${topItemset.items.join(', ')} 的支持度为 ${Number(
                topItemset.support
            ).toFixed(4)}。`;
        }

        return '当前支持度和置信度阈值下未发现明显的离散字段组合。';
    }

    /**
     * 根因分析建议：同时输出分布漂移和可疑切片
     */
    async executeRootCauseSuggestions(params: {
        query?: string;
        anomaly_window: string;
        baseline_window: string;
        index_name?: string;
        candidate_fields?: string[];
        significance_threshold?: number;
        topk?: number;
        field_value_limit?: number;
        sample_size?: number;
        slice_max_depth?: number;
        min_slice_support?: number;
        min_slice_lift?: number;
    }): Promise<ApiResponse<RootCauseAnalysisResult>> {
        try {
            const {
                query = '*',
                anomaly_window,
                baseline_window,
                index_name = 'yotta',
                candidate_fields = [],
                significance_threshold = 0.1,
                topk = 5,
                field_value_limit = 20,
                sample_size = 300,
                slice_max_depth = 2,
                min_slice_support = 0.05,
                min_slice_lift = 2
            } = params;

            const [anomalyFields, baselineFields, anomalyOverview, baselineOverview] = await Promise.all([
                this.logSearch.executeListFields(query, anomaly_window, index_name),
                this.logSearch.executeListFields(query, baseline_window, index_name),
                this.logSearch.executeLogSearchSheet(query, anomaly_window, index_name, { page: 0, size: 1 }),
                this.logSearch.executeLogSearchSheet(query, baseline_window, index_name, { page: 0, size: 1 })
            ]);

            if (anomalyFields.error || baselineFields.error) {
                return {
                    error: anomalyFields.error || baselineFields.error || '字段信息获取失败',
                    message: anomalyFields.message || baselineFields.message || '根因分析前置字段信息获取失败'
                };
            }

            const fieldsToAnalyze = candidate_fields.length > 0
                ? Array.from(new Set(candidate_fields.filter(Boolean)))
                : this.selectRootCauseFields(
                    baselineFields.data?.fields || [],
                    anomalyFields.data?.fields || [],
                    Math.max(topk * 2, 6)
                );

            const distributionDrift: DistributionDriftItem[] = [];
            for (const field of fieldsToAnalyze) {
                const [baselineCounts, anomalyCounts] = await Promise.all([
                    this.getFieldDistribution(query, baseline_window, index_name, field, field_value_limit),
                    this.getFieldDistribution(query, anomaly_window, index_name, field, field_value_limit)
                ]);

                const drift = this.analyzeFieldDistributionDrift(
                    baselineCounts,
                    anomalyCounts,
                    Math.max(topk, Math.min(field_value_limit, 10))
                );
                if (!drift || drift.drift_score < significance_threshold) {
                    continue;
                }

                distributionDrift.push({
                    field,
                    ...drift,
                    hypothesis: this.generateDistributionHypothesis(field, drift.changed_values)
                });
            }

            distributionDrift.sort((a, b) => b.drift_score - a.drift_score);

            const suspiciousSlices = await this.mineSuspiciousSlices({
                query,
                anomaly_window,
                baseline_window,
                index_name,
                fields: fieldsToAnalyze,
                sample_size,
                slice_max_depth,
                min_slice_support,
                min_slice_lift,
                topk
            });

            const suggestedQueries = this.generateRootCauseSuggestedQueries(
                query,
                distributionDrift,
                suspiciousSlices
            );
            const summary = this.generateRootCauseSummary(
                query,
                distributionDrift,
                suspiciousSlices,
                anomalyOverview.data?.total || 0,
                baselineOverview.data?.total || 0
            );

            return {
                status: Math.max(
                    anomalyFields.status || 200,
                    baselineFields.status || 200,
                    anomalyOverview.status || 200,
                    baselineOverview.status || 200
                ),
                data: {
                    analyzed_fields: fieldsToAnalyze,
                    distribution_drift: distributionDrift.slice(0, topk),
                    suspicious_slices: suspiciousSlices.slice(0, topk),
                    suggested_queries: suggestedQueries,
                    summary
                },
                message: '根因分析建议生成完成'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行根因分析出错: ${error.message}`
            };
        }
    }

    /**
     * 自动挑选一组适合做根因分析的字段
     */
    private selectRootCauseFields(
        baselineFields: any[],
        anomalyFields: any[],
        limit: number
    ): string[] {
        const anomalyFieldMap = new Map(anomalyFields.map((field) => [field.name, field]));

        return baselineFields
            .filter((field) => anomalyFieldMap.has(field.name))
            .filter((field) => {
                const distinctCount = Number(field?.distinct_count || anomalyFieldMap.get(field.name)?.distinct_count || 0);
                const fieldName = String(field?.name || '');
                return fieldName.length > 0 &&
                    !fieldName.startsWith('_') &&
                    distinctCount > 1 &&
                    distinctCount <= 200;
            })
            .sort((left, right) => {
                const leftDistinct = Number(left?.distinct_count || 0);
                const rightDistinct = Number(right?.distinct_count || 0);
                const leftTotal = Number(left?.total || 0) + Number(anomalyFieldMap.get(left.name)?.total || 0);
                const rightTotal = Number(right?.total || 0) + Number(anomalyFieldMap.get(right.name)?.total || 0);
                return leftDistinct - rightDistinct || rightTotal - leftTotal;
            })
            .map((field) => field.name)
            .slice(0, limit);
    }

    /**
     * 计算单字段在两个窗口中的分布漂移
     */
    private analyzeFieldDistributionDrift(
        baselineCounts: Record<string, number>,
        anomalyCounts: Record<string, number>,
        topk: number
    ): Omit<DistributionDriftItem, 'field' | 'hypothesis'> | null {
        const allValues = Array.from(new Set([...Object.keys(baselineCounts), ...Object.keys(anomalyCounts)]));
        const baselineTotal = Object.values(baselineCounts).reduce((sum, count) => sum + count, 0);
        const anomalyTotal = Object.values(anomalyCounts).reduce((sum, count) => sum + count, 0);

        if (allValues.length === 0 || baselineTotal === 0 || anomalyTotal === 0) {
            return null;
        }

        const baselineDistribution = allValues.map((value) => (baselineCounts[value] || 0) / baselineTotal);
        const anomalyDistribution = allValues.map((value) => (anomalyCounts[value] || 0) / anomalyTotal);
        const driftScore = this.jensenShannonDivergence(baselineDistribution, anomalyDistribution);

        const changedValues = allValues
            .map((value) => {
                const baselineCount = baselineCounts[value] || 0;
                const anomalyCount = anomalyCounts[value] || 0;
                const baselineSupport = baselineCount / baselineTotal;
                const anomalySupport = anomalyCount / anomalyTotal;
                const supportDelta = anomalySupport - baselineSupport;
                const changeRatio = baselineCount > 0
                    ? (anomalyCount - baselineCount) / baselineCount
                    : (anomalyCount > 0 ? anomalyCount : 0);

                return {
                    value,
                    baseline_count: baselineCount,
                    anomaly_count: anomalyCount,
                    baseline_support: baselineSupport,
                    anomaly_support: anomalySupport,
                    support_delta: supportDelta,
                    change_ratio: changeRatio,
                    contribution_score: Math.abs(supportDelta),
                    direction: supportDelta > 0 ? 'up' as const : supportDelta < 0 ? 'down' as const : 'flat' as const
                };
            })
            .filter((item) => item.baseline_count > 0 || item.anomaly_count > 0)
            .sort((a, b) => b.contribution_score - a.contribution_score)
            .slice(0, topk);

        return {
            drift_score: driftScore,
            baseline_total: baselineTotal,
            anomaly_total: anomalyTotal,
            changed_values: changedValues
        };
    }

    /**
     * 为单字段漂移生成自然语言假设
     */
    private generateDistributionHypothesis(field: string, changedValues: DistributionValueChange[]): string {
        if (changedValues.length === 0) {
            return `字段 ${field} 有轻微漂移，但没有足够突出的值变化。`;
        }

        const topChange = changedValues[0];
        const directionText = topChange.direction === 'up' ? '上升' : topChange.direction === 'down' ? '下降' : '波动';
        return `字段 ${field} 的分布发生明显漂移，最突出的值是 "${topChange.value}"，在异常窗口中的占比${directionText}到 ${(topChange.anomaly_support * 100).toFixed(1)}%。`;
    }

    /**
     * 在异常窗口中挖掘高支持度、高提升度的可疑切片
     */
    private async mineSuspiciousSlices(params: {
        query: string;
        anomaly_window: string;
        baseline_window: string;
        index_name: string;
        fields: string[];
        sample_size: number;
        slice_max_depth: number;
        min_slice_support: number;
        min_slice_lift: number;
        topk: number;
    }): Promise<SuspiciousSliceItem[]> {
        const {
            query,
            anomaly_window,
            baseline_window,
            index_name,
            fields,
            sample_size,
            slice_max_depth,
            min_slice_support,
            min_slice_lift,
            topk
        } = params;

        if (fields.length === 0) {
            return [];
        }

        const sampledFields = fields.slice(0, Math.max(4, Math.min(fields.length, 6)));
        const [anomalySample, baselineSample, anomalyTotal, baselineTotal] = await Promise.all([
            this.logSearch.executeLogSearchSheet(query, anomaly_window, index_name, { page: 0, size: sample_size }, sampledFields),
            this.logSearch.executeLogSearchSheet(query, baseline_window, index_name, { page: 0, size: sample_size }, sampledFields),
            this.getExactQueryCount(query, anomaly_window, index_name),
            this.getExactQueryCount(query, baseline_window, index_name)
        ]);

        if (anomalySample.error || baselineSample.error || anomalyTotal <= 0 || baselineTotal <= 0) {
            return [];
        }

        const anomalyHits = anomalySample.data?.hits || [];
        const baselineHits = baselineSample.data?.hits || [];
        if (anomalyHits.length === 0) {
            return [];
        }

        const perFieldLimit = 3;
        const minSampleCount = Math.max(1, Math.ceil(anomalyHits.length * min_slice_support));
        const termsByField = new Map<string, SliceTerm[]>();

        sampledFields.forEach((field) => {
            const counts = new Map<string, number>();
            anomalyHits.forEach((hit) => {
                this.normalizeDiscreteValues(hit?.[field]).forEach((value) => {
                    if (this.shouldSkipSliceValue(value)) {
                        return;
                    }
                    counts.set(value, (counts.get(value) || 0) + 1);
                });
            });

            const terms = Array.from(counts.entries())
                .filter(([, count]) => count >= minSampleCount)
                .sort((a, b) => b[1] - a[1])
                .slice(0, perFieldLimit)
                .map(([value]) => ({ field, value }));

            if (terms.length > 0) {
                termsByField.set(field, terms);
            }
        });

        const candidateSlices = this.generateSliceCandidates(
            termsByField,
            Math.max(1, Math.min(slice_max_depth, 3))
        );

        const preliminarySlices = candidateSlices
            .map((terms) => {
                const anomalyCount = this.countSliceMatches(anomalyHits, terms);
                const baselineCount = this.countSliceMatches(baselineHits, terms);
                const anomalySupport = anomalyHits.length > 0 ? anomalyCount / anomalyHits.length : 0;
                const baselineSupport = baselineHits.length > 0 ? baselineCount / baselineHits.length : 0;
                const lift = this.calculateLift(anomalySupport, baselineSupport, baselineHits.length);
                const score = this.calculateSliceScore(anomalySupport, lift, terms.length);
                return { terms, anomalySupport, lift, score };
            })
            .filter((item) => item.anomalySupport >= min_slice_support && item.lift >= min_slice_lift)
            .sort((a, b) => b.score - a.score)
            .slice(0, Math.max(topk * 3, 10));

        const exactSlices: SuspiciousSliceItem[] = [];
        for (const candidate of preliminarySlices) {
            const sliceQuery = this.buildSliceQuery(query, candidate.terms);
            const [anomalyCount, baselineCount] = await Promise.all([
                this.getExactQueryCount(sliceQuery, anomaly_window, index_name),
                this.getExactQueryCount(sliceQuery, baseline_window, index_name)
            ]);

            const anomalySupport = anomalyTotal > 0 ? anomalyCount / anomalyTotal : 0;
            const baselineSupport = baselineTotal > 0 ? baselineCount / baselineTotal : 0;
            const lift = this.calculateLift(anomalySupport, baselineSupport, baselineTotal);
            const score = this.calculateSliceScore(anomalySupport, lift, candidate.terms.length);

            if (anomalySupport < min_slice_support || lift < min_slice_lift) {
                continue;
            }

            exactSlices.push({
                slice: Object.fromEntries(candidate.terms.map((term) => [term.field, term.value])),
                slice_terms: candidate.terms.map((term) => `${term.field}=${term.value}`),
                depth: candidate.terms.length,
                anomaly_count: anomalyCount,
                baseline_count: baselineCount,
                anomaly_support: anomalySupport,
                baseline_support: baselineSupport,
                lift,
                score,
                query: sliceQuery
            });
        }

        return exactSlices
            .sort((a, b) => b.score - a.score)
            .filter((item, index, array) => array.findIndex((candidate) => candidate.query === item.query) === index)
            .slice(0, topk);
    }

    private generateSliceCandidates(termsByField: Map<string, SliceTerm[]>, maxDepth: number): SliceTerm[][] {
        const fieldEntries = Array.from(termsByField.entries());
        const results: SliceTerm[][] = [];

        const backtrack = (startIndex: number, current: SliceTerm[]) => {
            if (current.length > 0) {
                results.push([...current]);
            }
            if (current.length >= maxDepth) {
                return;
            }

            for (let index = startIndex; index < fieldEntries.length; index++) {
                const [, terms] = fieldEntries[index];
                terms.forEach((term) => {
                    current.push(term);
                    backtrack(index + 1, current);
                    current.pop();
                });
            }
        };

        backtrack(0, []);
        return results;
    }

    private countSliceMatches(hits: any[], terms: SliceTerm[]): number {
        return hits.filter((hit) => this.sliceMatchesHit(hit, terms)).length;
    }

    private sliceMatchesHit(hit: any, terms: SliceTerm[]): boolean {
        return terms.every((term) => this.normalizeDiscreteValues(hit?.[term.field]).includes(term.value));
    }

    private shouldSkipSliceValue(value: string): boolean {
        const trimmed = value.trim();
        return trimmed.length === 0 || trimmed.length > 80 || trimmed.includes('\n');
    }

    private buildSliceQuery(baseQuery: string, terms: SliceTerm[]): string {
        const clauses = terms.map((term) => `${term.field}:"${this.escapeQueryValue(term.value)}"`);
        if (baseQuery === '*' || baseQuery.trim() === '') {
            return clauses.join(' AND ');
        }
        return `(${baseQuery}) AND ${clauses.join(' AND ')}`;
    }

    private escapeQueryValue(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    private calculateLift(anomalySupport: number, baselineSupport: number, baselineTotal: number): number {
        if (baselineSupport > 0) {
            return anomalySupport / baselineSupport;
        }
        if (anomalySupport <= 0) {
            return 0;
        }
        return anomalySupport / (1 / Math.max(baselineTotal, 1));
    }

    private calculateSliceScore(anomalySupport: number, lift: number, depth: number): number {
        return Number((anomalySupport * Math.log2(lift + 1) * depth).toFixed(6));
    }

    private async getExactQueryCount(query: string, timeRange: string, indexName: string): Promise<number> {
        const countResult = await this.logSearch.executeLogSearchSheet(
            `${query} | stats count() as count`,
            timeRange,
            indexName,
            { page: 0, size: 1 },
            ['count']
        );

        if (countResult.error) {
            return 0;
        }

        return Number(countResult.data?.hits?.[0]?.count || 0);
    }

    /**
     * 生成建议查询
     */
    private generateRootCauseSuggestedQueries(
        baseQuery: string,
        distributionDrift: DistributionDriftItem[],
        suspiciousSlices: SuspiciousSliceItem[]
    ): string[] {
        const queries = new Set<string>();

        suspiciousSlices.forEach((slice) => {
            queries.add(slice.query);
        });

        distributionDrift.forEach((item) => {
            const topIncrease = item.changed_values.find((change) => change.direction === 'up');
            if (topIncrease) {
                queries.add(this.buildSliceQuery(baseQuery, [{ field: item.field, value: topIncrease.value }]));
            }
        });

        return Array.from(queries).slice(0, 5);
    }

    /**
     * 生成根因总结
     */
    private generateRootCauseSummary(
        originalQuery: string,
        distributionDrift: DistributionDriftItem[],
        suspiciousSlices: SuspiciousSliceItem[],
        anomalyTotal: number,
        baselineTotal: number
    ): string {
        if (distributionDrift.length === 0 && suspiciousSlices.length === 0) {
            return '未发现明显的分布漂移或可疑切片。建议扩大时间窗口、补充候选字段，或适当降低切片支持度/提升度阈值。';
        }

        const parts: string[] = [
            `基于查询 "${originalQuery}"，异常窗口日志量 ${anomalyTotal}，基线窗口日志量 ${baselineTotal}。`
        ];

        if (distributionDrift.length > 0) {
            const topDrift = distributionDrift[0];
            parts.push(`分布漂移最明显的字段是 ${topDrift.field}，漂移分数为 ${topDrift.drift_score.toFixed(4)}。`);
        }

        if (suspiciousSlices.length > 0) {
            const topSlice = suspiciousSlices[0];
            parts.push(`最可疑的切片是 ${topSlice.slice_terms.join(' AND ')}，异常支持度 ${(topSlice.anomaly_support * 100).toFixed(1)}%，提升度 ${topSlice.lift.toFixed(2)}。`);
        }

        return parts.join('\n');
    }

    /**
     * 异常点标识
     */
    async executeAnomalyPoints(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        bucket?: string;
        metric_field?: string;
        method?: string;
        sensitivity?: number;
        min_support?: number;
    }): Promise<ApiResponse<any>> {
        // 使用统计模块的异常检测功能
        const statistics = new StatisticsModule(this.client);
        return statistics.executeAnomalyPoints(
            params.query || '*',
            params.time_range,
            params.index_name || 'yotta',
            params.bucket,
            params.metric_field,
            params.method || 'zscore',
            params.sensitivity || 3,
            params.min_support || 0
        );
    }

    /**
     * 趋势概要
     */
    async executeTrendSummary(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        bucket?: string;
        metric_field?: string;
        limit_peaks?: number;
    }): Promise<ApiResponse<any>> {
        // 使用统计模块的趋势分析功能
        const statistics = new StatisticsModule(this.client);
        return statistics.executeTrendSummary(
            params.query || '*',
            params.time_range,
            params.index_name || 'yotta',
            params.bucket,
            params.metric_field,
            params.limit_peaks || 3
        );
    }

    /**
     * 数据概览
     */
    async executeDataOverview(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        metric_field?: string;
        percentiles?: number[];
    }): Promise<ApiResponse<any>> {
        // 使用统计模块的数据概览功能
        const statistics = new StatisticsModule(this.client);
        return statistics.executeDataOverview(
            params.query || '*',
            params.time_range,
            params.index_name || 'yotta',
            params.metric_field,
            params.percentiles || [50, 90, 99]
        );
    }

    /**
     * 趋势预测
     */
    async executeTrendForecast(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        bucket?: string;
        horizon?: number;
        method?: string;
        confidence?: number;
        metric_field?: string;
        window?: number;
        alpha?: number;
    }): Promise<ApiResponse<any>> {
        // 使用趋势预测模块的功能
        const trendForecast = new TrendForecastModule(this.client);
        return trendForecast.executeTrendForecast(params);
    }

    /**
     * 异常预警
     */
    async executeAnomalyAlert(params: {
        query?: string;
        time_range: string;
        index_name?: string;
        bucket?: string;
        method?: string;
        threshold?: number;
        alert_on?: string;
        min_anomaly_points?: number;
        forecast_horizon?: number;
        metric_field?: string;
    }): Promise<ApiResponse<any>> {
        // 使用趋势预测模块的异常预警功能
        const trendForecast = new TrendForecastModule(this.client);
        return trendForecast.executeAnomalyAlert(params);
    }
}

// 为了向后兼容，导出模块实例创建函数
export function createAnomalyDetectionModule(client: LogEaseClient): AnomalyDetectionModule {
    return new AnomalyDetectionModule(client);
}

export function createTrendForecastModule(client: LogEaseClient): TrendForecastModule {
    return new TrendForecastModule(client);
}

export function createStatisticsModule(client: LogEaseClient): StatisticsModule {
    return new StatisticsModule(client);
}

export function createLogSearchModule(client: LogEaseClient): LogSearchModule {
    return new LogSearchModule(client);
}

// 为了向后兼容，保持原有的模块导入
import { LogSearchModule } from './log-search.js';
import { TimechartQueryModule } from './timechart-query.js';
import { TrendForecastModule } from './trend-forecast.js';
