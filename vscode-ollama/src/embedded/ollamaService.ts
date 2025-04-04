import axios from 'axios';
// Import Axios for API calls
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

    constructor() {
        // Default to localhost:11434 but allow configuration
        this.baseUrl = vscode.workspace.getConfiguration('ollama').get('apiUrl') as string || 'http://localhost:11434';
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
        if (this.isInstalled !== null) {
            return this.isInstalled;
        }

        try {
            // Make a basic request to the Ollama API to see if it's running
            await axios.get(`${this.baseUrl}/api/tags`, { timeout: 2000 });
            this.isInstalled = true;
            return true;
        } catch (error) {
            // Try to check if the Ollama binary exists
            try {
                const platform = os.platform();
                
                if (platform === 'win32') {
                    // Check Program Files for Ollama
                    const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                    this.isInstalled = fs.existsSync(ollamaPath);
                    
                    if (this.isInstalled) {
                        // Ollama is installed but not running
                        await this.startOllamaProcess();
                        return true;
                    }
                } else {
                    // For macOS and Linux, check if ollama is in the PATH
                    try {
                        child_process.execSync('ollama --version', { stdio: 'ignore' });
                        this.isInstalled = true;
                        
                        // Ollama is installed but not running
                        await this.startOllamaProcess();
                        return true;
                    } catch (e) {
                        this.isInstalled = false;
                    }
                }
            } catch (e) {
                this.isInstalled = false;
            }
            
            // If we couldn't connect or find the binary, show installation instructions
            const instructions = this.getInstallInstructions();
            
            const action = await vscode.window.showErrorMessage(
                'Ollama is not installed or not running. Please install Ollama to use this extension.',
                { modal: true },
                instructions.title
            );
            
            if (action === instructions.title) {
                vscode.env.openExternal(vscode.Uri.parse(instructions.url));
            }
            
            return false;
        }
    }

    private async startOllamaProcess(): Promise<boolean> {
        try {
            const platform = os.platform();
            
            if (platform === 'win32') {
                // Start Ollama on Windows
                const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                child_process.spawn(ollamaPath, ['serve'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            } else {
                // Start Ollama on macOS or Linux
                child_process.spawn('ollama', ['serve'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
            }
            
            // Give Ollama a moment to start
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Check if it's running now
            try {
                await axios.get(`${this.baseUrl}/api/tags`, { timeout: 2000 });
                return true;
            } catch (e) {
                return false;
            }
        } catch (e) {
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
            const startTime = Date.now();
            let lastReportTime = startTime;
            let lastBytes = 0;
            // Used for calculating download speed
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
        // First check if Ollama is installed and running
        const isInstalled = await this.checkOllamaInstalled();
        if (!isInstalled) {
            return [];
        }
        
        try {
            console.log(`Attempting to fetch models from: ${this.baseUrl}/api/tags`);
            const response = await axios.get(`${this.baseUrl}/api/tags`, {
                timeout: 5000, // 5 second timeout
                validateStatus: null // Allow any status code to be returned for better error handling
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
            
            // Check if models need to be installed
            await this.checkAndSuggestModels(models);
            
            return models;
        } catch (error) {
            // Enhanced error reporting
            let errorMessage = '';
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
    }

    async generateCompletion(model: string, prompt: string): Promise<string> {
        console.log(`Generating completion with model: ${model}, prompt length: ${prompt.length} chars`);
        
        try {
            // Check if Ollama is running first
            try {
                await axios.get(`${this.baseUrl}/api/tags`, { timeout: 2000 });
            } catch (checkError) {
                // If Ollama is not running, try to start it
                console.log("Ollama API check failed, attempting to start Ollama service");
                await this.startOllamaProcess();
                
                // Brief delay to allow Ollama to start
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log(`Sending request to: ${this.baseUrl}/api/generate (non-streaming)`);
            const response = await axios.post(`${this.baseUrl}/api/generate`, 
                {
                    model,
                    prompt,
                    stream: false
                }, 
                {
                    timeout: 60000, // 60 second timeout
                    validateStatus: status => status === 200 // Only accept 200 status
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
                        
                        // Common causes of 500 errors
                        const errorBody = error.response.data ? JSON.stringify(error.response.data) : '';
                        if (errorBody.includes('no models')) {
                            errorMessage += " No models found. Please install a model first.";
                        } else if (errorBody.includes('not found')) {
                            errorMessage += ` The model '${model}' was not found. Please install it first.`;
                        } else if (errorBody.includes('out of memory') || errorBody.includes('OOM')) {
                            errorMessage += " Ollama ran out of memory. Try using a smaller model.";
                        } else {
                            // Add some general troubleshooting advice
                            errorMessage += " Try restarting Ollama or checking if another process is using the model.";
                        }
                    }
                } else if (error.request) {
                    errorMessage += ` (No response received)`;
                }
            } else {
                errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
            }
            
            console.error('Ollama API generation error:', errorMessage);
            
            // Show a more helpful error message with action buttons
            vscode.window.showErrorMessage(
                `Failed to generate completion: ${errorMessage}`, 
                'Retry',
                'Get Help'
            ).then(selection => {
                if (selection === 'Retry') {
                    return this.generateCompletion(model, prompt);
                } else if (selection === 'Get Help') {
                    // Open a new terminal with troubleshooting commands
                    const terminal = vscode.window.createTerminal('Ollama Troubleshooting');
                    terminal.show();
                    terminal.sendText('# Check Ollama version');
                    terminal.sendText('ollama --version');
                    terminal.sendText('# List available models');
                    terminal.sendText('ollama list');
                    terminal.sendText('# Check if Ollama is running');
                    terminal.sendText('ps aux | grep ollama');
                    terminal.sendText('# You might need to restart Ollama with:');
                    terminal.sendText('# ollama serve');
                }
            });
            
            throw error;
        }
    }

    async streamCompletion(model: string, prompt: string, onChunk: (text: string) => void): Promise<void> {
        console.log(`Streaming completion with model: ${model}, prompt length: ${prompt.length} chars`);
        
        // Get max tokens from settings, default to 4096
        const maxTokens = vscode.workspace.getConfiguration('ollama').get('maxResponseTokens') as number || 4096;
        
        // Initialize token tracking
        let tokenCount = 0;
        const streamStartTime = Date.now();
        let lastProgressTime = streamStartTime;
        
        try {
            // First, check if Ollama is running
            try {
                await axios.get(`${this.baseUrl}/api/tags`, { timeout: 2000 });
            } catch (checkError) {
                // If Ollama is not running, try to start it
                console.log("Ollama API check failed, attempting to start Ollama service");
                await this.startOllamaProcess();
                
                // Brief delay to allow Ollama to start
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Let the user know we're working
            onChunk(`_Thinking..._`);
            
            console.log(`Sending request to: ${this.baseUrl}/api/generate`);
            
            // Prepare the API request parameters
            const requestParams = {
                model,
                prompt,
                stream: true,
                options: {
                    num_predict: maxTokens,                  // Maximum tokens to generate
                    temperature: 0.7,                        // Default temperature
                    top_k: 40,                               // Default top_k
                    top_p: 0.9,                              // Default top_p
                    repeat_penalty: 1.1                      // Slight penalty for repetition
                }
            };
            
            // Create a local AbortController to handle timeouts and cancellation
            const controller = new AbortController();
            
            // Set a timeout for the initial response (15 seconds)
            const initialTimeoutId = setTimeout(() => {
                onChunk(`\n\n_Still thinking..._`);
            }, 5000);
            
            // Set a timeout for the overall request (20 minutes)
            const requestTimeoutId = setTimeout(() => {
                controller.abort();
                console.log("Request timed out after 20 minutes");
            }, 1200000); // Increased to 20 minutes
            
            const response = await axios.post(
                `${this.baseUrl}/api/generate`, 
                requestParams, 
                {
                    responseType: 'stream',
                    signal: controller.signal,
                    timeout: 1200000, // 20-minute timeout as backup
                    maxContentLength: Infinity,
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );
            
            // Clear the initial timeout since we've received a response
            clearTimeout(initialTimeoutId);
            
            console.log('Stream request successful, setting up data handling');
            
            // Clear the initial "thinking" message since we're about to get real content
            onChunk('');
            
            // For debugging - add an error event handler to the response data stream
            if (response.data) {
                response.data.on('error', (err: Error) => {
                    console.error('Stream error:', err);
                    clearTimeout(requestTimeoutId);
                    onChunk(`\n\nError in stream: ${err.message}`);
                });
            }

            let streamEnded = false;
            let noActivityTimeout: NodeJS.Timeout | null = null;
            
            // Set up timeout monitoring for stream inactivity
            const resetActivityTimeout = () => {
                // Update last activity timestamp
                
                if (noActivityTimeout) {
                    clearTimeout(noActivityTimeout);
                }
                
                // If no activity for 60 seconds, consider it stuck
                noActivityTimeout = setTimeout(() => {
                    console.warn("No activity on stream for 60 seconds, considering it stuck");
                    if (!streamEnded) {
                        onChunk("\n\n_Stream appears to be stuck. The model may have encountered an issue._");
                        endStream();
                    }
                }, 60000); // Increased from 30 to 60 seconds
            };
            
            const endStream = () => {
                if (!streamEnded) {
                    streamEnded = true;
                    
                    // Clean up all timeouts
                    clearTimeout(requestTimeoutId);
                    if (noActivityTimeout) {
                        clearTimeout(noActivityTimeout);
                    }
                    
                    // Report performance metrics
                    const totalTime = (Date.now() - streamStartTime) / 1000;
                    console.log(`Stream completed. ${tokenCount} tokens in ${totalTime.toFixed(1)}s (${(tokenCount/totalTime).toFixed(1)} tokens/sec)`);
                }
            };
            
            // Start the activity monitoring
            resetActivityTimeout();

            response.data.on('data', (chunk: Buffer) => {
                try {
                    // Reset activity timeout since we received data
                    resetActivityTimeout();
                    
                    const text = chunk.toString();
                    console.log(`Received chunk: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
                    
                    const lines = text.split('\n').filter(Boolean);
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            
                            // Extract and send the response text if present
                            if (data.response) {
                                tokenCount++; // Rough token count (one per chunk)
                                onChunk(data.response);
                                
                                // Update progress stats every 2 seconds
                                const now = Date.now();
                                if (now - lastProgressTime > 2000) {
                                    const elapsedSec = (now - streamStartTime) / 1000;
                                    const tokensPerSec = tokenCount / elapsedSec;
                                    console.log(`Generation stats: ${tokenCount} tokens, ${elapsedSec.toFixed(1)}s elapsed, ${tokensPerSec.toFixed(1)} tokens/sec`);
                                    lastProgressTime = now;
                                }
                            }
                            
                            // Track statistics if provided
                            if (data.total_duration) {
                                console.log(`Generation metrics: ${data.total_duration}ms total, eval rate: ${data.eval_count / (data.eval_duration / 1000)} tokens/sec`);
                            }
                            
                            // Check for completion
                            if (data.done === true) {
                                endStream();
                            }
                        } catch (parseError) {
                            console.error('Error parsing JSON in stream chunk:', parseError);
                            console.error('Problematic line:', line);
                        }
                    }
                } catch (e) {
                    console.error('Error processing stream chunk:', e);
                }
            });

            response.data.on('end', () => {
                endStream();
            });

        } catch (error) {
            // Enhanced error handling with fallback options
            let errorMessage = '';
            let errorType = '';
            
            if (axios.isAxiosError(error)) {
                errorMessage = `Network error: ${error.message}`;
                
                if (error.code === 'ERR_CANCELED') {
                    errorType = 'timeout';
                    errorMessage = 'Request timed out. The model may be busy or overloaded.';
                } else if (error.code === 'ECONNABORTED') {
                    errorType = 'timeout';
                    errorMessage = 'Connection timed out. The Ollama server might be busy.';
                } else if (error.response) {
                    console.error('Response error data:', error.response.data);
                    errorMessage += ` (Status: ${error.response.status})`;
                    
                    if (error.response.status === 404) {
                        errorType = 'model_missing';
                        errorMessage = `Model '${model}' was not found. It may need to be installed.`;
                    } else if (error.response.status === 500) {
                        errorType = 'server_error';
                        
                        // Try to extract more specific error info from response
                        let errorDetail = '';
                        try {
                            if (error.response.data && typeof error.response.data === 'string') {
                                // For stream responses, data might be a string
                                if (error.response.data.includes('out of memory') || error.response.data.includes('OOM')) {
                                    errorDetail = 'The model ran out of memory.';
                                    errorType = 'out_of_memory';
                                } else if (error.response.data.includes('not found') || error.response.data.includes('no models')) {
                                    errorDetail = `Model '${model}' was not found.`;
                                    errorType = 'model_missing';
                                }
                            } else {
                                // For binary data, try to read as string
                                const dataStr = typeof error.response.data === 'string' 
                                    ? error.response.data 
                                    : JSON.stringify(error.response.data);
                                if (dataStr.includes('out of memory') || dataStr.includes('OOM')) {
                                    errorDetail = 'The model ran out of memory.';
                                    errorType = 'out_of_memory';
                                } else if (dataStr.includes('not found') || dataStr.includes('no models')) {
                                    errorDetail = `Model '${model}' was not found.`;
                                    errorType = 'model_missing';
                                }
                            }
                        } catch (e) {
                            console.error('Error parsing error response:', e);
                        }
                        
                        errorMessage = `Server error: ${errorDetail || 'The Ollama server encountered an internal error.'}`;
                    }
                } else if (error.request) {
                    errorType = 'no_response';
                    errorMessage = 'No response received from Ollama server. It might be offline.';
                }
                console.error('Axios error details:', error.toJSON());
            } else {
                errorMessage = `Error: ${error instanceof Error ? error.message : String(error)}`;
                errorType = 'unknown';
            }
            
            console.error('Ollama API streaming error:', errorMessage);
            
            // Different actions based on error type
            if (errorType === 'model_missing') {
                // Offer to install the missing model
                vscode.window.showErrorMessage(
                    `Model '${model}' was not found. Would you like to install it?`,
                    'Install Model',
                    'Try Another Model',
                    'Cancel'
                ).then(selection => {
                    if (selection === 'Install Model') {
                        onChunk(`\n\n_Installing model ${model}..._`);
                        this.pullModel(model)
                            .then(() => {
                                onChunk(`\n\n_Model '${model}' installed. Retrying..._`);
                                // Retry the request with the newly installed model
                                setTimeout(() => {
                                    this.streamCompletion(model, prompt, onChunk);
                                }, 2000);
                            })
                            .catch(installError => {
                                onChunk(`\n\n_Failed to install model: ${installError.message}_`);
                            });
                    } else if (selection === 'Try Another Model') {
                        vscode.commands.executeCommand('vscode-ollama.listModels');
                    }
                });
            } else if (errorType === 'out_of_memory') {
                // Suggest using a smaller model
                vscode.window.showErrorMessage(
                    `The model ran out of memory. Would you like to try a smaller model?`,
                    'List Smaller Models',
                    'Try Non-streaming',
                    'Cancel'
                ).then(selection => {
                    if (selection === 'List Smaller Models') {
                        vscode.commands.executeCommand('vscode-ollama.listModels');
                    } else if (selection === 'Try Non-streaming') {
                        onChunk(`\n\n_Retrying with non-streaming mode..._`);
                        this.generateCompletion(model, prompt)
                            .then(response => {
                                onChunk(`\n\n${response}`);
                            })
                            .catch(fallbackError => {
                                onChunk(`\n\n_Error in fallback method: ${fallbackError.message}_`);
                            });
                    }
                });
            } else {
                // Generic error, offer retry or fallback
                vscode.window.showErrorMessage(
                    `Failed to generate completion: ${errorMessage}`, 
                    'Retry',
                    'Try Non-streaming',
                    'Check Ollama'
                ).then(selection => {
                    if (selection === 'Retry') {
                        onChunk(`\n\n_Retrying..._`);
                        return this.streamCompletion(model, prompt, onChunk);
                    } else if (selection === 'Try Non-streaming') {
                        // Fall back to non-streaming mode
                        onChunk(`\n\n_Falling back to non-streaming mode..._`);
                        this.generateCompletion(model, prompt)
                            .then(response => {
                                onChunk(`\n\n${response}`);
                            })
                            .catch(fallbackError => {
                                onChunk(`\n\n_Error in fallback method: ${fallbackError.message}_`);
                            });
                    } else if (selection === 'Check Ollama') {
                        // Open a terminal with diagnostic commands
                        const terminal = vscode.window.createTerminal('Ollama Diagnostics');
                        terminal.show();
                        terminal.sendText('# Check Ollama version');
                        terminal.sendText('ollama --version');
                        terminal.sendText('# List available models');
                        terminal.sendText('ollama list');
                        terminal.sendText('# Check if Ollama is running');
                        terminal.sendText('ps aux | grep ollama');
                        terminal.sendText('# You might need to restart Ollama with:');
                        terminal.sendText('# ollama serve');
                    }
                });
            }
            
            onChunk(`\n\n_Error: ${errorMessage}_`);
            throw error;
        }
    }
}