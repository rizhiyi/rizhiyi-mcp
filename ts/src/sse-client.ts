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
        let buffer = '';
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
                buffer += chunk;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                let currentEvent = '';
                let currentDataLines: string[] = [];

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        if (currentEvent && currentDataLines.length > 0) {
                            processEvent({ event: currentEvent, data: currentDataLines.join('\n') });
                        }
                        currentEvent = line.slice(7).trim();
                        currentDataLines = [];
                    } else if (line.startsWith('data: ')) {
                        currentDataLines.push(line.slice(6));
                    } else if (line.trim() === '' && currentEvent) {
                        if (currentDataLines.length > 0) {
                            processEvent({ event: currentEvent, data: currentDataLines.join('\n') });
                        }
                        currentEvent = '';
                        currentDataLines = [];
                    }
                }

                if (currentEvent && currentDataLines.length > 0) {
                    processEvent({ event: currentEvent, data: currentDataLines.join('\n') });
                    currentEvent = '';
                    currentDataLines = [];
                }
            });

            res.on('end', () => finish());
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
