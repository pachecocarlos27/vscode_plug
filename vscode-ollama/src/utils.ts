/**
 * Utility functions for the Ollama VS Code extension
 */
import * as vscode from 'vscode';
import * as os from 'os';
import axios from 'axios';
import type { AxiosError } from 'axios';

/**
 * Central error handling utility
 */
export class ErrorUtility {
    /**
     * Format an error into a user-friendly message
     */
    static formatError(error: unknown, context = ''): string {
        const prefix = context ? `${context}: ` : '';
        
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            
            if (axiosError.code === 'ECONNABORTED') {
                return `${prefix}Request timed out. The server might be busy or overloaded.`;
            } else if (axiosError.code === 'ECONNREFUSED') {
                return `${prefix}Connection refused. Make sure the Ollama server is running.`;
            } else if (axiosError.code === 'ERR_CANCELED') {
                return `${prefix}Request was canceled.`;
            } else if (axiosError.response) {
                return `${prefix}Server error (Status: ${axiosError.response.status})`;
            } else if (axiosError.request) {
                return `${prefix}No response from server. Check your network connection.`;
            } else {
                return `${prefix}Network error: ${axiosError.message}`;
            }
        } else if (error instanceof Error) {
            return `${prefix}${error.message}`;
        } else {
            return `${prefix}${String(error)}`;
        }
    }
    
    /**
     * Show error to user with properly formatted message and optional retry action
     */
    static async showError(error: unknown, context: string, 
                          actionLabel: string | null = null, 
                          actionCallback: (() => Promise<unknown>) | null = null): Promise<void> {
        const message = this.formatError(error, context);
        
        if (actionLabel && actionCallback) {
            const selected = await vscode.window.showErrorMessage(message, actionLabel);
            if (selected === actionLabel) {
                await actionCallback();
            }
        } else {
            vscode.window.showErrorMessage(message);
        }
    }
    
    /**
     * Log error to output channel and optionally show to user
     */
    static logError(error: unknown, outputChannel: vscode.OutputChannel, 
                   context: string, showToUser = false): void {
        const message = this.formatError(error, context);
        const errorDetail = error instanceof Error ? 
            `${error.message}\n${error.stack || 'No stack trace'}` : 
            String(error);
            
        outputChannel.appendLine(`[ERROR] ${context}: ${errorDetail}`);
        
        if (showToUser) {
            vscode.window.showErrorMessage(message);
        }
    }
}

/**
 * Logger utility for standardized logging across the extension
 */
export class Logger {
    private static channels: Map<string, vscode.OutputChannel> = new Map();
    
    /**
     * Get or create an output channel by name
     */
    static getChannel(name: string): vscode.OutputChannel {
        if (!this.channels.has(name)) {
            const channel = vscode.window.createOutputChannel(name);
            this.channels.set(name, channel);
        }
        return this.channels.get(name)!;
    }
    
    /**
     * Log a message to a specific channel
     */
    static log(channelName: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const prefix = level === 'info' ? '[INFO]' : 
                     level === 'warn' ? '[WARN]' : 
                     '[ERROR]';
                     
        const channel = this.getChannel(channelName);
        channel.appendLine(`${prefix} ${new Date().toISOString()} - ${message}`);
    }
    
    /**
     * Log an object as JSON
     */
    static logObject(channelName: string, label: string, obj: unknown): void {
        const channel = this.getChannel(channelName);
        channel.appendLine(`[INFO] ${label}: ${JSON.stringify(obj, null, 2)}`);
    }
    
    /**
     * Log system information
     */
    static logSystemInfo(channelName: string): void {
        const channel = this.getChannel(channelName);
        
        const platformInfo = {
            platform: os.platform(),
            release: os.release(),
            arch: os.arch(),
            cpus: os.cpus().length,
            memory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
        };
        
        channel.appendLine('System Information:');
        Object.entries(platformInfo).forEach(([key, value]) => {
            channel.appendLine(`  ${key}: ${value}`);
        });
        
        // Log configuration
        const ollamaConfig = vscode.workspace.getConfiguration('ollama');
        channel.appendLine('Ollama Configuration:');
        const configKeys = [
            'apiUrl', 'defaultModel', 'includeProjectContext', 'showFileExplorer', 
            'filePatterns', 'excludePatterns', 'maxResponseTokens', 'autoStartServer',
            'saveConversationHistory', 'codeActionsEnabled', 'statusBarPolling', 'forceRecheck'
        ];
        
        for (const key of configKeys) {
            const value = ollamaConfig.get(key);
            channel.appendLine(`  ${key}: ${JSON.stringify(value)}`);
        }
    }
    
    /**
     * Dispose all channels
     */
    static dispose(): void {
        this.channels.forEach(channel => channel.dispose());
        this.channels.clear();
    }
}

/**
 * Configuration helper for accessing extension settings
 */
export class ConfigHelper {
    /**
     * Get a configuration value with type safety and default handling
     */
    static get<T>(key: string, defaultValue: T): T {
        return vscode.workspace.getConfiguration('ollama').get<T>(key, defaultValue);
    }
    
    /**
     * Get the API URL for Ollama
     */
    static getApiUrl(): string {
        return this.get<string>('apiUrl', 'http://localhost:11434');
    }
    
    /**
     * Get the default model if configured, or null
     */
    static getDefaultModel(): string | null {
        const model = this.get<string>('defaultModel', '');
        return model ? model : null;
    }
    
    /**
     * Get timeout settings with appropriate defaults
     */
    static getTimeoutSeconds(): number {
        return this.get<number>('requestTimeout', 90);
    }
    
    /**
     * Get temperature setting with appropriate default
     */
    static getTemperature(): number {
        return this.get<number>('temperature', 0.7);
    }
    
    /**
     * Check if auto-start server is enabled
     */
    static isAutoStartEnabled(): boolean {
        return this.get<boolean>('autoStartServer', true);
    }
}

/**
 * HTTP request utilities
 */
export class HttpClient {
    /**
     * Make a GET request with standardized error handling and logging
     */
    static async get<T>(url: string, options: {
        timeout?: number,
        headers?: Record<string, string>,
        validateStatus?: (status: number) => boolean,
        outputChannel?: vscode.OutputChannel
    } = {}): Promise<T> {
        try {
            const response = await axios.get(url, {
                timeout: options.timeout || 5000,
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache',
                    ...(options.headers || {})
                },
                validateStatus: options.validateStatus || (status => status === 200),
                proxy: false
            });
            
            if (options.outputChannel) {
                options.outputChannel.appendLine(`GET ${url} - Status: ${response.status}`);
            }
            
            return response.data;
        } catch (error) {
            if (options.outputChannel) {
                options.outputChannel.appendLine(`ERROR: GET ${url} - ${ErrorUtility.formatError(error)}`);
            }
            throw error;
        }
    }
    
    /**
     * Make a POST request with standardized error handling and logging
     */
    static async post<T>(url: string, data: any, options: {
        timeout?: number,
        headers?: Record<string, string>,
        validateStatus?: (status: number) => boolean,
        outputChannel?: vscode.OutputChannel,
        signal?: AbortSignal
    } = {}): Promise<T> {
        try {
            const response = await axios.post(url, data, {
                timeout: options.timeout || 30000,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...(options.headers || {})
                },
                validateStatus: options.validateStatus || (status => status === 200),
                signal: options.signal,
                proxy: false
            });
            
            if (options.outputChannel) {
                options.outputChannel.appendLine(`POST ${url} - Status: ${response.status}`);
            }
            
            return response.data;
        } catch (error) {
            if (options.outputChannel) {
                options.outputChannel.appendLine(`ERROR: POST ${url} - ${ErrorUtility.formatError(error)}`);
            }
            throw error;
        }
    }
}

/**
 * Helper for tracking requests with timeout and abort support
 */
export class RequestTracker {
    private static requests: Map<string, AbortController> = new Map();
    
    /**
     * Create a new tracked request that can be aborted later
     */
    static createRequest(id: string): AbortController {
        // Abort any existing request with this ID
        this.abortRequest(id);
        
        const controller = new AbortController();
        this.requests.set(id, controller);
        return controller;
    }
    
    /**
     * Abort a specific request by ID
     */
    static abortRequest(id: string): boolean {
        if (this.requests.has(id)) {
            const controller = this.requests.get(id)!;
            controller.abort();
            this.requests.delete(id);
            return true;
        }
        return false;
    }
    
    /**
     * Abort all tracked requests
     */
    static abortAll(): void {
        this.requests.forEach(controller => controller.abort());
        this.requests.clear();
    }
}