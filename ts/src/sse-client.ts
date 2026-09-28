import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface SseEvent {
    event: string;
    data: string;
}

export interface SseChatResult {
    conversation_id?: number;
    conversation?: Record<string, any>;
    spl?: string;
    steps: Array<{ id: string; title: string; status: string; tool_name?: string }>;
    raw_events: SseEvent[];
}

interface SseClientOptions {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    onEvent?: (event: SseEvent) => void;
}

/**
 * SSE 增量解析器。
 *
 * 解析状态（行缓冲 / 当前事件名 / 当前 data 行）必须**跨网络分片保持**：
 *   - 网络分片边界与 SSE 事件边界毫无关系，一行可能被切开，一个事件也可能
 *     横跨多个分片；
 *   - 事件只能由**空行**界定，绝不能因为"分片结束"就 flush。
 *
 * 因此这里把解析状态做成实例字段，`push()` 只消费完整的行，
 * 事件仅在空行或 `flush()`（流结束）时产出。
 */
export class SseParser {
    private lineBuffer = '';
    private currentEvent = '';
    private currentDataLines: string[] = [];

    /** 喂入一段已解码文本，返回其中被完整界定的事件。 */
    push(chunk: string): SseEvent[] {
        this.lineBuffer += chunk;
        const events: SseEvent[] = [];

        let newlineIndex = this.lineBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
            let line = this.lineBuffer.slice(0, newlineIndex);
            this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }
            this.consumeLine(line, events);
            newlineIndex = this.lineBuffer.indexOf('\n');
        }

        return events;
    }

    /**
     * 流结束（EOF）时调用：处理没有尾随换行的最后一行，并补一次事件 flush。
     * 事件没有以空行收尾是合法的，不能在结束时静默丢弃。
     */
    flush(): SseEvent[] {
        const events: SseEvent[] = [];

        if (this.lineBuffer.length > 0) {
            let line = this.lineBuffer;
            this.lineBuffer = '';
            if (line.endsWith('\r')) {
                line = line.slice(0, -1);
            }
            this.consumeLine(line, events);
        }

        if (this.currentEvent && this.currentDataLines.length > 0) {
            events.push({ event: this.currentEvent, data: this.currentDataLines.join('\n') });
        }
        this.currentEvent = '';
        this.currentDataLines = [];

        return events;
    }

    private consumeLine(line: string, events: SseEvent[]): void {
        if (line.startsWith('event: ')) {
            if (this.currentEvent && this.currentDataLines.length > 0) {
                events.push({ event: this.currentEvent, data: this.currentDataLines.join('\n') });
            }
            this.currentEvent = line.slice(7).trim();
            this.currentDataLines = [];
            return;
        }

        if (line.startsWith('data: ')) {
            this.currentDataLines.push(line.slice(6));
            return;
        }

        if (line.trim() === '') {
            // 空行无条件结束当前事件：无论是否已有事件名，都必须重置状态。
            // 否则「只有 data: 没有 event:」的孤儿 data 行会残留在 currentDataLines
            // 里，并泄漏/污染后续解析（Python 侧 _parse_sse_block 会干净丢弃）。
            if (this.currentEvent && this.currentDataLines.length > 0) {
                events.push({ event: this.currentEvent, data: this.currentDataLines.join('\n') });
            }
            this.currentEvent = '';
            this.currentDataLines = [];
        }

        // 注释行（以 ':' 开头）与未知字段按原实现忽略。
    }
}

export function requestSse(options: SseClientOptions): Promise<SseChatResult> {
    return new Promise((resolve, reject) => {
        const url = new URL(options.url);
        const isHttps = url.protocol === 'https:';
        const transport = isHttps ? https : http;

        const reqHeaders: Record<string, string> = {
            ...options.headers,
            Accept: 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        };

        const reqOptions: https.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'POST',
            headers: reqHeaders,
            rejectUnauthorized: false
        } as https.RequestOptions;

        const result: SseChatResult = { steps: [], raw_events: [] };
        const parser = new SseParser();
        let finished = false;

        const finish = (err?: Error) => {
            if (finished) return;
            finished = true;
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        };

        const req = transport.request(reqOptions, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                let body = '';
                res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                res.on('end', () => finish(new Error(`SSE request failed (${res.statusCode}): ${body.slice(0, 500)}`)));
                return;
            }

            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
                for (const evt of parser.push(chunk)) {
                    processEvent(evt);
                }
            });

            res.on('end', () => {
                for (const evt of parser.flush()) {
                    processEvent(evt);
                }
                finish();
            });
            res.on('error', (err) => finish(err));
        });

        req.on('error', (err) => finish(err));

        if (options.timeoutMs) {
            req.setTimeout(options.timeoutMs, () => {
                req.destroy(new Error('SSE request timeout'));
            });
        }

        if (options.body) {
            req.write(options.body);
        }
        req.end();

        function processEvent(evt: SseEvent) {
            result.raw_events.push(evt);
            if (options.onEvent) {
                options.onEvent(evt);
            }

            if (evt.event === 'DONE') {
                try {
                    const parsed = JSON.parse(evt.data);
                    if (parsed.conversation_id) {
                        result.conversation_id = parsed.conversation_id;
                    }
                } catch { /* ignore */ }
                finish();
                return;
            }

            if (evt.event === 'META') {
                try {
                    const parsed = JSON.parse(evt.data);
                    if (parsed.conversation) {
                        result.conversation = parsed.conversation;
                    }
                } catch { /* ignore */ }
                return;
            }

            if (evt.event === 'CREATE_STEP' || evt.event === 'SET_STATUS') {
                try {
                    const parsed = JSON.parse(evt.data);
                    if (evt.event === 'CREATE_STEP') {
                        result.steps.push({
                            id: parsed.id,
                            title: parsed.title,
                            status: 'CREATED',
                            tool_name: parsed.details?.tool_name
                        });
                    } else if (evt.event === 'SET_STATUS') {
                        const step = result.steps.find((s) => s.id === parsed.id);
                        if (step) {
                            step.status = parsed.status;
                            if (parsed.title) step.title = parsed.title;
                        }
                    }
                } catch { /* ignore */ }
                return;
            }

            if (evt.event === 'STEP_OUTPUT') {
                try {
                    const parsed = JSON.parse(evt.data);
                    const step = result.steps.find((s) => s.id === parsed.id);
                    if (step && step.tool_name === 'send_spl' && parsed.content) {
                        result.spl = extractSplFromMarkdown(parsed.content);
                    }
                } catch { /* ignore */ }
            }
        }
    });
}

function extractSplFromMarkdown(content: string): string {
    const match = content.match(/```spl\s*\n([\s\S]*?)\n```/);
    if (match) {
        return match[1].trim();
    }
    return content.replace(/```[\s\S]*?```/g, '').trim();
}
