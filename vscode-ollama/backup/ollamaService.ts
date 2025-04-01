import axios from 'axios';
import type { AxiosError } from 'axios';
import * as vscode from 'vscode';
import * as os from 'os';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface OllamaModel {
    name: string;
    modified_at: string;
    size: number;
}

export class OllamaService {
    private baseUrl: string;
    private isInstalled: boolean | null = null;
    private serviceChannel: vscode.OutputChannel;
    private apiChannel: vscode.OutputChannel;
    
    // Cache for API responses
    private modelListCache: { models: OllamaModel[], timestamp: number } | null = null;
    private serverHealthCache: { isHealthy: boolean, timestamp: number, modelName?: string } | null = null;
    private readonly CACHE_TTL = 30 * 1000; // 30 seconds cache lifetime

    constructor(serviceChannel: vscode.OutputChannel, apiChannel: vscode.OutputChannel) {
        console.log('Initializing OllamaService...');
        
        // Use the provided output channels
        this.serviceChannel = serviceChannel;
        this.apiChannel = apiChannel;
        
        try {
            // Default to localhost:11434 but allow configuration
            this.baseUrl = vscode.workspace.getConfiguration('ollama').get('apiUrl') as string || 'http://localhost:11434';
            console.log(`Using Ollama API URL: ${this.baseUrl}`);
            
            // Make sure the output channels are visible
            this.serviceChannel.appendLine(`Ollama Service initialized with API URL: ${this.baseUrl}`);
            this.serviceChannel.show(false); // Show in dropdown but don't focus
            
            this.apiChannel.appendLine(`API Channel initialized - API URL: ${this.baseUrl}`);
            this.apiChannel.show(false); // Show in dropdown but don't focus
            
            // Log system info
            this.logSystemInfo();
        } catch (error) {
            console.error('Error initializing OllamaService:', error);
            // Log to both channels
            this.serviceChannel.appendLine(`Error in OllamaService constructor: ${error instanceof Error ? error.message : String(error)}`);
            this.apiChannel.appendLine(`Error in OllamaService constructor: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    private logSystemInfo() {
        try {
            const platformInfo = {
                platform: os.platform(),
                release: os.release(),
                arch: os.arch(),
                cpus: os.cpus().length,
                memory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
                apiUrl: this.baseUrl
            };
            
            this.serviceChannel.appendLine('System Information:');
            Object.entries(platformInfo).forEach(([key, value]) => {
                this.serviceChannel.appendLine(`  ${key}: ${value}`);
            });
            
            // Log all Ollama configuration
            const ollamaConfig = vscode.workspace.getConfiguration('ollama');
            this.serviceChannel.appendLine('Ollama Configuration:');
            const configKeys = [
                'apiUrl', 'defaultModel', 'includeProjectContext', 'showFileExplorer', 
                'filePatterns', 'excludePatterns', 'maxResponseTokens', 'autoStartServer',
                'saveConversationHistory', 'codeActionsEnabled', 'statusBarPolling', 'forceRecheck'
            ];
            
            for (const key of configKeys) {
                const value = ollamaConfig.get(key);
                this.serviceChannel.appendLine(`  ${key}: ${JSON.stringify(value)}`);
            }
            
            // Make sure the channel is visible
            this.serviceChannel.show(false);
        } catch (error) {
            this.serviceChannel.appendLine(`Error logging system info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private getInstallInstructions(): {title: string, url: string} {
        const platform = os.platform();
        
        if (platform === 'darwin') {
            return {
                title: 'Download Ollama for macOS',
                url: 'https://ollama.com/download/mac'
            };
        } else if (platform === 'win32') {
            return {
                title: 'Download Ollama for Windows',
                url: 'https://ollama.com/download/windows'
            };
        } else {
            // Linux
            return {
                title: 'Install Ollama for Linux',
                url: 'https://ollama.com/download/linux'
            };
        }
    }

    async checkOllamaInstalled(): Promise<boolean> {
        // Force recheck if requested
        if (this.isInstalled !== null && !vscode.workspace.getConfiguration('ollama').get('forceRecheck', false)) {
            return this.isInstalled;
        }

        try {
            // Log attempt to connect to Ollama API
            console.log(`Attempting to connect to Ollama API at ${this.baseUrl}/api/tags`);
            
            // Add detailed debugging info
            if (this.apiChannel) {
                this.apiChannel.appendLine(`\n============ CONNECTION ATTEMPT DETAILS ============`);
                this.apiChannel.appendLine(`Time: ${new Date().toISOString()}`);
                this.apiChannel.appendLine(`URL: ${this.baseUrl}/api/tags`);
                this.apiChannel.appendLine(`Timeout: 5000ms`);
                this.apiChannel.appendLine(`OS: ${os.platform()} ${os.release()}`);
                this.apiChannel.appendLine(`Network: Connecting to ${this.baseUrl.replace('http://', '').replace('https://', '')}`);
                this.apiChannel.appendLine(`================================================`);
                
                // Make sure the channel is visible without stealing focus
                this.apiChannel.show(true);
                this.serviceChannel.show(false);
            }
            
            // Make a basic request to the Ollama API to see if it's running
            console.log('Sending API test request...');
            const response = await axios.get(`${this.baseUrl}/api/tags`, { 
                timeout: 5000, // Increased timeout to allow for network delays
                validateStatus: null, // Accept any status code for more detailed error handling
                headers: { 
                    'Cache-Control': 'no-cache', // Prevent caching
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                // Add proxy configuration to help with some network setups
                proxy: false
            });
            
            console.log(`Received response with status: ${response.status}`);
            if (this.apiChannel) {
                this.apiChannel.appendLine(`Response status: ${response.status}`);
                this.apiChannel.appendLine(`Response data: ${JSON.stringify(response.data).substring(0, 200)}...`);
            }
            
            if (response.status === 200) {
                console.log('Ollama API connection successful');
                this.isInstalled = true;
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`✅ Ollama API connection successful - server is running`);
                }
                return true;
            } else {
                console.log(`Ollama API returned status: ${response.status}`);
                // If we got a response but not 200, Ollama is likely running but with issues
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`⚠️ Ollama API returned status code ${response.status}`);
                    this.apiChannel.appendLine(`Response body: ${JSON.stringify(response.data)}`);
                }
                throw new Error(`Ollama API returned status code ${response.status}`);
            }
        } catch (error) {
            console.log('Ollama API connection failed:', error);
            
            // Enhanced error reporting in API channel for debugging
            if (this.apiChannel) {
                this.apiChannel.appendLine(`\n❌ CONNECTION ERROR DETAILS ❌`);
                this.apiChannel.appendLine(`Time: ${new Date().toISOString()}`);
                
                if (axios.isAxiosError(error)) {
                    const axiosError = error;
                    this.apiChannel.appendLine(`Error type: Axios Error`);
                    this.apiChannel.appendLine(`Error code: ${axiosError.code || 'none'}`);
                    this.apiChannel.appendLine(`Error message: ${axiosError.message}`);
                    
                    if (axiosError.response) {
                        this.apiChannel.appendLine(`Response status: ${axiosError.response.status}`);
                        this.apiChannel.appendLine(`Response statusText: ${axiosError.response.statusText}`);
                        const responseData = typeof axiosError.response.data === 'object' 
                            ? JSON.stringify(axiosError.response.data) 
                            : String(axiosError.response.data);
                        this.apiChannel.appendLine(`Response data: ${responseData.substring(0, 200)}`);
                    } else if (axiosError.request) {
                        this.apiChannel.appendLine(`Request was made but no response received`);
                        this.apiChannel.appendLine(`Target host: ${this.baseUrl}`);
                    } else {
                        this.apiChannel.appendLine(`Request setup error (before sending)`);
                    }
                    
                    // Network specific errors
                    if (axiosError.code === 'ECONNREFUSED') {
                        this.apiChannel.appendLine(`📌 DIAGNOSIS: Connection refused - Ollama server is likely not running`);
                    } else if (axiosError.code === 'ENOTFOUND') {
                        this.apiChannel.appendLine(`📌 DIAGNOSIS: Host not found - Check network config or hostname`);
                    } else if (axiosError.code === 'ETIMEDOUT') {
                        this.apiChannel.appendLine(`📌 DIAGNOSIS: Connection timed out - Server may be busy or unreachable`);
                    }
                } else {
                    this.apiChannel.appendLine(`Error type: ${error instanceof Error ? error.constructor.name : typeof error}`);
                    this.apiChannel.appendLine(`Error message: ${error instanceof Error ? error.message : String(error)}`);
                    if (error instanceof Error && error.stack) {
                        this.apiChannel.appendLine(`Stack trace: ${error.stack}`);
                    }
                }
                
                this.apiChannel.appendLine(`\nTrying to verify Ollama installation status...`);
                this.apiChannel.show(true);
            }
            
            // Check if it's a connection error (likely Ollama is not running)
            const isConnectionError = axios.isAxiosError(error) && 
                (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT');
            
            if (isConnectionError) {
                console.log('Connection error, checking if Ollama is installed but not running');
                
                // Try to check if the Ollama binary exists
                try {
                    const platform = os.platform();
                    console.log(`Checking for Ollama installation on ${platform}`);
                    
                    if (platform === 'win32') {
                        // Check Program Files for Ollama
                        const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                        console.log(`Looking for Ollama at: ${ollamaPath}`);
                        
                        const exists = fs.existsSync(ollamaPath);
                        console.log(`Ollama binary exists: ${exists}`);
                        this.isInstalled = exists;
                        
                        if (this.isInstalled && vscode.workspace.getConfiguration('ollama').get('autoStartServer', true)) {
                            // Ollama is installed but not running - attempt to start it
                            console.log('Attempting to start Ollama process on Windows');
                            const startResult = await this.startOllamaProcess();
                            console.log(`Ollama start result: ${startResult}`);
                            return startResult;
                        }
                    } else {
                        // For macOS and Linux, check if ollama is in the PATH
                        try {
                            console.log('Checking if ollama is in PATH');
                            if (this.apiChannel) {
                                this.apiChannel.appendLine('Checking if ollama binary is available in PATH...');
                            }
                            
                            // Run both common methods for getting version info for better diagnostics
                            try {
                                const versionOutput = child_process.execSync('ollama --version', { encoding: 'utf8' });
                                console.log('Ollama binary found in PATH:', versionOutput.trim());
                                if (this.apiChannel) {
                                    this.apiChannel.appendLine(`Ollama binary found: ${versionOutput.trim()}`);
                                }
                            } catch (versionError) {
                                console.log('Error checking version:', versionError);
                                // Try locating the binary directly
                                let locateOutput = '';
                                try {
                                    locateOutput = child_process.execSync('which ollama', { encoding: 'utf8' });
                                    console.log('Ollama binary location:', locateOutput.trim());
                                    if (this.apiChannel) {
                                        this.apiChannel.appendLine(`Ollama binary location: ${locateOutput.trim()}`);
                                    }
                                } catch (locateError) {
                                    console.log('Error locating binary:', locateError);
                                    if (this.apiChannel) {
                                        this.apiChannel.appendLine('Could not locate ollama binary with "which" command');
                                        // Try a few common locations
                                        this.apiChannel.appendLine('Checking common installation paths...');
                                        const commonPaths = [
                                            '/usr/local/bin/ollama',
                                            '/usr/bin/ollama',
                                            '/opt/ollama/ollama',
                                            `/home/${os.userInfo().username}/ollama/ollama`,
                                            `/home/${os.userInfo().username}/.ollama/ollama`
                                        ];
                                        for (const path of commonPaths) {
                                            this.apiChannel.appendLine(`Checking ${path}...`);
                                            if (fs.existsSync(path)) {
                                                this.apiChannel.appendLine(`✅ Found ollama binary at ${path}`);
                                                break;
                                            }
                                        }
                                    }
                                    throw locateError; // Rethrow to indicate binary not found
                                }
                            }
                            
                            // If we get here, the binary was found
                            this.isInstalled = true;
                            
                            if (vscode.workspace.getConfiguration('ollama').get('autoStartServer', true)) {
                                // Ollama is installed but not running - attempt to start it
                                console.log('Attempting to start Ollama process on Unix');
                                if (this.apiChannel) {
                                    this.apiChannel.appendLine('Attempting to start Ollama server process...');
                                }
                                const startResult = await this.startOllamaProcess();
                                console.log(`Ollama start result: ${startResult}`);
                                if (this.apiChannel) {
                                    this.apiChannel.appendLine(`Ollama server start ${startResult ? 'succeeded' : 'failed'}`);
                                }
                                return startResult;
                            }
                            return true; // Binary exists but we won't auto-start
                        } catch (e) {
                            console.log('Ollama binary not found in PATH');
                            if (this.apiChannel) {
                                this.apiChannel.appendLine('❌ Ollama binary not found in PATH');
                                this.apiChannel.appendLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
                            }
                            this.isInstalled = false;
                        }
                    }
                } catch (e) {
                    console.error('Error checking for Ollama binary:', e);
                    this.isInstalled = false;
                }
            } else {
                // Some other API error
                console.error('Unexpected error when checking Ollama status:', error);
                this.isInstalled = false;
            }
            
            // If auto-start disabled or binary not found, show installation instructions
            if (!this.isInstalled) {
                const instructions = this.getInstallInstructions();
                
                const action = await vscode.window.showErrorMessage(
                    'Ollama is not installed. Please install Ollama to use this extension.',
                    { modal: true },
                    instructions.title
                );
                
                if (action === instructions.title) {
                    vscode.env.openExternal(vscode.Uri.parse(instructions.url));
                }
            } else if (!vscode.workspace.getConfiguration('ollama').get('autoStartServer', true)) {
                // If it's installed but auto-start is disabled
                const action = await vscode.window.showErrorMessage(
                    'Ollama is installed but not running. Would you like to start it now?',
                    { modal: true },
                    'Start Ollama'
                );
                
                if (action === 'Start Ollama') {
                    const startResult = await this.startOllamaProcess();
                    return startResult;
                }
            }
            
            return false;
        }
    }

    /**
     * Check if the Ollama server is healthy and the specified model is available
     * More thorough than just checking if the server is running
     * @param modelName Optional model name to check
     * @param options Additional options for the health check
     * @returns Promise resolving to a boolean indicating if the server is healthy
     */
    private async checkServerHealth(
        modelName?: string, 
        options: { retry?: boolean, retryCount?: number, retryDelay?: number, bypassCache?: boolean } = {}
    ): Promise<boolean> {
        const { 
            retry = true,
            retryCount = 2,
            retryDelay = 1500,
            bypassCache = false
        } = options;
        
        // Check cache first if not bypassing
        if (!bypassCache) {
            const now = Date.now();
            // If checking same model or no model and cache is valid
            if (this.serverHealthCache && 
                (now - this.serverHealthCache.timestamp < this.CACHE_TTL) &&
                (this.serverHealthCache.modelName === modelName || (!this.serverHealthCache.modelName && !modelName))) {
                
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`Using cached server health status (TTL: 30s)`);
                }
                return this.serverHealthCache.isHealthy;
            }
        }
        
        let attemptCount = 0;
        const maxAttempts = retry ? retryCount + 1 : 1;
        
        // Implement exponential backoff for retries
        const getBackoffDelay = (attempt: number): number => {
            // Start with base delay and increase exponentially with each attempt
            // Base * 2^(attempt-1) with 10% jitter
            const baseDelay = retryDelay;
            const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
            const jitter = exponentialDelay * 0.1 * Math.random(); // 10% random jitter
            return Math.min(exponentialDelay + jitter, 10000); // Cap at 10 seconds
        };
        
        while (attemptCount < maxAttempts) {
            attemptCount++;
            const currentDelay = getBackoffDelay(attemptCount);
            
            try {
                if (this.apiChannel && attemptCount > 1) {
                    this.apiChannel.appendLine(`[${new Date().toISOString()}] Retrying server health check (attempt ${attemptCount}/${maxAttempts}, delay: ${currentDelay.toFixed(0)}ms)`);
                } else if (this.apiChannel) {
                    this.apiChannel.appendLine(`[${new Date().toISOString()}] Checking Ollama server health`);
                }
                
                // Test if the server is responsive - use a short timeout for better responsiveness
                const tagsResponse = await axios.get(`${this.baseUrl}/api/tags`, { 
                    timeout: Math.min(3000, currentDelay), // Use shorter timeout with each retry
                    validateStatus: null, // Accept any status code
                    headers: { 
                        'Cache-Control': 'no-cache',
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    proxy: false
                });
                
                if (tagsResponse.status !== 200) {
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Server responded with status code ${tagsResponse.status}`);
                    }
                    
                    // If this is not the last attempt, try again
                    if (attemptCount < maxAttempts) {
                        if (this.apiChannel) {
                            this.apiChannel.appendLine(`Waiting ${currentDelay}ms before retrying...`);
                        }
                        await new Promise(resolve => setTimeout(resolve, currentDelay));
                        continue;
                    }
                    
                    // Update cache with failure state
                    this.serverHealthCache = {
                        isHealthy: false,
                        timestamp: Date.now(),
                        modelName
                    };
                    
                    throw new Error(`Ollama server responded with status code ${tagsResponse.status}`);
                }
                
                // If no model specified, we've confirmed server is running
                if (!modelName) {
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Server is healthy (no specific model check requested)`);
                    }
                    
                    // Update cache with success state
                    this.serverHealthCache = {
                        isHealthy: true,
                        timestamp: Date.now()
                    };
                    
                    return true;
                }
                
                // Check if the requested model exists
                if (!tagsResponse.data || !tagsResponse.data.models) {
                    throw new Error('Invalid response from Ollama API (missing models list)');
                }
                
                const models = tagsResponse.data.models;
                const modelExists = models.some((m: any) => m.name === modelName);
                
                // Update model list cache while we're at it, since we already have the data
                this.modelListCache = {
                    models,
                    timestamp: Date.now()
                };
                
                // Update server health cache
                this.serverHealthCache = {
                    isHealthy: true,
                    timestamp: Date.now(),
                    modelName
                };
                
                if (this.apiChannel) {
                    if (modelExists) {
                        this.apiChannel.appendLine(`Server is healthy and model '${modelName}' is available`);
                    } else {
                        // Only log full model list if there aren't too many models
                        if (models.length < 10) {
                            const availableModels = models.map((m: any) => m.name).join(', ');
                            this.apiChannel.appendLine(`Model '${modelName}' not found on server. Available models: ${availableModels}`);
                        } else {
                            this.apiChannel.appendLine(`Model '${modelName}' not found on server. ${models.length} models available.`);
                        }
                        
                        // Check if there's a similar model name (to help with typos)
                        const similarModels = models
                            .map((m: any) => m.name)
                            .filter((name: string) => 
                                name.includes(modelName?.split(':')[0] || '') || 
                                modelName?.includes(name.split(':')[0] || '')
                            );
                        
                        if (similarModels.length > 0) {
                            this.apiChannel.appendLine(`Similar models found: ${similarModels.join(', ')}`);
                        }
                    }
                }
                
                // For model check, we return true even if model doesn't exist
                // We'll handle missing model case separately in the caller
                return true;
                
            } catch (error) {
                // Log the error
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`Server health check failed (attempt ${attemptCount}/${maxAttempts}): ${error instanceof Error ? error.message : String(error)}`);
                }
                
                // If this is not the last attempt, try again after a delay
                if (attemptCount < maxAttempts) {
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Waiting ${currentDelay}ms before retrying...`);
                    }
                    await new Promise(resolve => setTimeout(resolve, currentDelay));
                    continue;
                }
                
                // We've exhausted all attempts, update cache with failure
                this.serverHealthCache = {
                    isHealthy: false,
                    timestamp: Date.now(),
                    modelName
                };
                
                // Rethrow the error
                throw error;
            }
        }
        
        // We should never reach here due to the while loop, but TypeScript needs a return
        return false;
    }
    
    private async startOllamaProcess(): Promise<boolean> {
        try {
            const platform = os.platform();
            console.log(`Starting Ollama on ${platform}`);
            
            let ollamaProcess: child_process.ChildProcess | null = null;
            
            if (platform === 'win32') {
                // Start Ollama on Windows
                const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                console.log(`Starting Ollama from: ${ollamaPath}`);
                
                // Create a more detailed spawn with logging
                ollamaProcess = child_process.spawn(ollamaPath, ['serve'], {
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr
                    windowsHide: true
                });
                
                // Unref process to allow VS Code to exit even if Ollama is still running
                ollamaProcess.unref();
                
                // Log stdout and stderr for debugging
                if (ollamaProcess.stdout) {
                    ollamaProcess.stdout.on('data', (data) => {
                        console.log(`Ollama output: ${data.toString().trim()}`);
                    });
                }
                
                if (ollamaProcess.stderr) {
                    ollamaProcess.stderr.on('data', (data) => {
                        console.error(`Ollama error: ${data.toString().trim()}`);
                    });
                }
                
                // Log process events
                ollamaProcess.on('error', (err) => {
                    console.error(`Failed to start Ollama process: ${err.message}`);
                });
                
                ollamaProcess.on('exit', (code, signal) => {
                    if (code !== null) {
                        console.log(`Ollama process exited with code ${code}`);
                    } else if (signal !== null) {
                        console.log(`Ollama process was killed with signal ${signal}`);
                    }
                });
            } else {
                // Start Ollama on macOS or Linux
                console.log('Starting Ollama using "ollama serve"');
                
                // Create a more detailed spawn with logging
                ollamaProcess = child_process.spawn('ollama', ['serve'], {
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout and stderr
                });
                
                // Unref process to allow VS Code to exit even if Ollama is still running
                ollamaProcess.unref();
                
                // Log stdout and stderr for debugging
                if (ollamaProcess.stdout) {
                    ollamaProcess.stdout.on('data', (data) => {
                        console.log(`Ollama output: ${data.toString().trim()}`);
                    });
                }
                
                if (ollamaProcess.stderr) {
                    ollamaProcess.stderr.on('data', (data) => {
                        console.error(`Ollama error: ${data.toString().trim()}`);
                    });
                }
                
                // Log process events
                ollamaProcess.on('error', (err) => {
                    console.error(`Failed to start Ollama process: ${err.message}`);
                });
                
                ollamaProcess.on('exit', (code, signal) => {
                    if (code !== null) {
                        console.log(`Ollama process exited with code ${code}`);
                    } else if (signal !== null) {
                        console.log(`Ollama process was killed with signal ${signal}`);
                    }
                });
            }
            
            // Report to user that we're waiting for Ollama to start
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Starting Ollama",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Waiting for Ollama server to start..." });
                
                // Give Ollama some time to start - check multiple times with increasing wait
                let isRunning = false;
                const maxRetries = 5;
                
                for (let i = 0; i < maxRetries; i++) {
                    // Calculate wait time: 2s, 3s, 4s, 5s, 6s
                    const waitTime = 2000 + (i * 1000);
                    progress.report({ message: `Waiting for Ollama server to start (attempt ${i+1}/${maxRetries})...` });
                    
                    // Wait before checking
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    
                    // Check if it's running now
                    try {
                        const response = await axios.get(`${this.baseUrl}/api/tags`, { 
                            timeout: 3000,
                            validateStatus: null,
                            headers: {
                                'Accept': 'application/json'
                            },
                            proxy: false
                        });
                        
                        if (response.status === 200) {
                            console.log(`Ollama server started successfully after ${i+1} attempts`);
                            isRunning = true;
                            break;
                        } else {
                            console.log(`Ollama server returned status ${response.status} on attempt ${i+1}`);
                        }
                    } catch (e) {
                        console.log(`Ollama server not ready on attempt ${i+1}: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }
                
                if (isRunning) {
                    vscode.window.showInformationMessage(`Ollama server started successfully.`);
                } else {
                    vscode.window.showWarningMessage(`Failed to verify if Ollama server started. It might need more time or there could be an issue.`);
                }
                
                return isRunning;
            });
            
            // One final check to return the status
            try {
                const response = await axios.get(`${this.baseUrl}/api/tags`, { 
                    timeout: 3000,
                    validateStatus: null,
                    headers: {
                        'Accept': 'application/json'
                    },
                    proxy: false
                });
                return response.status === 200;
            } catch (e) {
                return false;
            }
        } catch (e) {
            console.error(`Error starting Ollama process: ${e instanceof Error ? e.message : String(e)}`);
            vscode.window.showErrorMessage(`Failed to start Ollama: ${e instanceof Error ? e.message : String(e)}`);
            return false;
        }
    }

    async checkAndSuggestModels(models: OllamaModel[]): Promise<void> {
        if (models.length === 0) {
            const installModel = await vscode.window.showInformationMessage(
                'No Ollama models are installed. Would you like to pull a model now?',
                'Install a Model',
                'Cancel'
            );
            
            if (installModel === 'Install a Model') {
                const recommendedModels = [
                    { label: 'gemma:7b', description: 'Google Gemma 7B model - 4.8GB' },
                    { label: 'llama3:8b', description: 'Meta Llama 3 8B model - 4.7GB' },
                    { label: 'mistral:7b', description: 'Mistral 7B model - 4.1GB' },
                    { label: 'phi3:mini', description: 'Microsoft Phi-3 mini - 1.7GB' },
                    { label: 'neural-chat:7b', description: 'Neural Chat 7B model - 4.1GB' }
                ];
                
                const selectedModel = await vscode.window.showQuickPick(recommendedModels, {
                    placeHolder: 'Select a model to install (will download several GB)',
                });
                
                if (selectedModel) {
                    // Show progress for downloading the model
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: `Downloading ${selectedModel.label} model...`,
                        cancellable: false
                    }, async (progress) => {
                        try {
                            // Start the model pull process
                            progress.report({ message: 'Downloading and installing model...' });
                            
                            // Execute the ollama pull command
                            await this.pullModel(selectedModel.label);
                            
                            vscode.window.showInformationMessage(`Successfully installed ${selectedModel.label} model!`);
                        } catch (error) {
                            vscode.window.showErrorMessage(`Failed to install model: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    });
                }
            }
        }
    }
    
    private async pullModel(modelName: string): Promise<void> {
        let progressReporter: vscode.Progress<{ message?: string; increment?: number }> | null = null;
        let progressResolver: (() => void) | null = null;
        let cancelRequested = false;
        
        // Create a promise that will be resolved when the progress is complete
        const progressPromise = new Promise<void>(resolve => {
            progressResolver = resolve;
        });
        
        // Start the progress reporting
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${modelName}...`,
            cancellable: true
        }, async (progress, token) => {
            progressReporter = progress;
            progress.report({ increment: 0, message: 'Preparing download...' });
            
            // Set up cancellation
            token.onCancellationRequested(() => {
                cancelRequested = true;
                vscode.window.showInformationMessage(`Download of ${modelName} was cancelled`);
                if (progressResolver) progressResolver();
            });
            
            return progressPromise;
        });
        
        // Create a timeout for the initial connection
        const initialConnectionTimeout = setTimeout(() => {
            if (progressReporter && !cancelRequested) {
                progressReporter.report({ 
                    message: 'Connecting to Ollama server...' 
                });
            }
        }, 2000);
        
        try {
            // Use the Ollama API to pull the model
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30-minute timeout for very large models
            
            // Track download stats
            let startTime = Date.now();
            let lastReportTime = startTime;
            let lastBytes = 0;
            let totalDownloaded = 0;
            let downloadSpeed = 0;
            let estimatedTimeRemaining = '';
            
            // Clear initial connection timeout
            clearTimeout(initialConnectionTimeout);
            
            const response = await axios.post(`${this.baseUrl}/api/pull`, {
                name: modelName,
                stream: true
            }, {
                signal: controller.signal,
                responseType: 'stream',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                proxy: false,
                onDownloadProgress: (progressEvent) => {
                    if (cancelRequested) return;
                    
                    const now = Date.now();
                    const elapsedSec = (now - lastReportTime) / 1000;
                    
                    // Only update speed calculation every second to avoid jitter
                    if (elapsedSec >= 1 && progressEvent.loaded > lastBytes) {
                        totalDownloaded = progressEvent.loaded;
                        
                        // Calculate download speed in MB/s
                        const bytesPerSec = (progressEvent.loaded - lastBytes) / elapsedSec;
                        downloadSpeed = bytesPerSec / (1024 * 1024);
                        
                        // Update for next calculation
                        lastBytes = progressEvent.loaded;
                        lastReportTime = now;
                        
                        // Calculate estimated time remaining if we know the total
                        if (progressEvent.total) {
                            const bytesRemaining = progressEvent.total - progressEvent.loaded;
                            const secondsRemaining = Math.round(bytesRemaining / bytesPerSec);
                            
                            if (secondsRemaining > 60) {
                                const minutes = Math.floor(secondsRemaining / 60);
                                const seconds = secondsRemaining % 60;
                                estimatedTimeRemaining = `${minutes}m ${seconds}s remaining`;
                            } else {
                                estimatedTimeRemaining = `${secondsRemaining}s remaining`;
                            }
                        }
                    }
                    
                    if (progressReporter && !cancelRequested) {
                        if (progressEvent.total) {
                            const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                            const sizeInGB = (progressEvent.total / (1024 * 1024 * 1024)).toFixed(2);
                            const downloadedGB = (progressEvent.loaded / (1024 * 1024 * 1024)).toFixed(2);
                            
                            progressReporter.report({
                                increment: percent,
                                message: `${downloadedGB}GB / ${sizeInGB}GB (${percent}%) - ${downloadSpeed.toFixed(1)} MB/s - ${estimatedTimeRemaining}`
                            });
                        } else {
                            // If we can't get the total size, just show downloaded amount and speed
                            const downloadedMB = (progressEvent.loaded / (1024 * 1024)).toFixed(1);
                            progressReporter.report({
                                message: `Downloaded: ${downloadedMB}MB - ${downloadSpeed.toFixed(1)} MB/s`
                            });
                        }
                    }
                }
            });
            
            // Clear the timeout
            clearTimeout(timeoutId);
            
            if (cancelRequested) {
                console.log("Download was cancelled by user");
                return;
            }
            
            // Track current step in the model installation process
            let currentStep = "downloading";
            
            // Process the streaming response to track progress
            response.data.on('data', (chunk: Buffer) => {
                if (cancelRequested) return;
                
                try {
                    const text = chunk.toString();
                    
                    // Log partial output for debugging
                    if (text.length > 100) {
                        console.log(`Model download progress: ${text.substring(0, 100)}...`);
                    } else {
                        console.log(`Model download progress: ${text}`);
                    }
                    
                    if (progressReporter) {
                        try {
                            // Parse JSON responses if possible
                            const lines = text.split('\n').filter(Boolean);
                            
                            for (const line of lines) {
                                try {
                                    const data = JSON.parse(line);
                                    
                                    // Check for different status messages
                                    if (data.status) {
                                        if (data.status.includes('downloading')) {
                                            currentStep = "downloading";
                                        } else if (data.status.includes('verifying')) {
                                            currentStep = "verifying";
                                            progressReporter.report({ message: "Verifying model files..." });
                                        } else if (data.status.includes('unpacking')) {
                                            currentStep = "unpacking";
                                            progressReporter.report({ message: "Unpacking model files..." });
                                        } else if (data.status.includes('loading')) {
                                            currentStep = "loading";
                                            progressReporter.report({ message: "Loading model into memory..." });
                                        }
                                    }
                                    
                                    // Try to extract detailed progress information
                                    if (data.completed && data.total && currentStep === "downloading") {
                                        const percent = Math.round((data.completed / data.total) * 100);
                                        const downloadedMB = (data.completed / (1024 * 1024)).toFixed(1);
                                        const totalMB = (data.total / (1024 * 1024)).toFixed(1);
                                        
                                        progressReporter.report({
                                            message: `Downloading model: ${downloadedMB}MB / ${totalMB}MB (${percent}%)`
                                        });
                                    }
                                    
                                    // Extract progress percentage as fallback
                                    if (!data.completed && !data.total) {
                                        const progressMatch = text.match(/([0-9.]+)%/);
                                        if (progressMatch) {
                                            const percent = parseFloat(progressMatch[1]);
                                            progressReporter.report({
                                                message: `${currentStep}: ${percent.toFixed(1)}%`
                                            });
                                        }
                                    }
                                } catch (parseError) {
                                    // Not valid JSON or couldn't parse the line, that's fine
                                }
                            }
                        } catch (e) {
                            console.error('Error processing JSON download progress:', e);
                        }
                    }
                } catch (e) {
                    console.error('Error processing download chunk:', e);
                }
            });
            
            // Complete the download
            await new Promise<void>((resolve, reject) => {
                response.data.on('end', () => {
                    if (!cancelRequested && progressReporter) {
                        progressReporter.report({ message: 'Model download complete! Finalizing installation...' });
                    }
                    resolve();
                });
                
                response.data.on('error', (err: Error) => {
                    reject(err);
                });
            });
            
            if (!cancelRequested) {
                // Show final success message with model size
                try {
                    const models = await this.listModels();
                    const downloadedModel = models.find(m => m.name === modelName);
                    
                    if (downloadedModel) {
                        const sizeGB = (downloadedModel.size / (1024 * 1024 * 1024)).toFixed(2);
                        vscode.window.showInformationMessage(
                            `Successfully installed model ${modelName} (${sizeGB} GB)`,
                            'Use Now'
                        ).then(selection => {
                            if (selection === 'Use Now') {
                                vscode.commands.executeCommand('vscode-ollama.runModel');
                            }
                        });
                    } else {
                        vscode.window.showInformationMessage(`Successfully installed model ${modelName}`);
                    }
                } catch (e) {
                    vscode.window.showInformationMessage(`Successfully installed model ${modelName}`);
                }
            }
            
            // Resolve the progress
            if (progressResolver) progressResolver();
            
            return;
        } catch (error) {
            // Clear initial connection timeout if it's still active
            clearTimeout(initialConnectionTimeout);
            
            // Resolve the progress to dismiss it
            if (progressResolver) progressResolver();
            
            let errorMessage = `Failed to pull model ${modelName}`;
            
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    errorMessage += ': Connection timed out. The model might be too large or the server is busy.';
                } else if (error.response) {
                    errorMessage += `: Server responded with status ${error.response.status}`;
                    
                    // Check specifically for 404 errors which often mean the model name is incorrect
                    if (error.response.status === 404) {
                        errorMessage += `. Model '${modelName}' not found. Please check the model name.`;
                    }
                } else if (error.request) {
                    errorMessage += ': No response received from server. Please check your network connection.';
                } else {
                    errorMessage += `: ${error.message}`;
                }
            } else if (error instanceof Error) {
                errorMessage += `: ${error.message}`;
            }
            
            vscode.window.showErrorMessage(errorMessage, 'Try Again', 'Show Available Models').then(selection => {
                if (selection === 'Try Again') {
                    this.pullModel(modelName);
                } else if (selection === 'Show Available Models') {
                    // Open the Ollama models page in a browser
                    vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/library'));
                }
            });
            
            throw error;
        }
    }

    async listModels(): Promise<OllamaModel[]> {
        // Check cache first
        const now = Date.now();
        if (this.modelListCache && (now - this.modelListCache.timestamp < this.CACHE_TTL)) {
            console.log('Using cached model list');
            if (this.apiChannel) {
                this.apiChannel.appendLine('Using cached model list (TTL: 30s)');
            }
            return this.modelListCache.models;
        }
    
        // Cache miss or expired, check if Ollama is installed and running
        const isInstalled = await this.checkOllamaInstalled();
        if (!isInstalled) {
            return [];
        }
        
        // Use retry pattern for better resilience against network issues
        const maxRetries = 3;
        let retryCount = 0;
        let lastError = null;
        
        while (retryCount < maxRetries) {
            try {
                console.log(`Attempting to fetch models from: ${this.baseUrl}/api/tags (attempt ${retryCount + 1}/${maxRetries})`);
                
                if (this.apiChannel && retryCount > 0) {
                    this.apiChannel.appendLine(`Retry attempt ${retryCount + 1}/${maxRetries} for model list`);
                }
                
                const response = await axios.get(`${this.baseUrl}/api/tags`, {
                    timeout: 8000, // Increased timeout for better reliability
                    validateStatus: null, // Allow any status code to be returned for better error handling
                    headers: { 
                        'Cache-Control': 'no-cache', 
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    // Disable proxy to avoid potential network issues
                    proxy: false
                });
                
                // Log the status and response for diagnostics
                console.log(`Ollama API response status: ${response.status}`);
                
                if (response.status !== 200) {
                    throw new Error(`API returned status code ${response.status}: ${JSON.stringify(response.data)}`);
                }
                
                if (!response.data || !response.data.models) {
                    throw new Error(`Invalid response structure: ${JSON.stringify(response.data)}`);
                }
                
                const models = response.data.models;
                console.log(`Found ${models.length} models`);
                
                // Cache the model list
                this.modelListCache = {
                    models,
                    timestamp: Date.now()
                };
                
                // Check if models need to be installed
                await this.checkAndSuggestModels(models);
                
                return models;
            } catch (error) {
                lastError = error;
                retryCount++;
                
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`Error on attempt ${retryCount}: ${error instanceof Error ? error.message : String(error)}`);
                }
                
                // Only retry if we haven't exceeded max retries
                if (retryCount < maxRetries) {
                    // Exponential backoff delay with jitter
                    const baseDelay = 1000; // 1 second
                    const delay = baseDelay * Math.pow(2, retryCount - 1) + (Math.random() * 500);
                    console.log(`Waiting ${delay}ms before retry...`);
                    
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Waiting ${Math.round(delay)}ms before retry...`);
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
                
        // If we get here, all retries failed
        // Enhanced error reporting
        let errorMessage = '';
        const error = lastError;
        
        if (axios.isAxiosError(error)) {
            errorMessage = `Network error: ${error.message}`;
            if (error.response) {
                errorMessage += ` (Status: ${error.response.status})`;
                if (error.response.data) {
                    errorMessage += ` Server response: ${JSON.stringify(error.response.data)}`;
                }
            } else if (error.request) {
                errorMessage += ` (No response received, request was sent)`;
            }
        } else {
            errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
        
        console.error('Ollama API error:', errorMessage);
        
        // Show a more helpful error message with diagnostic information
        vscode.window.showErrorMessage(
            `Failed to list Ollama models: ${errorMessage}. Please check if Ollama is running and check the developer console for details.`, 
            'Retry', 
            'Check Ollama'
        ).then(selection => {
            if (selection === 'Retry') {
                return this.listModels();
            } else if (selection === 'Check Ollama') {
                // Open terminal and suggest Ollama troubleshooting commands
                const terminal = vscode.window.createTerminal('Ollama Diagnostics');
                terminal.show();
                terminal.sendText('# Check if Ollama is running');
                terminal.sendText('ps aux | grep ollama');
                terminal.sendText('# Try starting Ollama manually');
                terminal.sendText('ollama serve');
            }
        });
        
        return [];
    }

    // Add missing method signatures for API compatibility

    async generateCompletion(model: string, prompt: string): Promise<string> {
        console.log(`Generating completion with model: ${model}, prompt length: ${prompt.length} chars`);
        
        try {
            // Check if Ollama is running and healthy
            try {
                // Check server health more thoroughly before proceeding
                await this.checkServerHealth(model);
            } catch (checkError) {
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`Server health check failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
                    this.apiChannel.appendLine('Attempting to start or restart Ollama service...');
                }
                
                // If Ollama is not running or not healthy, try to start it
                console.log("Ollama API check failed, attempting to start Ollama service");
                await this.startOllamaProcess();
                
                // More generous delay to allow Ollama to start and load models
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Verify server is actually responding after restart
                try {
                    await axios.get(`${this.baseUrl}/api/tags`, { 
                        timeout: 3000, 
                        headers: {
                            'Accept': 'application/json'
                        },
                        proxy: false
                    });
                    if (this.apiChannel) {
                        this.apiChannel.appendLine('Successfully started Ollama service');
                    }
                } catch (secondCheckError) {
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Failed to start Ollama service: ${secondCheckError instanceof Error ? secondCheckError.message : String(secondCheckError)}`);
                    }
                    // Still proceed with the request - will fail properly with clear error if server is down
                }
            }
            
            console.log(`Sending request to: ${this.baseUrl}/api/generate (non-streaming)`);
            const response = await axios.post(`${this.baseUrl}/api/generate`, 
                {
                    model,
                    prompt,
                    stream: false
                }, 
                {
                    timeout: 30000, // 30 second timeout - fail faster if no response
                    validateStatus: status => status === 200, // Only accept 200 status
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    proxy: false
                }
            );
            
            if (!response.data || !response.data.response) {
                console.error('Invalid response structure:', response.data);
                throw new Error(`Invalid response from Ollama API: missing 'response' field`);
            }
            
            console.log('Generation completed successfully');
            return response.data.response;
        } catch (error) {
            // Enhanced error reporting
            let errorMessage = '';
            if (axios.isAxiosError(error)) {
                errorMessage = `Network error: ${error.message}`;
                
                if (error.response) {
                    console.error('Response error data:', error.response.data);
                    errorMessage += ` (Status: ${error.response.status})`;
                    
                    // Check for specific error conditions
                    if (error.response.status === 404) {
                        errorMessage += `. Model '${model}' might not be installed. Try installing it first.`;
                    } else if (error.response.status === 500) {
                        errorMessage += `. Server error - Ollama might be having trouble with this request.`;
                    }
                } else if (error.request) {
                    errorMessage += ` (No response received)`;
                }
            } else {
                errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
            }
            
            console.error('Ollama API generation error:', errorMessage);
            
            vscode.window.showErrorMessage(
                `Failed to generate completion: ${errorMessage}`, 
                'Retry'
            ).then(selection => {
                if (selection === 'Retry') {
                    return this.generateCompletion(model, prompt);
                }
            });
            
            throw error;
        }
    }

    async streamCompletion(
        model: string, 
        prompt: string, 
        onChunk: (text: string) => void,
        options?: {
            maxTokens?: number,
            temperature?: number,
            timeoutSeconds?: number
        }
    ): Promise<void> {
        console.log(`Streaming completion with model: ${model}, prompt length: ${prompt.length} chars`);
        
        // Get configuration with defaults
        const maxTokens = options?.maxTokens || 
            vscode.workspace.getConfiguration('ollama').get('maxResponseTokens') as number || 
            4096;
            
        const temperature = options?.temperature || 
            vscode.workspace.getConfiguration('ollama').get('temperature') as number || 
            0.7;
            
        const timeoutSeconds = options?.timeoutSeconds || 
            vscode.workspace.getConfiguration('ollama').get('requestTimeout') as number || 
            90; // 90 second default timeout
        
        // Create a timeout tracker to detect stalled responses
        let responseTimeoutId: NodeJS.Timeout | null = null;
        let lastResponseTime = Date.now();
        let hasReceivedFirstChunk = false;
        
        try {
            // Perform a thorough server health check before starting
            try {
                await this.checkServerHealth(model, { retry: true, retryCount: 1 });
            } catch (checkError) {
                console.log("Server health check failed, attempting to start Ollama service");
                
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`Health check failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
                    this.apiChannel.appendLine(`Attempting to start or restart Ollama service...`);
                }
                
                // Try to start Ollama process
                await this.startOllamaProcess();
                
                // Give it time to start and stabilize
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try one more health check
                try {
                    await this.checkServerHealth(model, { retry: false });
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Ollama service started successfully`);
                    }
                } catch (secondCheckError) {
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Failed to start Ollama service: ${secondCheckError instanceof Error ? secondCheckError.message : String(secondCheckError)}`);
                    }
                    // Continue anyway, let the main request handle errors properly
                }
            }
            
            // Let the user know we're working
            onChunk(`_Thinking..._`);
            
            // Prepare the API request parameters with adjustable options
            const requestParams = {
                model,
                prompt,
                stream: true,
                options: {
                    num_predict: maxTokens,            // Maximum tokens to generate
                    temperature: temperature,          // Temperature setting
                    top_k: 40,                         // Default top_k
                    top_p: 0.9,                        // Default top_p
                    repeat_penalty: 1.1                // Slight penalty for repetition
                }
            };
            
            // Set response timeout handler - abort if no chunks received within timeoutSeconds/2
            const setupResponseTimeout = () => {
                // Clear any existing timeout
                if (responseTimeoutId) {
                    clearTimeout(responseTimeoutId);
                }
                
                // Create a new timeout
                responseTimeoutId = setTimeout(() => {
                    const timeElapsed = (Date.now() - lastResponseTime) / 1000;
                    console.error(`No response chunks received for ${timeElapsed.toFixed(1)} seconds`);
                    
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`WARNING: No response chunks received for ${timeElapsed.toFixed(1)} seconds`);
                    }
                    
                    // If we've never received a chunk, the request likely failed to start properly
                    if (!hasReceivedFirstChunk) {
                        const errorMsg = `Ollama server is not responding. The request may be stuck or the server may be overloaded.`;
                        console.error(errorMsg);
                        onChunk(`\n\n_Error: ${errorMsg}_`);
                        // We'll let the Promise timeout handle the actual termination
                    }
                }, Math.min(10000, (timeoutSeconds * 1000) / 3)); // Use at most 10 seconds for quicker feedback
            };
            
            // Setup initial timeout
            setupResponseTimeout();
            
            // Make the API request
            const response = await axios.post(
                `${this.baseUrl}/api/generate`, 
                requestParams, 
                {
                    responseType: 'stream',
                    timeout: (timeoutSeconds + 30) * 1000, // Add 30s to axios timeout as a safety margin
                    maxContentLength: Infinity,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    proxy: false
                }
            );
            
            // Clear the initial "thinking" message since we're about to get real content
            onChunk('');
            
            // Process the stream data
            if (response.data) {
                // Add error handlers directly to the stream
                response.data.on('error', (err: Error) => {
                    console.error('Stream error:', err);
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Stream error: ${err.message}`);
                    }
                    onChunk(`\n\n_Error in stream: ${err.message}_`);
                });
                
                response.data.on('data', (chunk: Buffer) => {
                    try {
                        // Update the last response time
                        lastResponseTime = Date.now();
                        hasReceivedFirstChunk = true;
                        
                        // Reset the timeout since we got a chunk
                        setupResponseTimeout();
                        
                        const text = chunk.toString();
                        console.log(`Received chunk: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
                        
                        const lines = text.split('\n').filter(Boolean);
                        for (const line of lines) {
                            try {
                                const data = JSON.parse(line);
                                
                                // Extract and send the response text if present
                                if (data.response) {
                                    onChunk(data.response);
                                }
                                
                                // Check for completion marker
                                if (data.done === true) {
                                    console.log('Stream completed');
                                    // Clean up timeout if we're done
                                    if (responseTimeoutId) {
                                        clearTimeout(responseTimeoutId);
                                        responseTimeoutId = null;
                                    }
                                }
                            } catch (parseError) {
                                console.error('Error parsing JSON in stream chunk:', parseError);
                                if (this.apiChannel) {
                                    this.apiChannel.appendLine(`Error parsing JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                                    this.apiChannel.appendLine(`Raw chunk: ${text}`);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error processing stream chunk:', error);
                        if (this.apiChannel) {
                            this.apiChannel.appendLine(`Error processing chunk: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }
                });
                
                // Wait for stream to end with more efficient timeout
                await new Promise<void>((resolve, reject) => {
                    // Set a timeout that uses shorter timeout if no chunks received yet
                    const actualTimeout = hasReceivedFirstChunk ? 
                        timeoutSeconds * 1000 : // Full timeout if we're getting data
                        Math.min(15000, timeoutSeconds * 1000 / 2); // Shorter timeout if no data yet
                        
                    const timeoutId = setTimeout(() => {
                        const msg = hasReceivedFirstChunk ?
                            `Stream timed out after ${timeoutSeconds} seconds` :
                            `No initial response received after ${actualTimeout/1000} seconds`;
                            
                        if (this.apiChannel) {
                            this.apiChannel.appendLine(msg);
                        }
                        reject(new Error(msg));
                    }, actualTimeout);
                    
                    // Set up heartbeat check for stalled responses
                    let lastActivityTime = Date.now();
                    const heartbeatInterval = setInterval(() => {
                        const inactiveTime = (Date.now() - lastActivityTime) / 1000;
                        // If we've received data but then it stalls for too long
                        if (hasReceivedFirstChunk && inactiveTime > Math.min(30, timeoutSeconds / 2)) {
                            clearInterval(heartbeatInterval);
                            clearTimeout(timeoutId);
                            reject(new Error(`Stream stalled after ${inactiveTime.toFixed(1)} seconds of inactivity`));
                        }
                    }, 5000);
                    
                    response.data.on('end', () => {
                        clearTimeout(timeoutId);
                        clearInterval(heartbeatInterval);
                        if (responseTimeoutId) {
                            clearTimeout(responseTimeoutId);
                            responseTimeoutId = null;
                        }
                        console.log('Stream ended normally');
                        resolve();
                    });
                    
                    response.data.on('error', (err: Error) => {
                        clearTimeout(timeoutId);
                        clearInterval(heartbeatInterval);
                        if (responseTimeoutId) {
                            clearTimeout(responseTimeoutId);
                            responseTimeoutId = null;
                        }
                        console.error('Stream error during wait:', err);
                        reject(err);
                    });
                    
                    // Update activity time when data chunks received
                    response.data.on('data', () => {
                        lastActivityTime = Date.now();
                    });
                });
                
                // Clean up any remaining timeouts
                if (responseTimeoutId) {
                    clearTimeout(responseTimeoutId);
                    responseTimeoutId = null;
                }
            }
        } catch (error) {
            // Make sure timeout is cleared
            if (responseTimeoutId) {
                clearTimeout(responseTimeoutId);
                responseTimeoutId = null;
            }
            
            // Enhanced error reporting
            let errorMessage = '';
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                errorMessage = `Network error: ${axiosError.message}`;
                
                if (axiosError.response) {
                    errorMessage += ` (Status: ${axiosError.response.status})`;
                } else if (axiosError.request) {
                    errorMessage += ` (No response received)`;
                    // Special handling for timeout case
                    if (axiosError.code === 'ECONNABORTED') {
                        errorMessage = `Request timed out after ${timeoutSeconds} seconds. The model might be busy or the server might be overloaded.`;
                    }
                }
            } else if (error instanceof Error) {
                errorMessage = `Error: ${error.message}`;
            } else {
                errorMessage = `Unknown error: ${String(error)}`;
            }
            
            console.error('Ollama streaming error:', errorMessage);
            if (this.apiChannel) {
                this.apiChannel.appendLine(`Streaming error: ${errorMessage}`);
            }
            
            // Always add error message to the UI
            onChunk(`\n\n_Error: ${errorMessage}_`);
            
            // Rethrow for proper error propagation
            throw error;
        }
    }
}