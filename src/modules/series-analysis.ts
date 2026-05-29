export interface TimelineRow {
    start_ts: number;
    end_ts: number;
    count: number;
}

export interface TimelineData {
    rows?: TimelineRow[];
    start_ts?: number;
    end_ts?: number;
    interval?: number;
}

export interface StatisticalAnomaly {
    index: number;
    value: number;
    z_score: number;
    type: 'spike' | 'drop';
}

export interface TemporalAnomaly {
    type: 'irregular_interval';
    index: number;
    interval: number;
    expected_interval: number;
}

export interface PeakActivity {
    max_count: number;
    peak_index: number;
    peak_ratio: number;
}

export interface QuietPeriod {
    start_index: number;
    end_index: number;
    duration: number;
}

export interface SeriesAnalysisResult {
    has_timeline: boolean;
    total_time_buckets: number;
    active_buckets: number;
    activity_ratio: number;
    temporal_distribution: 'unknown' | 'continuous' | 'frequent' | 'intermittent' | 'sparse';
    burstiness: number;
    periodicity_score: number;
    temporal_clustering: number;
    peak_activity: PeakActivity | null;
    quiet_periods: QuietPeriod[];
    time_range?: {
        start?: number;
        end?: number;
        duration?: number;
        interval?: number;
    };
    has_anomalies: boolean;
    statistical_anomalies: StatisticalAnomaly[];
    temporal_anomalies: TemporalAnomaly[];
    anomaly_score: number;
}

export function analyzeTemporalDistribution(counts: number[]): SeriesAnalysisResult['temporal_distribution'] {
    if (counts.length === 0) return 'unknown';
    const activeCount = counts.filter((count) => count > 0).length;
    const ratio = activeCount / counts.length;

    if (ratio > 0.8) return 'continuous';
    if (ratio > 0.5) return 'frequent';
    if (ratio > 0.2) return 'intermittent';
    return 'sparse';
}

export function calculateBurstiness(counts: number[]): number {
    if (counts.length < 2) return 0;

    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    if (mean === 0) return 0;

    const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
    return Math.sqrt(variance) / mean;
}

export function detectPeriodicity(counts: number[]): number {
    if (counts.length < 4) return 0;

    let maxPeriodicity = 0;
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
            maxPeriodicity = Math.max(maxPeriodicity, matches / comparisons);
        }
    }

    return maxPeriodicity;
}

export function calculateTemporalClustering(counts: number[]): number {
    if (counts.length < 3) return 0;

    let clusteringScore = 0;
    let windows = 0;
    for (let i = 1; i < counts.length - 1; i++) {
        const localActivity = counts[i - 1] + counts[i] + counts[i + 1];
        if (localActivity > 0) {
            clusteringScore += localActivity;
            windows++;
        }
    }

    return windows > 0 ? clusteringScore / windows : 0;
}

export function findPeakActivity(counts: number[]): PeakActivity | null {
    if (counts.length === 0) return null;

    const maxCount = Math.max(...counts);
    const peakIndex = counts.indexOf(maxCount);

    return {
        max_count: maxCount,
        peak_index: peakIndex,
        peak_ratio: maxCount > 0 ? maxCount / Math.max(...counts) : 0
    };
}

export function identifyQuietPeriods(counts: number[]): QuietPeriod[] {
    const quietPeriods: QuietPeriod[] = [];
    let currentStart: number | null = null;

    for (let i = 0; i < counts.length; i++) {
        if (counts[i] === 0) {
            if (currentStart === null) {
                currentStart = i;
            }
            continue;
        }

        if (currentStart !== null) {
            quietPeriods.push({
                start_index: currentStart,
                end_index: i - 1,
                duration: i - currentStart
            });
            currentStart = null;
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

export function detectStatisticalAnomalies(counts: number[], threshold: number = 2): StatisticalAnomaly[] {
    if (counts.length < 3) return [];

    const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const variance = counts.reduce((sum, count) => sum + Math.pow(count - mean, 2), 0) / counts.length;
    const stdDev = Math.sqrt(variance);

    const anomalies: StatisticalAnomaly[] = [];
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

export function detectTemporalAnomalies(timeline: TimelineData): TemporalAnomaly[] {
    if (!Array.isArray(timeline.rows) || timeline.rows.length < 3) return [];

    const intervals: number[] = [];
    for (let i = 1; i < timeline.rows.length; i++) {
        intervals.push(timeline.rows[i].start_ts - timeline.rows[i - 1].start_ts);
    }

    const meanInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const threshold = meanInterval * 2;
    const anomalies: TemporalAnomaly[] = [];

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

export function analyzeTimeline(timeline?: TimelineData): SeriesAnalysisResult {
    if (!timeline?.rows || !Array.isArray(timeline.rows)) {
        return {
            has_timeline: false,
            total_time_buckets: 0,
            active_buckets: 0,
            activity_ratio: 0,
            temporal_distribution: 'unknown',
            burstiness: 0,
            periodicity_score: 0,
            temporal_clustering: 0,
            peak_activity: null,
            quiet_periods: [],
            has_anomalies: false,
            statistical_anomalies: [],
            temporal_anomalies: [],
            anomaly_score: 0
        };
    }

    const counts = timeline.rows.map((row) => row.count || 0);
    const activeBuckets = counts.filter((count) => count > 0).length;
    const statisticalAnomalies = detectStatisticalAnomalies(counts);
    const temporalAnomalies = detectTemporalAnomalies(timeline);

    return {
        has_timeline: true,
        total_time_buckets: counts.length,
        active_buckets: activeBuckets,
        activity_ratio: counts.length > 0 ? activeBuckets / counts.length : 0,
        temporal_distribution: analyzeTemporalDistribution(counts),
        burstiness: calculateBurstiness(counts),
        periodicity_score: detectPeriodicity(counts),
        temporal_clustering: calculateTemporalClustering(counts),
        peak_activity: findPeakActivity(counts),
        quiet_periods: identifyQuietPeriods(counts),
        time_range: {
            start: timeline.start_ts,
            end: timeline.end_ts,
            duration: typeof timeline.start_ts === 'number' && typeof timeline.end_ts === 'number'
                ? timeline.end_ts - timeline.start_ts
                : undefined,
            interval: timeline.interval
        },
        has_anomalies: statisticalAnomalies.length > 0 || temporalAnomalies.length > 0,
        statistical_anomalies: statisticalAnomalies,
        temporal_anomalies: temporalAnomalies,
        anomaly_score: Math.max(statisticalAnomalies.length, temporalAnomalies.length)
    };
}
