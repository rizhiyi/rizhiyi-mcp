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

    /**
     * 执行GET请求
     */
    async get<T>(path: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.get(path, { params });
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return {
                status: error.response?.status || 500,
                error: error.message,
                details: error.response?.data,
                message: `请求失败: ${error.message}`
            };
        }
    }

    /**
     * 执行POST请求
     */
    async post<T>(path: string, data?: any, params?: Record<string, any>): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.post(path, data, { params });
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return {
                status: error.response?.status || 500,
                error: error.message,
                details: error.response?.data,
                message: `请求失败: ${error.message}`
            };
        }
    }

    /**
     * 执行PUT请求
     */
    async put<T>(path: string, data?: any, params?: Record<string, any>): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.put(path, data, { params });
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return {
                status: error.response?.status || 500,
                error: error.message,
                details: error.response?.data,
                message: `请求失败: ${error.message}`
            };
        }
    }

    /**
     * 执行DELETE请求
     */
    async delete<T>(path: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
        try {
            const response: AxiosResponse<T> = await this.client.delete(path, { params });
            return {
                status: response.status,
                data: response.data,
                message: '请求成功'
            };
        } catch (error: any) {
            return {
                status: error.response?.status || 500,
                error: error.message,
                details: error.response?.data,
                message: `请求失败: ${error.message}`
            };
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
        params?: Record<string, any>
    ): Promise<ApiResponse<T>> {
        let retries = 0;
        
        while (retries < maxRetries) {
            const result = await this.get<T>(path, params);
            
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