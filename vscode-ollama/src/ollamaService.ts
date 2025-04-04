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
        this.serviceChannel = serviceChannel;
        this.apiChannel = apiChannel;
        
        try {
            // Ensure output channels are visible in the Output panel dropdown
            this.serviceChannel.show(false);
            this.apiChannel.show(false);
            
            this.baseUrl = vscode.workspace.getConfiguration('ollama').get('apiUrl') as string || 'http://localhost:11434';
            console.log(`Using Ollama API URL: ${this.baseUrl}`);
            
            this.serviceChannel.appendLine(`Ollama Service initialized with API URL: ${this.baseUrl}`);
            this.apiChannel.appendLine(`API Channel initialized - API URL: ${this.baseUrl}`);
            
            // Log channel names to make debugging easier
            this.serviceChannel.appendLine(`Channel names: Service='${this.serviceChannel.name}', API='${this.apiChannel.name}'`);
            this.apiChannel.appendLine(`Channel names: Service='${this.serviceChannel.name}', API='${this.apiChannel.name}'`);
            
            this.logSystemInfo();
            
            const autoStartEnabled = vscode.workspace.getConfiguration('ollama').get('autoStartServer', true);
            this.serviceChannel.appendLine(`Auto-start server configuration: ${autoStartEnabled ? 'enabled' : 'disabled'}`);
            this.apiChannel.appendLine(`Auto-start server configuration: ${autoStartEnabled ? 'enabled' : 'disabled'}`);
            this.serviceChannel.appendLine('Auto-start check will be performed when extension activates');
        } catch (error) {
            console.error('Error initializing OllamaService:', error);
            this.serviceChannel.appendLine(`Error in OllamaService constructor: ${error instanceof Error ? error.message : String(error)}`);
            if (this.apiChannel) {
                this.apiChannel.appendLine(`Error in OllamaService constructor: ${error instanceof Error ? error.message : String(error)}`);
            }
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
            
            // Log Ollama configuration
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
            
            this.serviceChannel.show(false);
        } catch (error) {
            this.serviceChannel.appendLine(`Error logging system info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private getInstallInstructions(): {title: string, url: string} {
        const platform = os.platform();
        
        if (platform === 'darwin') {
            return { title: 'Download Ollama for macOS', url: 'https://ollama.com/download/mac' };
        } else if (platform === 'win32') {
            return { title: 'Download Ollama for Windows', url: 'https://ollama.com/download/windows' };
        } else {
            return { title: 'Install Ollama for Linux', url: 'https://ollama.com/download/linux' };
        }
    }

    async checkOllamaInstalled(): Promise<boolean> {
        if (this.isInstalled !== null && !vscode.workspace.getConfiguration('ollama').get('forceRecheck', false)) {
            return this.isInstalled;
        }

        try {
            console.log(`Attempting to connect to Ollama API at ${this.baseUrl}/api/tags`);
            
            // Make sure the API channel is visible and active
            this.apiChannel.show(false);
            
            this.apiChannel.appendLine(`\n============ CONNECTION ATTEMPT DETAILS ============`);
            this.apiChannel.appendLine(`Time: ${new Date().toISOString()}`);
            this.apiChannel.appendLine(`URL: ${this.baseUrl}/api/tags`);
            this.apiChannel.appendLine(`OS: ${os.platform()} ${os.release()}`);
            this.apiChannel.appendLine(`Channel name: '${this.apiChannel.name}'`);
            
            // Force showing the API channel when checking installation
            vscode.commands.executeCommand('workbench.action.output.show', this.apiChannel.name);
            
            const response = await axios.get(`${this.baseUrl}/api/tags`, { 
                timeout: 5000,
                validateStatus: null,
                headers: { 'Cache-Control': 'no-cache', 'Accept': 'application/json' },
                proxy: false
            });
            
            this.apiChannel.appendLine(`Response status: ${response.status}`);
            this.apiChannel.appendLine(`Response data: ${JSON.stringify(response.data).substring(0, 200)}...`);
            
            // Ensure the API channel is shown after successful response
            this.apiChannel.show(false);
            
            if (response.status === 200) {
                console.log('Ollama API connection successful');
                this.isInstalled = true;
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`✅ Ollama API connection successful - server is running`);
                }
                return true;
            } else {
                console.log(`Ollama API returned status: ${response.status}`);
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`⚠️ Ollama API returned status code ${response.status}`);
                }
                throw new Error(`Ollama API returned status code ${response.status}`);
            }
        } catch (error) {
            console.log('Ollama API connection failed:', error);
            
            if (this.apiChannel) {
                this.apiChannel.appendLine(`\n❌ CONNECTION ERROR DETAILS ❌`);
                this.apiChannel.appendLine(`Time: ${new Date().toISOString()}`);
                
                if (axios.isAxiosError(error)) {
                    const axiosError = error;
                    this.apiChannel.appendLine(`Error type: Axios Error`);
                    this.apiChannel.appendLine(`Error code: ${axiosError.code || 'none'}`);
                    this.apiChannel.appendLine(`Error message: ${axiosError.message}`);
                    
                    if (axiosError.code === 'ECONNREFUSED') {
                        this.apiChannel.appendLine(`📌 DIAGNOSIS: Connection refused - Ollama server is likely not running`);
                    } else if (axiosError.code === 'ENOTFOUND') {
                        this.apiChannel.appendLine(`📌 DIAGNOSIS: Host not found - Check network config or hostname`);
                    } else if (axiosError.code === 'ETIMEDOUT') {
                        this.apiChannel.appendLine(`📌 DIAGNOSIS: Connection timed out - Server may be busy or unreachable`);
                    }
                }
                
                this.apiChannel.appendLine(`\nTrying to verify Ollama installation status...`);
            }
            
            // Check if it's a connection error (likely Ollama is not running)
            const isConnectionError = axios.isAxiosError(error) && 
                (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT');
            
            if (isConnectionError) {
                console.log('Connection error, checking if Ollama is installed but not running');
                
                try {
                    const platform = os.platform();
                    console.log(`Checking for Ollama installation on ${platform}`);
                    
                    if (platform === 'win32') {
                        const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                        console.log(`Looking for Ollama at: ${ollamaPath}`);
                        
                        const exists = fs.existsSync(ollamaPath);
                        console.log(`Ollama binary exists: ${exists}`);
                        this.isInstalled = exists;
                        
                        if (this.isInstalled && vscode.workspace.getConfiguration('ollama').get('autoStartServer', true)) {
                            console.log('Attempting to start Ollama process on Windows');
                            return await this.startOllamaProcess();
                        }
                    } else {
                        // For macOS and Linux, check if ollama is in the PATH
                        try {
                            console.log('Checking if ollama is in PATH');
                            if (this.apiChannel) {
                                this.apiChannel.appendLine('Checking if ollama binary is available in PATH...');
                            }
                            
                            try {
                                const versionOutput = child_process.execSync('ollama --version', { encoding: 'utf8' });
                                console.log('Ollama binary found in PATH:', versionOutput.trim());
                                if (this.apiChannel) {
                                    this.apiChannel.appendLine(`Ollama binary found: ${versionOutput.trim()}`);
                                }
                            } catch (versionError) {
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
                                        this.apiChannel.appendLine('Checking common installation paths...');
                                        const commonPaths = [
                                            '/usr/local/bin/ollama',
                                            '/usr/bin/ollama',
                                            '/opt/ollama/ollama',
                                            `/home/${os.userInfo().username}/ollama/ollama`,
                                            `/home/${os.userInfo().username}/.ollama/ollama`
                                        ];
                                        for (const path of commonPaths) {
                                            if (fs.existsSync(path)) {
                                                this.apiChannel.appendLine(`✅ Found ollama binary at ${path}`);
                                                break;
                                            }
                                        }
                                    }
                                    throw locateError;
                                }
                            }
                            
                            this.isInstalled = true;
                            
                            if (vscode.workspace.getConfiguration('ollama').get('autoStartServer', true)) {
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
                    return await this.startOllamaProcess();
                }
            }
            
            return false;
        }
    }

    /**
     * Check if the Ollama server is healthy and the specified model is available
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
                    this.apiChannel.appendLine(`[${new Date().toISOString()}] Retrying server health check (attempt ${attemptCount}/${maxAttempts})`);
                } else if (this.apiChannel) {
                    this.apiChannel.appendLine(`[${new Date().toISOString()}] Checking Ollama server health`);
                }
                
                // Test if the server is responsive
                const tagsResponse = await axios.get(`${this.baseUrl}/api/tags`, { 
                    timeout: Math.min(3000, currentDelay),
                    validateStatus: null,
                    headers: { 'Cache-Control': 'no-cache', 'Accept': 'application/json' },
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
                    this.serverHealthCache = { isHealthy: false, timestamp: Date.now(), modelName };
                    throw new Error(`Ollama server responded with status code ${tagsResponse.status}`);
                }
                
                // If no model specified, we've confirmed server is running
                if (!modelName) {
                    if (this.apiChannel) {
                        this.apiChannel.appendLine(`Server is healthy (no specific model check requested)`);
                    }
                    
                    this.serverHealthCache = { isHealthy: true, timestamp: Date.now() };
                    return true;
                }
                
                // Check if the requested model exists
                if (!tagsResponse.data || !tagsResponse.data.models) {
                    throw new Error('Invalid response from Ollama API (missing models list)');
                }
                
                const models = tagsResponse.data.models;
                const modelExists = models.some((m: OllamaModel) => m.name === modelName);
                
                // Update model list cache
                this.modelListCache = { models, timestamp: Date.now() };
                
                // Update server health cache
                this.serverHealthCache = { isHealthy: true, timestamp: Date.now(), modelName };
                
                if (this.apiChannel) {
                    if (modelExists) {
                        this.apiChannel.appendLine(`Server is healthy and model '${modelName}' is available`);
                    } else {
                        this.apiChannel.appendLine(`Model '${modelName}' not found on server.`);
                    }
                }
                
                // For model check, we return true even if model doesn't exist
                // We'll handle missing model case separately in the caller
                return true;
                
            } catch (error) {
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
                
                // Update cache with failure
                this.serverHealthCache = { isHealthy: false, timestamp: Date.now(), modelName };
                throw error;
            }
        }
        
        return false;
    }
    
    private async startOllamaProcess(): Promise<boolean> {
        try {
            const platform = os.platform();
            console.log(`🚀 Auto-starting Ollama on ${platform}`);
            
            if (this.serviceChannel) {
                this.serviceChannel.appendLine(`\n🚀 AUTO-STARTING OLLAMA SERVER on ${platform}`);
                this.serviceChannel.show(true);
            }
            
            let ollamaProcess: child_process.ChildProcess | null = null;
            
            if (platform === 'win32') {
                const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                console.log(`Starting Ollama from: ${ollamaPath}`);
                
                if (this.serviceChannel) {
                    this.serviceChannel.appendLine(`Starting Ollama from: ${ollamaPath}`);
                    this.serviceChannel.appendLine(`Command: ${ollamaPath} serve`);
                }
                
                ollamaProcess = child_process.spawn(ollamaPath, ['serve'], {
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true
                });
            } else {
                console.log('Starting Ollama using "ollama serve"');
                
                if (this.serviceChannel) {
                    this.serviceChannel.appendLine(`Starting Ollama using terminal command: ollama serve`);
                }
                
                ollamaProcess = child_process.spawn('ollama', ['serve'], {
                    detached: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });
            }
            
            // Unref process to allow VS Code to exit even if Ollama is still running
            ollamaProcess.unref();
            
            // Setup output listeners
            if (ollamaProcess.stdout) {
                ollamaProcess.stdout.on('data', (data) => {
                    const output = data.toString().trim();
                    console.log(`Ollama output: ${output}`);
                    if (this.serviceChannel) {
                        this.serviceChannel.appendLine(`[STDOUT] ${output}`);
                    }
                });
            }
            
            if (ollamaProcess.stderr) {
                ollamaProcess.stderr.on('data', (data) => {
                    const error = data.toString().trim();
                    console.error(`Ollama error: ${error}`);
                    if (this.serviceChannel) {
                        this.serviceChannel.appendLine(`[STDERR] ${error}`);
                    }
                });
            }
            
            // Log process events
            ollamaProcess.on('error', (err) => {
                console.error(`Failed to start Ollama process: ${err.message}`);
                if (this.serviceChannel) {
                    this.serviceChannel.appendLine(`❌ ERROR: Failed to start Ollama process: ${err.message}`);
                }
            });
            
            // Report to user that we're waiting for Ollama to start
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "🚀 Auto-Starting Ollama Server",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Waiting for Ollama server to start automatically..." });
                
                // Give Ollama some time to start - check multiple times with increasing wait
                let isRunning = false;
                const maxRetries = 5;
                
                for (let i = 0; i < maxRetries; i++) {
                    // Calculate wait time: 2s, 3s, 4s, 5s, 6s
                    const waitTime = 2000 + (i * 1000);
                    progress.report({ message: `Starting Ollama server (attempt ${i+1}/${maxRetries})...` });
                    
                    if (this.serviceChannel) {
                        this.serviceChannel.appendLine(`Waiting ${waitTime/1000}s before checking server status (attempt ${i+1}/${maxRetries})...`);
                    }
                    
                    // Wait before checking
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    
                    // Check if it's running now
                    try {
                        if (this.serviceChannel) {
                            this.serviceChannel.appendLine(`Checking if server is running (attempt ${i+1})...`);
                        }
                        
                        const response = await axios.get(`${this.baseUrl}/api/tags`, { 
                            timeout: 3000,
                            validateStatus: null,
                            headers: { 'Accept': 'application/json' },
                            proxy: false
                        });
                        
                        if (response.status === 200) {
                            const successMsg = `Ollama server started successfully after ${i+1} ${i === 0 ? 'attempt' : 'attempts'}`;
                            console.log(successMsg);
                            if (this.serviceChannel) {
                                this.serviceChannel.appendLine(`✅ ${successMsg}`);
                            }
                            isRunning = true;
                            break;
                        } else {
                            const statusMsg = `Ollama server returned status ${response.status} on attempt ${i+1}`;
                            console.log(statusMsg);
                            if (this.serviceChannel) {
                                this.serviceChannel.appendLine(`⚠️ ${statusMsg}`);
                            }
                        }
                    } catch (e) {
                        const errorMsg = `Ollama server not ready on attempt ${i+1}: ${e instanceof Error ? e.message : String(e)}`;
                        console.log(errorMsg);
                        if (this.serviceChannel) {
                            this.serviceChannel.appendLine(`⚠️ ${errorMsg}`);
                        }
                    }
                }
                
                if (isRunning) {
                    const successMsg = `Ollama server has been automatically started and is now running`;
                    if (this.serviceChannel) {
                        this.serviceChannel.appendLine(`\n✅ SUCCESS: ${successMsg}`);
                    }
                    
                    vscode.window.showInformationMessage(
                        successMsg,
                        { modal: false },
                        'Run Model'
                    ).then(selection => {
                        if (selection === 'Run Model') {
                            vscode.commands.executeCommand('vscode-ollama.runModel');
                        }
                    });
                } else {
                    const warningMsg = `Failed to verify if Ollama server started automatically. It might need more time or there could be an issue.`;
                    if (this.serviceChannel) {
                        this.serviceChannel.appendLine(`\n⚠️ WARNING: ${warningMsg}`);
                    }
                    
                    vscode.window.showWarningMessage(
                        warningMsg,
                        'Check Installation',
                        'View Logs'
                    ).then(selection => {
                        if (selection === 'Check Installation') {
                            vscode.commands.executeCommand('vscode-ollama.checkInstallation');
                        } else if (selection === 'View Logs') {
                            this.serviceChannel?.show(true);
                        }
                    });
                }
                
                return isRunning;
            });
            
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
                    { label: 'deepseek-coder-v2:latest', description: 'DeepSeek Coder V2 - Optimized for code tasks (4.2GB)' },
                    { label: 'gemma:7b', description: 'Google Gemma 7B model - 4.8GB' },
                    { label: 'llama3:8b', description: 'Meta Llama 3 8B model - 4.7GB' },
                    { label: 'mistral:7b', description: 'Mistral 7B model - 4.1GB' },
                    { label: 'phi3:mini', description: 'Microsoft Phi-3 mini - 1.7GB' }
                ];
                
                // Set deepseek-coder as the default selection
                const defaultModel = recommendedModels[0];
                this.serviceChannel.appendLine(`Suggesting models with default: ${defaultModel.label}`);
                
                const selectedModel = await vscode.window.showQuickPick(recommendedModels, {
                    placeHolder: 'Select a model to install (will download several GB)',
                    ignoreFocusOut: true
                });
                
                const modelToInstall = selectedModel || defaultModel;
                
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading ${modelToInstall.label} model...`,
                    cancellable: false
                }, async (progress) => {
                    try {
                        progress.report({ message: 'Downloading and installing model...' });
                        await this.pullModel(modelToInstall.label);
                        vscode.window.showInformationMessage(`Successfully installed ${modelToInstall.label} model!`);
                        
                        // Set as default model in settings
                        await vscode.workspace.getConfiguration('ollama').update('defaultModel', modelToInstall.label, true);
                        this.serviceChannel.appendLine(`Set default model to: ${modelToInstall.label}`);
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to install model: ${error instanceof Error ? error.message : String(error)}`);
                    }
                });
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
            
            token.onCancellationRequested(() => {
                cancelRequested = true;
                vscode.window.showInformationMessage(`Download of ${modelName} was cancelled`);
                if (progressResolver) progressResolver();
            });
            
            return progressPromise;
        });
        
        try {
            // Use the Ollama API to pull the model
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1800000); // 30-minute timeout
            
            // Track download stats
            const startTime = Date.now();
            let lastReportTime = startTime;
            let lastBytes = 0;
            // Used for speed calculations
            let downloadSpeed = 0;
            let estimatedTimeRemaining = '';
            
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
                    console.log(`Model download progress: ${text.length > 100 ? text.substring(0, 100) + '...' : text}`);
                    
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
            
            // Resolve the progress
            if (progressResolver) progressResolver();
            
        } catch (error) {
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
            return this.modelListCache.models;
        }
    
        // Cache miss or expired, check if Ollama is installed and running
        const isInstalled = await this.checkOllamaInstalled();
        if (!isInstalled) {
            return [];
        }
        
        // Use retry pattern for better resilience
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
                    timeout: 8000,
                    validateStatus: null,
                    headers: { 'Cache-Control': 'no-cache', 'Accept': 'application/json' },
                    proxy: false
                });
                
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
                this.modelListCache = { models, timestamp: Date.now() };
                
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
                
        // If all retries failed, show a helpful error message
        console.error('Ollama API error:', lastError);
        
        vscode.window.showErrorMessage(
            `Failed to list Ollama models. Please check if Ollama is running.`, 
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

    async generateCompletion(model: string, prompt: string): Promise<string> {
        console.log(`Generating completion with model: ${model}, prompt length: ${prompt.length} chars`);
        
        try {
            // Check if Ollama is running
            try {
                await this.checkServerHealth(model);
            } catch (checkError) {
                if (this.apiChannel) {
                    this.apiChannel.appendLine(`Server health check failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
                    this.apiChannel.appendLine('Attempting to start or restart Ollama service...');
                }
                
                await this.startOllamaProcess();
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            console.log(`Sending request to: ${this.baseUrl}/api/generate (non-streaming)`);
            const response = await axios.post(`${this.baseUrl}/api/generate`, 
                {
                    model,
                    prompt,
                    stream: false
                }, 
                {
                    timeout: 30000,
                    validateStatus: status => status === 200,
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
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
            let errorMessage = '';
            if (axios.isAxiosError(error)) {
                errorMessage = `Network error: ${error.message}`;
                
                if (error.response) {
                    console.error('Response error data:', error.response.data);
                    errorMessage += ` (Status: ${error.response.status})`;
                    
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
        // Get configuration with defaults
        const maxTokens = options?.maxTokens || 
            vscode.workspace.getConfiguration('ollama').get('maxResponseTokens') as number || 
            4096;
            
        const temperature = options?.temperature || 
            vscode.workspace.getConfiguration('ollama').get('temperature') as number || 
            0.7;
            
        const timeoutSeconds = options?.timeoutSeconds || 
            vscode.workspace.getConfiguration('ollama').get('requestTimeout') as number || 
            90;
        
        // Stream state management
        const abortController = new AbortController();
        
        try {
            // Initial thinking message
            onChunk(`_Thinking..._`);
            
            // Quick check if model is available
            await this.checkServerHealth(model);
            
            // Truncate prompt to prevent issues
            const truncatedPrompt = this.truncatePrompt(prompt);
            
            // Configure request parameters
            const requestParams = {
                model,
                prompt: truncatedPrompt,
                stream: true,
                options: {
                    num_predict: Math.min(maxTokens, 4096),
                    temperature: temperature,
                    top_k: 40,
                    top_p: 0.9,
                    repeat_penalty: 1.1
                }
            };
            
            // Make API request with abort controller
            const response = await axios.post(
                `${this.baseUrl}/api/generate`, 
                requestParams, 
                {
                    responseType: 'stream',
                    timeout: 30000, // 30s initial connection timeout
                    signal: abortController.signal,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    proxy: false
                }
            );
            
            // Clear the initial thinking message
            onChunk('');
            
            // Process the stream response
            if (response.data) {
                // Handle stream errors
                response.data.on('error', (err: Error) => {
                    console.error('Stream error:', err);
                    onChunk(`\n\n_Error in stream: ${err.message}_`);
                });
                
                // Define handler for each chunk
                const processChunk = (chunk: Buffer) => {
                    try {
                        const text = chunk.toString();
                        const lines = text.split('\n').filter(Boolean);
                        
                        for (const line of lines) {
                            try {
                                const data = JSON.parse(line);
                                
                                // Only send content if available
                                if (data.response) {
                                    onChunk(data.response);
                                }
                            } catch (parseError) {
                                // Log but continue processing
                                console.warn('JSON parse error in chunk, continuing');
                            }
                        }
                    } catch (error) {
                        console.error('Chunk processing error:', error);
                    }
                };
                
                // Set up data handler
                response.data.on('data', processChunk);
                
                // Wait for stream completion
                await new Promise<void>((resolve, reject) => {
                    // Set up warning for approaching timeout
                    const warningTimeout = setTimeout(() => {
                        console.log('Timeout warning');
                        onChunk(`\n\n_Note: Response is approaching the maximum allowed length. If cut off, try increasing the timeout in settings._`);
                    }, Math.min(960000, timeoutSeconds * 1000 * 0.8)); // Warning at 80% of timeout (16 minutes for 20 minute max)
                    
                    // Set up hard timeout
                    const hardTimeout = setTimeout(() => {
                        console.log('Hard timeout reached');
                        onChunk(`\n\n_Maximum streaming time exceeded. The model may be generating too much content. You can increase the timeout in settings (File > Preferences > Settings > Extensions > Ollama)._`);
                        resolve();
                    }, Math.min(1200000, timeoutSeconds * 1000)); // Increased to 1200s (20 minutes)
                    
                    // Set up event handlers
                    response.data.on('end', () => {
                        clearTimeout(warningTimeout);
                        clearTimeout(hardTimeout);
                        resolve();
                    });
                    
                    response.data.on('error', (err: Error) => {
                        clearTimeout(warningTimeout);
                        clearTimeout(hardTimeout);
                        reject(err);
                    });
                });
            }
        } catch (error) {
            const errorMessage = this.formatStreamingError(error, timeoutSeconds);
            
            console.error('Ollama streaming error:', errorMessage);
            if (this.apiChannel) {
                this.apiChannel.appendLine(`Streaming error: ${errorMessage}`);
            }
            
            onChunk(`\n\n_Error: ${errorMessage}_`);
            throw error;
        }
    }
    
    // Helper methods
    
    private truncatePrompt(prompt: string): string {
        const MAX_PROMPT_LENGTH = 8000;
        
        if (prompt.length > MAX_PROMPT_LENGTH) {
            return prompt.substring(0, MAX_PROMPT_LENGTH) + 
                `\n\n... [content truncated to ${MAX_PROMPT_LENGTH} characters for performance] ...`;
        }
        return prompt;
    }
    
    private formatStreamingError(error: unknown, timeoutSeconds: number): string {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            
            if (axiosError.code === 'ECONNABORTED') {
                return `Request timed out after ${timeoutSeconds}s. The model might be busy or the server overloaded.`;
            } else if (axiosError.code === 'ECONNREFUSED') {
                return `Connection refused. Make sure Ollama server is running.`;
            } else if (axiosError.code === 'ERR_CANCELED') {
                return `Request was canceled.`;
            } else if (axiosError.response) {
                return `Server error (Status: ${axiosError.response.status}). Try using a different model.`;
            } else if (axiosError.request) {
                return `No response from server. Check your network connection.`;
            } else {
                return `Network error: ${axiosError.message}`;
            }
        } else if (error instanceof Error) {
            return error.message;
        } else {
            return `Unknown error: ${String(error)}`;
        }
    }
}