import axios, { AxiosInstance, AxiosResponse } from 'axios';
import https from 'https';
import { HttpClientConfig, ApiResponse } from './types.js';

export class LogEaseClient {
    private client: AxiosInstance;

    constructor(config: HttpClientConfig) {
        this.client = axios.create({
            baseURL: config.baseURL,
            headers: config.headers,
            httpsAgent: config.httpsAgent || new https.Agent({ rejectUnauthorized: false })
        });
    }

    private hasHeader(headers: Record<string, any> | undefined, name: string): boolean {
        if (!headers) {
            return false;
        }
        const target = name.toLowerCase();
        return Object.keys(headers).some((key) => key.toLowerCase() === target);
    }

    private withDefaultHeaders(
        options: any,
        defaults: Record<string, string>
    ): any {
        const nextOptions = options ? { ...options } : {};
        const nextHeaders = { ...(nextOptions.headers || {}) };

        for (const [name, value] of Object.entries(defaults)) {
            if (!this.hasHeader(nextHeaders, name)) {
                nextHeaders[name] = value;
            }
        }

        nextOptions.headers = nextHeaders;
        return nextOptions;
    }

    private buildTransportError<T>(error: any): ApiResponse<T> {
        const baseMessage = error?.message || '未知网络错误';
        const errorCode = error?.code || '';

        if (baseMessage.includes('socket hang up') || errorCode === 'ECONNRESET') {
            return {
                status: error.response?.status || 502,
                error: baseMessage,
                error_code: 'UPSTREAM_CONNECTION_RESET',
                suggestion: '与上游服务的连接被直接断开。请优先检查 LOGEASE_BASE_URL 的协议、地址和端口是否正确，并确认目标服务是否真的在该地址提供 HTTP API。',
                retryable: true,
                details: error.response?.data,
                message: `请求失败: ${baseMessage}`
            };
        }

        if (errorCode === 'ECONNREFUSED') {
            return {
                status: 502,
                error: baseMessage,
                error_code: 'UPSTREAM_CONNECTION_REFUSED',
                suggestion: '目标地址拒绝连接。请确认日志易服务是否已启动，以及端口是否正确开放。',
                retryable: true,
                details: error.response?.data,
                message: `请求失败: ${baseMessage}`
            };
        }

        if (errorCode === 'ETIMEDOUT' || baseMessage.includes('timeout')) {
            return {
                status: 504,
                error: baseMessage,
                error_code: 'UPSTREAM_TIMEOUT',
                suggestion: '请求上游超时。请先缩小 time_range 或 limit；如果最小请求也超时，请检查网络或服务负载。',
                retryable: true,
                details: error.response?.data,
                message: `请求失败: ${baseMessage}`
            };
        }

        return {
            status: error.response?.status || 500,
            error: baseMessage,
            error_code: 'UPSTREAM_REQUEST_FAILED',
            suggestion: '请检查上游服务地址、认证信息和请求参数；如问题持续，请先用最小请求验证连通性。',
            retryable: true,
            details: error.response?.data,
            message: `请求失败: ${baseMessage}`
        };
    }

    /**
     * 执行GET请求
     */
    async get<T>(path: string, params?: Record<string, any>, options?: any): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.get(
                path,
                {
                    params,
                    ...this.withDefaultHeaders(options, { Accept: 'application/json' })
                }
            );
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return this.buildTransportError<T>(error);
        }
    }

    /**
     * 执行POST请求
     */
    async post<T>(path: string, data?: any, params?: Record<string, any>, options?: any): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.post(
                path,
                data,
                {
                    params,
                    ...this.withDefaultHeaders(options, {
                        Accept: 'application/json',
                        'Content-Type': 'application/json;charset=UTF-8'
                    })
                }
            );
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return this.buildTransportError<T>(error);
        }
    }

    /**
     * 执行PUT请求
     */
    async put<T>(path: string, data?: any, params?: Record<string, any>, options?: any): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.put(
                path,
                data,
                {
                    params,
                    ...this.withDefaultHeaders(options, {
                        Accept: 'application/json',
                        'Content-Type': 'application/json;charset=UTF-8'
                    })
                }
            );
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return this.buildTransportError<T>(error);
        }
    }

    /**
     * 执行DELETE请求
     */
    async delete<T>(path: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.delete(
                path,
                { params, ...this.withDefaultHeaders(undefined, { Accept: 'application/json' }) }
            );
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return this.buildTransportError<T>(error);
        }
    }

    /**
     * 轮询请求直到完成或超时
     */
    async pollUntilComplete<T>(
        path: string,
        checkComplete: (response: ApiResponse<T>) => boolean,
        maxRetries: number = 10,
        retryInterval: number = 5000,
        params?: Record<string, any>,
        options?: any
    ): Promise<ApiResponse<T>> {
        let retries = 0;
        
        while (retries < maxRetries) {
            const result = await this.get<T>(path, params, options);
            
            if (checkComplete(result)) {
                return result;
            }
            
            if (result.error) {
                return result;
            }
            
            await new Promise(resolve => setTimeout(resolve, retryInterval));
            retries++;
        }
        
        return {
            error: '轮询超时',
            message: `超过最大重试次数 (${maxRetries})`
        };
    }
}
