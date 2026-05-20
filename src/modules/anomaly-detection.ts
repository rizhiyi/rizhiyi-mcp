import { LogEaseClient } from '../client.js';
import { ApiResponse, PeriodComparisonResult, CorrelationResult, RootCauseAnalysisResult, TimeSeriesPoint } from '../types.js';
import { StatisticsModule } from './statistics.js';

export class AnomalyDetectionModule {
    private statistics: StatisticsModule;
    private logSearch: LogSearchModule;

    constructor(private client: LogEaseClient) {
        this.statistics = new StatisticsModule(client);
        this.logSearch = new LogSearchModule(client);
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

    /**
     * 模式识别和分类 - 基于日志聚类结果进行高级分析
     * 接收来自 executeLogReducePreview 的结果，对模式进行深度分析
     */
    async executePatternClassification(logReduceResult: any, limit: number = 20): Promise<ApiResponse<any>> {
        try {
            // 验证输入数据
            if (!logReduceResult?.data?.result?.body) {
                return {
                    error: '无效数据',
                    message: '缺少有效的日志聚类分析结果'
                };
            }

            const patterns = logReduceResult.data.result.body;
            const totalHits = logReduceResult.data.result.total_hits || 0;
            
            if (!Array.isArray(patterns) || patterns.length === 0) {
                return {
                    error: '无模式数据',
                    message: '日志聚类分析结果中没有找到模式'
                };
            }

            // 执行高级模式分析
            const analysisResults = this.analyzePatterns(patterns, totalHits);
            
            // 提取并分类模式，应用限制
            const classifiedPatterns = analysisResults.patterns
                .sort((a, b) => b.significance_score - a.significance_score)
                .slice(0, limit);

            return {
                status: 200,
                data: {
                    total_patterns: patterns.length,
                    total_hits: totalHits,
                    patterns: classifiedPatterns,
                    analysis_summary: analysisResults.summary,
                    raw_result: logReduceResult.data
                },
                message: '模式识别和高级分析完成'
            };
        } catch (error: any) {
            return {
                error: error.message,
                message: `执行模式识别出错: ${error.message}`
            };
        }
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
            const timelineAnalysis = this.analyzePatternTimeline(pattern);
            const frequencyAnalysis = this.analyzePatternFrequency(pattern, totalHits);
            const anomalyAnalysis = this.detectPatternAnomalies(pattern);
            
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
            
            const pointsA = timeSeriesA.data?.points || [];
            const pointsB = timeSeriesB.data?.points || [];

            if (pointsA.length === 0 || pointsB.length === 0) {
                return {
                    error: '数据不完整',
                    message: '无法获取完整的时间段数据'
                };
            }

            // 提取数值用于统计分析
            const valuesA = pointsA.map((point: any) => point.count || 0);
            const valuesB = pointsB.map((point: any) => point.count || 0);

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

            const seriesA: TimeSeriesPoint[] = pointsA.map((point: any) => ({
                timestamp: String(point.time),
                value: point.count || 0,
                count: point.count || 0
            }));

            const seriesB: TimeSeriesPoint[] = pointsB.map((point: any) => ({
                timestamp: String(point.time),
                value: point.count || 0,
                count: point.count || 0
            }));

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
     * 跨时间段对比分析 - 复用 log-search.ts 的时间序列数据获取功能
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
                bucket = '5m',
                compare_fields = [],
                topk = 10,
                metric_field
            } = params;

            // 使用 log-search 模块获取两个时间段的时间序列数据
            const [periodAResult, periodBResult] = await Promise.all([
                this.logSearch.executeTimeSeriesCounts(query, time_range_a, index_name, bucket, metric_field),
                this.logSearch.executeTimeSeriesCounts(query, time_range_b, index_name, bucket, metric_field)
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

            const pointsA = periodAResult.data?.points || [];
            const pointsB = periodBResult.data?.points || [];

            if (pointsA.length === 0 || pointsB.length === 0) {
                return {
                    error: '数据不完整',
                    message: '无法获取完整的时间段数据'
                };
            }

            // 提取数值用于统计分析
            const valuesA = pointsA.map(point => point.count || 0);
            const valuesB = pointsB.map(point => point.count || 0);

            // 计算基础统计信息
            const totalA = valuesA.reduce((sum, val) => sum + val, 0);
            const totalB = valuesB.reduce((sum, val) => sum + val, 0);

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

            const seriesA: TimeSeriesPoint[] = pointsA.map(point => ({
                timestamp: String(point.time),
                value: point.count || 0,
                count: point.count || 0
            }));

            const seriesB: TimeSeriesPoint[] = pointsB.map(point => ({
                timestamp: String(point.time),
                value: point.count || 0,
                count: point.count || 0
            }));

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
                    field_differences: fieldDifferences
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
        field: string
    ): Promise<Record<string, number>> {
        const apiPath = '/api/v3/search/sheets/';
        const params = {
            query,
            time_range: timeRange,
            index_name: indexName,
            page: 0,
            size: 0
        };

        const result = await this.client.get<any>(apiPath, params);
        
        if (result.error || !result.data?.fields?.[field]?.top_values) {
            return {};
        }

        const distribution: Record<string, number> = {};
        result.data.fields[field].top_values.forEach((item: any) => {
            distribution[item.value] = item.count;
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
        method?: string;
        limit?: number;
    }): Promise<ApiResponse<CorrelationResult>> {
        try {
            const {
                query = '*',
                time_range,
                index_name = 'yotta',
                fields = [],
                method = 'mixed',
                limit = 50
            } = params;

            if (fields.length < 2) {
                return {
                    error: '字段不足',
                    message: '需要至少2个字段进行关联性分析'
                };
            }

            // 使用 log-search 模块获取日志数据
            const searchResult = await this.logSearch.executeLogSearchSheet(query, time_range, index_name, 1000);
            
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

            // 提取字段数据
            const fieldData: Record<string, number[]> = {};
            fields.forEach(field => {
                fieldData[field] = hits
                    .map((item: any) => {
                        const value = item[field];
                        if (typeof value === 'number') return value;
                        if (typeof value === 'string' && !isNaN(Number(value))) return Number(value);
                        return null;
                    })
                    .filter((val: number | null) => val !== null) as number[];
            });

            // 计算相关系数
            const correlations: Array<{field1: string, field2: string, correlation: number, method: string, significance?: number}> = [];
            
            for (let i = 0; i < fields.length; i++) {
                for (let j = i + 1; j < fields.length; j++) {
                    const field1 = fields[i];
                    const field2 = fields[j];
                    
                    const data1 = fieldData[field1];
                    const data2 = fieldData[field2];
                    
                    if (data1.length === 0 || data2.length === 0) continue;
                    
                    // 确保数据长度一致
                    const minLength = Math.min(data1.length, data2.length);
                    const trimmed1 = data1.slice(0, minLength);
                    const trimmed2 = data2.slice(0, minLength);
                    
                    let correlation = 0;
                    let methodUsed = 'pearson';
                    
                    if (method === 'mixed') {
                        // 简单的混合方法：数值字段用pearson，其他用spearman
                        const isNumeric1 = this.isNumericField(trimmed1);
                        const isNumeric2 = this.isNumericField(trimmed2);
                        
                        if (isNumeric1 && isNumeric2) {
                            correlation = this.statistics.calculateCorrelation(trimmed1, trimmed2, false);
                        } else {
                            correlation = this.statistics.calculateCorrelation(trimmed1, trimmed2, true);
                            methodUsed = 'spearman';
                        }
                    } else if (method === 'categorical') {
                        // 对于分类数据，计算共现关系
                        continue; // 单独处理
                    } else {
                        correlation = this.statistics.calculateCorrelation(trimmed1, trimmed2, method === 'spearman');
                        methodUsed = method;
                    }
                    
                    correlations.push({
                        field1,
                        field2,
                        correlation,
                        method: methodUsed
                    });
                }
            }

            // 计算分类字段的共现关系
            let cooccurrence: Array<{field1: string, field2: string, cooccurrence: number, support: number}> = [];
            if (method === 'categorical' || method === 'mixed') {
                cooccurrence = await this.calculateCooccurrence(hits, fields, limit);
            }

            return {
                status: searchResult.status,
                data: {
                    correlations: correlations.slice(0, limit),
                    cooccurrence
                },
                message: '关联性分析完成'
            };
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
    private isNumericField(data: number[]): boolean {
        // 简单的启发式判断：如果数据变化较大，认为是数值型
        if (data.length < 2) return true;
        
        const uniqueValues = new Set(data).size;
        const ratio = uniqueValues / data.length;
        
        return ratio > 0.7; // 如果唯一值比例较高，认为是数值型
    }

    /**
     * 计算共现关系
     */
    private async calculateCooccurrence(
        data: any[],
        fields: string[],
        limit: number
    ): Promise<Array<{field1: string, field2: string, cooccurrence: number, support: number}>> {
        const cooccurrenceMap: Map<string, number> = new Map();
        
        data.forEach(item => {
            for (let i = 0; i < fields.length; i++) {
                for (let j = i + 1; j < fields.length; j++) {
                    const field1 = fields[i];
                    const field2 = fields[j];
                    const value1 = item[field1];
                    const value2 = item[field2];
                    
                    if (value1 !== undefined && value2 !== undefined) {
                        const key = `${field1}:${value1}||${field2}:${value2}`;
                        cooccurrenceMap.set(key, (cooccurrenceMap.get(key) || 0) + 1);
                    }
                }
            }
        });

        const cooccurrence: Array<{field1: string, field2: string, cooccurrence: number, support: number}> = [];
        
        // 转换为所需格式
        const fieldPairs = new Set<string>();
        fields.forEach((field1, i) => {
            fields.slice(i + 1).forEach(field2 => {
                fieldPairs.add(`${field1}||${field2}`);
            });
        });

        fieldPairs.forEach(pair => {
            const [field1, field2] = pair.split('||');
            const pairData = Array.from(cooccurrenceMap.entries())
                .filter(([key]) => key.startsWith(`${field1}:`) && key.includes(`||${field2}:`))
                .map(([key, count]) => ({ key, count }));
            
            const totalCooccurrence = pairData.reduce((sum, item) => sum + item.count, 0);
            const support = totalCooccurrence / data.length;
            
            if (totalCooccurrence > 0) {
                cooccurrence.push({
                    field1,
                    field2,
                    cooccurrence: totalCooccurrence,
                    support
                });
            }
        });

        return cooccurrence
            .sort((a, b) => b.support - a.support)
            .slice(0, limit);
    }

    /**
     * 根因分析建议 - 复用 log-search.ts 的字段列表功能
     */
    async executeRootCauseSuggestions(params: {
        query?: string;
        anomaly_window: string;
        baseline_window: string;
        index_name?: string;
        candidate_fields?: string[];
        significance_threshold?: number;
        topk?: number;
    }): Promise<ApiResponse<RootCauseAnalysisResult>> {
        try {
            const {
                query = '*',
                anomaly_window,
                baseline_window,
                index_name = 'yotta',
                candidate_fields = [],
                significance_threshold = 0.1,
                topk = 5
            } = params;

            // 使用 log-search 模块获取两个时间窗口的字段信息
            const [anomalyFields, baselineFields] = await Promise.all([
                this.logSearch.executeListFields(query, anomaly_window, index_name),
                this.logSearch.executeListFields(query, baseline_window, index_name)
            ]);

            const suggestions: Array<{
                field: string;
                hypothesis: string;
                top_changes: Array<{value: string, baseline_count: number, anomaly_count: number, change_ratio: number}>;
            }> = [];

            // 分析每个候选字段
            const fieldsToAnalyze = candidate_fields.length > 0 ? candidate_fields : 
                                  this.getCommonFields(baselineFields.data?.fields || [], anomalyFields.data?.fields || []);

            for (const field of fieldsToAnalyze) {
                const baselineFieldData = baselineFields.data?.fields?.find((f: any) => f.name === field);
                const anomalyFieldData = anomalyFields.data?.fields?.find((f: any) => f.name === field);
                
                // 处理字段数据格式 - log-search 返回标准化的字段信息
                const baselineTopValues = baselineFieldData?.top_values || [];
                const anomalyTopValues = anomalyFieldData?.top_values || [];

                const baselineData = { top_values: baselineTopValues };
                const anomalyData = { top_values: anomalyTopValues };

                // 转换为计数映射
                const baselineCounts: Record<string, number> = {};
                const anomalyCounts: Record<string, number> = {};

                baselineData.top_values.forEach((item: any) => {
                    baselineCounts[item.value] = item.count;
                });

                anomalyData.top_values.forEach((item: any) => {
                    anomalyCounts[item.value] = item.count;
                });

                // 计算分布差异
                const differences = this.calculateDistributionDifferences(
                    baselineCounts, anomalyCounts, topk
                );

                // 过滤显著差异
                const significantChanges = differences.filter(d => d.jsd > significance_threshold);

                if (significantChanges.length > 0) {
                    const hypothesis = this.generateRootCauseHypothesis(field, significantChanges);
                    
                    suggestions.push({
                        field,
                        hypothesis,
                        top_changes: significantChanges.map(d => ({
                            value: d.value,
                            baseline_count: d.baseline_count,
                            anomaly_count: d.anomaly_count,
                            change_ratio: d.change_ratio
                        }))
                    });
                }
            }

            // 生成建议查询
            const suggestedQueries = this.generateSuggestedQueries(query, suggestions);
            
            // 生成总结
            const summary = this.generateRootCauseSummary(suggestions, query);

            return {
                status: Math.max(baselineFields.status || 200, anomalyFields.status || 200),
                data: {
                    suggestions: suggestions.slice(0, topk),
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
     * 获取两个字段列表的交集，用于根因分析
     */
    private getCommonFields(baselineFields: any[], anomalyFields: any[]): string[] {
        const baselineFieldNames = new Set(baselineFields.map(f => f.name));
        const anomalyFieldNames = new Set(anomalyFields.map(f => f.name));
        
        // 返回两个字段列表的交集
        return Array.from(baselineFieldNames).filter(name => anomalyFieldNames.has(name));
    }

    /**
     * 生成根因假设
     */
    private generateRootCauseHypothesis(
        field: string,
        topChanges: Array<{value: string, baseline_count: number, anomaly_count: number, change_ratio: number}>
    ): string {
        const increases = topChanges.filter(d => d.change_ratio > 0);
        const decreases = topChanges.filter(d => d.change_ratio < 0);
        
        let hypothesis = `字段 ${field} 的分布发生显著变化：`;
        
        if (increases.length > 0) {
            const topIncrease = increases[0];
            hypothesis += `值 "${topIncrease.value}" 从 ${topIncrease.baseline_count} 增加到 ${topIncrease.anomaly_count}（增长 ${(topIncrease.change_ratio * 100).toFixed(1)}%）`;
        }
        
        if (decreases.length > 0) {
            if (increases.length > 0) hypothesis += '；';
            const topDecrease = decreases[0];
            hypothesis += `值 "${topDecrease.value}" 从 ${topDecrease.baseline_count} 减少到 ${topDecrease.anomaly_count}（下降 ${(Math.abs(topDecrease.change_ratio) * 100).toFixed(1)}%）`;
        }
        
        hypothesis += '。这可能是导致异常的重要因素。';
        
        return hypothesis;
    }

    /**
     * 生成建议查询
     */
    private generateSuggestedQueries(
        baseQuery: string,
        suggestions: Array<{field: string, top_changes: Array<{value: string, change_ratio: number}>}>
    ): string[] {
        const queries: string[] = [];
        
        // 生成针对主要变化值的查询
        suggestions.forEach(suggestion => {
            const increases = suggestion.top_changes.filter(d => d.change_ratio > 0.5);
            const decreases = suggestion.top_changes.filter(d => d.change_ratio < -0.5);
            
            if (increases.length > 0) {
                const topIncrease = increases[0];
                queries.push(`${baseQuery} AND ${suggestion.field}:"${topIncrease.value}"`);
            }
            
            if (decreases.length > 0) {
                const topDecrease = decreases[0];
                queries.push(`${baseQuery} AND NOT ${suggestion.field}:"${topDecrease.value}"`);
            }
        });
        
        return queries.slice(0, 5);
    }

    /**
     * 生成根因总结
     */
    private generateRootCauseSummary(
        suggestions: Array<{field: string, hypothesis: string}>,
        originalQuery: string
    ): string {
        if (suggestions.length === 0) {
            return '未找到明显的根因线索。建议扩大分析时间窗口或增加候选字段。';
        }
        
        let summary = `基于查询 "${originalQuery}" 的根因分析发现：\n\n`;
        
        suggestions.forEach((suggestion, index) => {
            summary += `${index + 1}. ${suggestion.hypothesis}\n`;
        });
        
        summary += `\n建议优先关注上述 ${suggestions.length} 个字段的变化，它们可能是导致异常的主要原因。`;
        
        return summary;
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
import { TrendForecastModule } from './trend-forecast.js';
