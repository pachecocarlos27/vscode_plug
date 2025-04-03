import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';
import axios from 'axios';
import { spawn } from 'child_process';

export interface EmbeddedModel {
    name: string;
    displayName: string;
    description: string;
    size: string; // e.g. "1.7GB"
    parameters: number; // e.g. 3000000000 (3B)
    capabilities: string[]; // e.g. ["code", "chat", "math"]
    isInstalled: boolean;
}

export class EmbeddedOllamaService {
    private extensionPath: string;
    private ollamaExecutablePath: string | null = null;
    private modelsPath: string;
    private isRunning = false;
    private ollamaProcess: child_process.ChildProcess | null = null;
    private serviceChannel: vscode.OutputChannel;
    private apiPort = 9527; // Use a different port from the standard Ollama
    private readonly apiBaseUrl: string;
    
    private embeddedModels: EmbeddedModel[] = [
        {
            name: "deepseek-coder-v2:latest",
            displayName: "DeepSeek Coder v2",
            description: "DeepSeek Coder v2 - Optimized for code tasks with excellent performance",
            size: "4.2GB",
            parameters: 7000000000,
            capabilities: ["code", "chat", "reasoning", "documentation"],
            isInstalled: true // Pre-installed by default
        },
        {
            name: "phi3:mini",
            displayName: "Phi-3 Mini",
            description: "Microsoft's Phi-3 Mini (3.8B parameters), small but capable for coding tasks",
            size: "1.7GB",
            parameters: 3800000000,
            capabilities: ["code", "chat", "reasoning"],
            isInstalled: false
        },
        {
            name: "tinyllama:1.1b",
            displayName: "TinyLLama",
            description: "Small 1.1B parameter model for basic tasks",
            size: "600MB", 
            parameters: 1100000000,
            capabilities: ["chat", "basic-reasoning"],
            isInstalled: false
        }
    ];
    
    constructor(extensionPath: string, serviceChannel: vscode.OutputChannel) {
        this.extensionPath = extensionPath;
        this.serviceChannel = serviceChannel;
        
        // Get port from configuration with fallback
        try {
            this.apiPort = vscode.workspace.getConfiguration('ollamaEnhanced').get('embeddedPort') as number || 9527;
        } catch (error) {
            this.serviceChannel.appendLine(`Error getting port from config, using default: ${error}`);
        }
        
        // Use user home directory for models to ensure write permissions
        this.modelsPath = path.join(os.homedir(), '.vscode-ollama', 'models');
        this.apiBaseUrl = `http://localhost:${this.apiPort}`;
        
        // Ensure the models directory exists
        if (!fs.existsSync(this.modelsPath)) {
            fs.mkdirSync(this.modelsPath, { recursive: true });
        }
        
        this.logSystemInfo();
        this.setupOllamaExecutable();
    }

    private logSystemInfo(): void {
        try {
            const platformInfo = {
                platform: os.platform(),
                release: os.release(),
                arch: os.arch(),
                cpus: os.cpus().length,
                memory: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))} GB`,
                extensionPath: this.extensionPath,
                modelsPath: this.modelsPath
            };
            
            this.serviceChannel.appendLine('Embedded Ollama - System Information:');
            Object.entries(platformInfo).forEach(([key, value]) => {
                this.serviceChannel.appendLine(`  ${key}: ${value}`);
            });
            
        } catch (error) {
            this.serviceChannel.appendLine(`Error logging system info: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    private async setupOllamaExecutable(): Promise<void> {
        try {
            const platform = os.platform();
            const arch = os.arch();
            
            // Define embedded binary path based on platform
            const binDir = path.join(this.extensionPath, 'bin');
            if (!fs.existsSync(binDir)) {
                fs.mkdirSync(binDir, { recursive: true });
            }
            
            // Define platform-specific paths
            if (platform === 'win32') {
                this.ollamaExecutablePath = path.join(binDir, 'ollama.exe');
            } else if (platform === 'darwin') {
                this.ollamaExecutablePath = path.join(binDir, 'ollama');
            } else if (platform === 'linux') {
                this.ollamaExecutablePath = path.join(binDir, 'ollama');
            } else {
                throw new Error(`Unsupported platform: ${platform}`);
            }
            
            // Check if the executable exists and extract if needed
            if (!fs.existsSync(this.ollamaExecutablePath)) {
                this.serviceChannel.appendLine(`Ollama executable not found at ${this.ollamaExecutablePath}. Extracting bundled binary.`);
                
                // Extract the bundled binary based on platform and architecture
                await this.extractBundledBinary(platform, arch, binDir);
            }
            
            // Ensure executable permissions on Unix-like systems
            if (platform !== 'win32') {
                try {
                    fs.chmodSync(this.ollamaExecutablePath, 0o755);
                    this.serviceChannel.appendLine(`Set executable permissions for ${this.ollamaExecutablePath}`);
                } catch (error) {
                    this.serviceChannel.appendLine(`Failed to set executable permissions: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
            
            this.serviceChannel.appendLine(`Ollama executable found at ${this.ollamaExecutablePath}`);
        } catch (error) {
            this.serviceChannel.appendLine(`Error setting up Ollama executable: ${error instanceof Error ? error.message : String(error)}`);
            // Check if system Ollama is available as fallback
            const systemAvailable = await this.checkSystemOllama();
            if (!systemAvailable) {
                vscode.window.showErrorMessage(
                    'Could not set up embedded Ollama and no system installation was found.', 
                    'Download Ollama'
                ).then(selection => {
                    if (selection === 'Download Ollama') {
                        vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/download'));
                    }
                });
            }
        }
    }
    
    /**
     * Extract the bundled Ollama binary for the current platform
     */
    private async extractBundledBinary(platform: string, arch: string, targetDir: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                // Path to bundled binary in extension resources
                let sourcePath = '';
                let targetPath = '';
                
                // Select the correct bundled binary based on platform and architecture
                if (platform === 'win32') {
                    if (arch === 'x64') {
                        sourcePath = path.join(this.extensionPath, 'resources', 'binaries', 'win-x64', 'ollama.exe');
                        targetPath = path.join(targetDir, 'ollama.exe');
                    } else if (arch === 'arm64') {
                        sourcePath = path.join(this.extensionPath, 'resources', 'binaries', 'win-arm64', 'ollama.exe');
                        targetPath = path.join(targetDir, 'ollama.exe');
                    }
                } else if (platform === 'darwin') {
                    if (arch === 'x64') {
                        sourcePath = path.join(this.extensionPath, 'resources', 'binaries', 'darwin-x64', 'ollama');
                        targetPath = path.join(targetDir, 'ollama');
                    } else if (arch === 'arm64') {
                        sourcePath = path.join(this.extensionPath, 'resources', 'binaries', 'darwin-arm64', 'ollama');
                        targetPath = path.join(targetDir, 'ollama');
                    }
                } else if (platform === 'linux') {
                    if (arch === 'x64') {
                        sourcePath = path.join(this.extensionPath, 'resources', 'binaries', 'linux-x64', 'ollama');
                        targetPath = path.join(targetDir, 'ollama');
                    } else if (arch === 'arm64') {
                        sourcePath = path.join(this.extensionPath, 'resources', 'binaries', 'linux-arm64', 'ollama');
                        targetPath = path.join(targetDir, 'ollama');
                    }
                }
                
                // Ensure target directory exists
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                
                // Check if the source file exists
                if (!sourcePath || !fs.existsSync(sourcePath)) {
                    this.serviceChannel.appendLine(`Bundled binary not found for ${platform}-${arch}`);
                    
                    // If binary not found, download it from Ollama's site
                    return this.downloadOllamaBinary(platform, arch, targetPath)
                        .then(resolve)
                        .catch(reject);
                }
                
                // Make sure the target path is accessible
                try {
                    // Check if we have write permission by attempting to write to parent directory
                    const testFile = path.join(targetDir, '.write_test');
                    fs.writeFileSync(testFile, 'test');
                    fs.unlinkSync(testFile);
                } catch (permError) {
                    this.serviceChannel.appendLine(`Permission error: Cannot write to ${targetDir}. Using alternative location...`);
                    // Use a fallback location in user directory
                    const homeDir = os.homedir();
                    const altDir = path.join(homeDir, '.vscode-ollama', 'bin');
                    if (!fs.existsSync(altDir)) {
                        fs.mkdirSync(altDir, { recursive: true });
                    }
                    
                    targetPath = path.join(altDir, path.basename(targetPath));
                }
                
                // Copy the file to the target location
                this.serviceChannel.appendLine(`Extracting binary from ${sourcePath} to ${targetPath}`);
                fs.copyFileSync(sourcePath, targetPath);
                
                // Set executable permissions on Unix-like systems
                if (platform !== 'win32') {
                    try {
                        fs.chmodSync(targetPath, 0o755);
                    } catch (permError) {
                        this.serviceChannel.appendLine(`Warning: Could not set executable permissions: ${permError}`);
                    }
                }
                
                this.serviceChannel.appendLine(`Binary extracted successfully to ${targetPath}`);
                this.ollamaExecutablePath = targetPath; // Update the path
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    /**
     * Download Ollama binary from official source if not bundled
     */
    private async downloadOllamaBinary(platform: string, arch: string, targetPath: string): Promise<void> {
        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Downloading Ollama",
                cancellable: true
            },
            async (progress, token) => {
                try {
                    progress.report({ message: "Determining download URL..." });
                    
                    // Construct the appropriate download URL based on platform and architecture
                    let downloadUrl = '';
                    if (platform === 'win32') {
                        downloadUrl = 'https://ollama.com/download/ollama-windows-amd64.zip';
                    } else if (platform === 'darwin') {
                        if (arch === 'arm64') {
                            downloadUrl = 'https://ollama.com/download/ollama-darwin-arm64';
                        } else {
                            downloadUrl = 'https://ollama.com/download/ollama-darwin-amd64';
                        }
                    } else if (platform === 'linux') {
                        if (arch === 'arm64') {
                            downloadUrl = 'https://ollama.com/download/ollama-linux-arm64';
                        } else {
                            downloadUrl = 'https://ollama.com/download/ollama-linux-amd64';
                        }
                    }
                    
                    if (!downloadUrl) {
                        throw new Error(`No download URL available for ${platform}-${arch}`);
                    }
                    
                    progress.report({ message: `Downloading from ${downloadUrl}...` });
                    this.serviceChannel.appendLine(`Downloading Ollama from ${downloadUrl}`);
                    
                    // Set up temporary download location
                    const tempDir = path.join(os.tmpdir(), 'vscode-ollama-download');
                    if (!fs.existsSync(tempDir)) {
                        fs.mkdirSync(tempDir, { recursive: true });
                    }
                    
                    const tempFilePath = path.join(tempDir, path.basename(downloadUrl));
                    
                    // Create a child process to download the file
                    await new Promise<void>((resolve, reject) => {
                        let downloadProcess;
                        
                        if (platform === 'win32') {
                            // On Windows use PowerShell
                            const psCommand = `
                                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12;
                                Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${tempFilePath}'
                            `;
                            downloadProcess = spawn('powershell', ['-Command', psCommand]);
                        } else {
                            // On Unix systems use curl
                            downloadProcess = spawn('curl', ['-L', '-o', tempFilePath, downloadUrl]);
                        }
                        
                        downloadProcess.on('close', code => {
                            if (code === 0) {
                                resolve();
                            } else {
                                reject(new Error(`Download process exited with code ${code}`));
                            }
                        });
                        
                        downloadProcess.on('error', reject);
                        
                        token.onCancellationRequested(() => {
                            downloadProcess.kill();
                            reject(new Error('Download cancelled by user'));
                        });
                    });
                    
                    progress.report({ message: "Processing download..." });
                    
                    // Extract or copy the binary to the target path
                    if (platform === 'win32' && path.extname(tempFilePath) === '.zip') {
                        // For Windows, extract from ZIP
                        const extractDir = path.join(tempDir, 'extracted');
                        if (!fs.existsSync(extractDir)) {
                            fs.mkdirSync(extractDir, { recursive: true });
                        }
                        
                        await new Promise<void>((resolve, reject) => {
                            const extractProcess = spawn('powershell', [
                                '-Command',
                                `Expand-Archive -Path '${tempFilePath}' -DestinationPath '${extractDir}' -Force`
                            ]);
                            
                            extractProcess.on('close', code => {
                                if (code === 0) {
                                    resolve();
                                } else {
                                    reject(new Error(`Extract process exited with code ${code}`));
                                }
                            });
                            
                            extractProcess.on('error', reject);
                        });
                        
                        // Find and copy the executable
                        const exePath = path.join(extractDir, 'ollama.exe');
                        if (fs.existsSync(exePath)) {
                            fs.copyFileSync(exePath, targetPath);
                        } else {
                            throw new Error('Could not find ollama.exe in extracted files');
                        }
                    } else {
                        // For Unix systems, just copy and make executable
                        fs.copyFileSync(tempFilePath, targetPath);
                        if (platform !== 'win32') {
                            fs.chmodSync(targetPath, 0o755);
                        }
                    }
                    
                    progress.report({ message: "Download complete" });
                    this.serviceChannel.appendLine(`Ollama binary downloaded and installed to ${targetPath}`);
                    
                    // Clean up temporary files
                    try {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    } catch (cleanupError) {
                        this.serviceChannel.appendLine(`Warning: Could not clean up temp directory: ${cleanupError}`);
                    }
                    
                } catch (error) {
                    this.serviceChannel.appendLine(`Download error: ${error instanceof Error ? error.message : String(error)}`);
                    throw error;
                }
            }
        );
    }
    
    private async checkSystemOllama(): Promise<boolean> {
        try {
            const platform = os.platform();
            this.serviceChannel.appendLine('Checking for system Ollama installation...');
            
            if (platform === 'win32') {
                const ollamaPath = path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Ollama', 'ollama.exe');
                if (fs.existsSync(ollamaPath)) {
                    this.ollamaExecutablePath = ollamaPath;
                    this.serviceChannel.appendLine(`Found system Ollama at ${ollamaPath}`);
                    return true;
                }
            } else {
                // For macOS and Linux
                try {
                    const output = child_process.execSync('which ollama', { encoding: 'utf8' });
                    this.ollamaExecutablePath = output.trim();
                    this.serviceChannel.appendLine(`Found system Ollama at ${this.ollamaExecutablePath}`);
                    return true;
                } catch {
                    // Check common paths
                    const commonPaths = [
                        '/usr/local/bin/ollama',
                        '/usr/bin/ollama',
                        '/opt/ollama/ollama'
                    ];
                    
                    for (const path of commonPaths) {
                        if (fs.existsSync(path)) {
                            this.ollamaExecutablePath = path;
                            this.serviceChannel.appendLine(`Found system Ollama at ${path}`);
                            return true;
                        }
                    }
                }
            }
            
            this.serviceChannel.appendLine('No system Ollama installation found');
            return false;
        } catch (error) {
            this.serviceChannel.appendLine(`Error checking system Ollama: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    
    /**
     * Start the embedded Ollama server
     */
    public async startServer(): Promise<boolean> {
        if (this.isRunning && this.ollamaProcess && !this.ollamaProcess.killed) {
            this.serviceChannel.appendLine('Embedded Ollama server is already running');
            return true;
        }
        
        // Reset the running state in case the process died unexpectedly
        this.isRunning = false;
        
        if (!this.ollamaExecutablePath) {
            // Try to set up the executable first
            try {
                await this.setupOllamaExecutable();
            } catch (error) {
                this.serviceChannel.appendLine(`Error during executable setup: ${error}`);
            }
            
            if (!this.ollamaExecutablePath) {
                const errorMsg = 'No Ollama executable available. Cannot start server.';
                this.serviceChannel.appendLine(errorMsg);
                vscode.window.showErrorMessage(errorMsg);
                return false;
            }
        }
        
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Starting embedded Ollama server",
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: "Initializing..." });
                
                // First, check if there's already a server running on the port
                try {
                    const response = await axios.get(`${this.apiBaseUrl}/api/tags`, { 
                        timeout: 1000,
                        validateStatus: () => true
                    });
                    
                    if (response.status === 200) {
                        this.serviceChannel.appendLine('Server already running on specified port');
                        this.isRunning = true;
                        progress.report({ message: "Server already running!" });
                        return true;
                    }
                } catch (error) {
                    // Expected error if server is not running
                    this.serviceChannel.appendLine('No existing server detected, starting new instance');
                }
                
                // Create environment with custom model path
                const env = {
                    ...process.env,
                    OLLAMA_MODELS: this.modelsPath,
                    // Use custom port to avoid conflicts with system Ollama
                    OLLAMA_HOST: `127.0.0.1:${this.apiPort}`
                };
                
                this.serviceChannel.appendLine(`Starting Ollama with custom models path: ${this.modelsPath}`);
                this.serviceChannel.appendLine(`Using API port: ${this.apiPort}`);
                this.serviceChannel.appendLine(`Executable path: ${this.ollamaExecutablePath}`);
                
                // Check if the executable exists and is accessible
                if (!fs.existsSync(this.ollamaExecutablePath)) {
                    throw new Error(`Ollama executable not found at ${this.ollamaExecutablePath}`);
                }
                
                // On Windows, use different spawn options
                let spawnOptions = {};
                if (os.platform() === 'win32') {
                    spawnOptions = {
                        env,
                        detached: true,
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true,
                        shell: true
                    };
                } else {
                    spawnOptions = {
                        env,
                        detached: true,
                        stdio: ['ignore', 'pipe', 'pipe']
                    };
                }
                
                // Start Ollama in serve mode
                this.ollamaProcess = spawn(this.ollamaExecutablePath, ['serve'], spawnOptions);
                
                // Setup output handling
                if (this.ollamaProcess.stdout) {
                    this.ollamaProcess.stdout.on('data', (data) => {
                        const output = data.toString().trim();
                        this.serviceChannel.appendLine(`[Embedded Ollama] ${output}`);
                    });
                }
                
                if (this.ollamaProcess.stderr) {
                    this.ollamaProcess.stderr.on('data', (data) => {
                        const output = data.toString().trim();
                        this.serviceChannel.appendLine(`[Embedded Ollama ERROR] ${output}`);
                    });
                }
                
                // Handle process exit
                this.ollamaProcess.on('exit', (code) => {
                    this.isRunning = false;
                    this.serviceChannel.appendLine(`Embedded Ollama server exited with code ${code}`);
                });
                
                // Handle process error
                this.ollamaProcess.on('error', (err) => {
                    this.isRunning = false;
                    this.serviceChannel.appendLine(`Embedded Ollama server error: ${err.message}`);
                });
                
                // Wait for the server to start
                progress.report({ message: "Waiting for server to start..." });
                
                // Try to connect to the server to confirm it's running
                let attempts = 0;
                const maxAttempts = 15; // Increase attempts - Ollama can take a while to start
                let lastError = '';
                
                while (attempts < maxAttempts) {
                    try {
                        progress.report({ message: `Connecting (attempt ${attempts + 1}/${maxAttempts})...` });
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                        
                        const response = await axios.get(`${this.apiBaseUrl}/api/tags`, { 
                            timeout: 2000, // Increase timeout
                            validateStatus: () => true
                        });
                        
                        if (response.status === 200) {
                            this.isRunning = true;
                            this.serviceChannel.appendLine('Embedded Ollama server started successfully');
                            progress.report({ message: "Server started successfully!" });
                            return true;
                        } else {
                            lastError = `Server returned status ${response.status}`;
                        }
                    } catch (error) {
                        // Log but keep trying
                        lastError = error instanceof Error ? error.message : String(error);
                    }
                    attempts++;
                }
                
                // If we got here, server didn't start properly
                progress.report({ message: "Failed to connect to server" });
                this.serviceChannel.appendLine(`Failed to confirm Ollama server startup. Last error: ${lastError}`);
                
                // Attempt to kill the process
                if (this.ollamaProcess && !this.ollamaProcess.killed) {
                    if (os.platform() === 'win32') {
                        exec(`taskkill /pid ${this.ollamaProcess.pid} /T /F`);
                    } else {
                        this.ollamaProcess.kill('SIGKILL');
                    }
                }
                
                return false;
            } catch (error) {
                this.serviceChannel.appendLine(`Error starting Ollama server: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
        });
    }
    
    /**
     * Stop the embedded Ollama server
     */
    public async stopServer(): Promise<boolean> {
        if (!this.isRunning || !this.ollamaProcess) {
            return true;
        }
        
        return new Promise<boolean>((resolve) => {
            this.serviceChannel.appendLine('Stopping embedded Ollama server...');
            
            // Set a timeout in case the server doesn't shut down gracefully
            const timeoutId = setTimeout(() => {
                this.serviceChannel.appendLine('Server shutdown timed out, forcing termination');
                if (this.ollamaProcess && !this.ollamaProcess.killed) {
                    this.ollamaProcess.kill('SIGKILL');
                }
                this.isRunning = false;
                resolve(true);
            }, 5000);
            
            // Listen for process exit
            if (this.ollamaProcess) {
                this.ollamaProcess.once('exit', () => {
                    clearTimeout(timeoutId);
                    this.isRunning = false;
                    this.serviceChannel.appendLine('Embedded Ollama server stopped');
                    resolve(true);
                });
                
                // Attempt graceful shutdown
                this.ollamaProcess.kill('SIGTERM');
            } else {
                clearTimeout(timeoutId);
                this.isRunning = false;
                resolve(true);
            }
        });
    }
    
    /**
     * Get available bundled models and check if they're installed
     */
    public async getAvailableModels(): Promise<EmbeddedModel[]> {
        try {
            // Create resources directory structure if it doesn't exist
            const resourcesDir = path.join(this.extensionPath, 'resources', 'models');
            if (!fs.existsSync(resourcesDir)) {
                fs.mkdirSync(resourcesDir, { recursive: true });
            }
            
            // Check for models in the models directory
            for (const model of this.embeddedModels) {
                try {
                    const modelDir = path.join(this.modelsPath, model.name);
                    
                    // Check if the model directory exists
                    if (fs.existsSync(modelDir)) {
                        // Directory exists, mark as installed
                        const index = this.embeddedModels.findIndex(m => m.name === model.name);
                        if (index !== -1) {
                            this.embeddedModels[index].isInstalled = true;
                            this.serviceChannel.appendLine(`Found installed model: ${model.name} at ${modelDir}`);
                        }
                    } else {
                        // Directory doesn't exist, check if it's an embedded model
                        const bundledPath = path.join(resourcesDir, model.name);
                        if (fs.existsSync(bundledPath)) {
                            this.serviceChannel.appendLine(`Found bundled model: ${model.name} at ${bundledPath}`);
                            
                            // For deepseek-coder, auto-install if marked as pre-installed
                            if (model.name === "deepseek-coder-v2:latest" && model.isInstalled) {
                                this.serviceChannel.appendLine(`Auto-installing pre-installed model: ${model.name}`);
                                // Queue the install for the specified model
                                setTimeout(() => {
                                    this.installEmbeddedModel(model.name).catch(error => {
                                        this.serviceChannel.appendLine(`Error auto-installing model: ${error}`);
                                    });
                                }, 1000);
                            }
                        } else {
                            this.serviceChannel.appendLine(`Model not installed and not bundled: ${model.name}`);
                            // Set isInstalled to false if not found
                            const index = this.embeddedModels.findIndex(m => m.name === model.name);
                            if (index !== -1 && this.embeddedModels[index].isInstalled) {
                                this.embeddedModels[index].isInstalled = false;
                            }
                        }
                    }
                } catch (modelError) {
                    this.serviceChannel.appendLine(`Error checking model ${model.name}: ${modelError}`);
                }
            }
            
            // Sort models - installed first, then by name
            const sortedModels = [...this.embeddedModels].sort((a, b) => {
                if (a.isInstalled && !b.isInstalled) return -1;
                if (!a.isInstalled && b.isInstalled) return 1;
                return a.displayName.localeCompare(b.displayName);
            });
            
            return sortedModels;
        } catch (error) {
            this.serviceChannel.appendLine(`Error checking available models: ${error}`);
            return this.embeddedModels;
        }
    }
    
    /**
     * Install/extract a bundled model
     */
    public async installEmbeddedModel(modelName: string): Promise<boolean> {
        const model = this.embeddedModels.find(m => m.name === modelName);
        if (!model) {
            this.serviceChannel.appendLine(`Model ${modelName} not found in embedded models list`);
            return false;
        }
        
        // If model is already marked as installed, just verify the files exist
        if (model.isInstalled) {
            try {
                const modelDir = path.join(this.modelsPath, modelName);
                if (fs.existsSync(modelDir)) {
                    this.serviceChannel.appendLine(`Model ${modelName} is already installed at ${modelDir}`);
                    return true;
                } else {
                    // Model marked as installed but files not found, need to install
                    this.serviceChannel.appendLine(`Model ${modelName} marked as installed but files not found, reinstalling`);
                }
            } catch (error) {
                this.serviceChannel.appendLine(`Error checking model files: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        
        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${model.displayName}`,
            cancellable: true
        }, async (progress, token) => {
            try {
                // Check embedded model resources first
                const bundledModelPath = path.join(this.extensionPath, 'resources', 'models', modelName);
                
                if (fs.existsSync(bundledModelPath)) {
                    // Model is bundled - extract from resources
                    return await this.extractBundledModel(model, bundledModelPath, progress);
                } else {
                    // Model is not bundled - download from Ollama library
                    return await this.downloadModel(model, progress, token);
                }
            } catch (error) {
                this.serviceChannel.appendLine(`Error installing model ${modelName}: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
        });
    }
    
    /**
     * Extract a bundled model from extension resources
     */
    private async extractBundledModel(
        model: EmbeddedModel, 
        sourcePath: string, 
        progress: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<boolean> {
        try {
            const targetDir = path.join(this.modelsPath, model.name);
            
            // Ensure the target directory exists
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
            
            progress.report({ message: `Preparing ${model.displayName}...` });
            this.serviceChannel.appendLine(`Extracting bundled model from ${sourcePath} to ${targetDir}`);
            
            // Get the list of files to copy
            const files = fs.readdirSync(sourcePath);
            const totalFiles = files.length;
            
            // Copy each file to the target location
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const sourceFile = path.join(sourcePath, file);
                const targetFile = path.join(targetDir, file);
                
                const percent = Math.round((i / totalFiles) * 100);
                progress.report({ 
                    message: `Copying file ${i+1}/${totalFiles}: ${file}`, 
                    increment: percent / files.length 
                });
                
                fs.copyFileSync(sourceFile, targetFile);
            }
            
            progress.report({ message: `Finalizing installation...` });
            
            // Mark model as installed
            const index = this.embeddedModels.findIndex(m => m.name === model.name);
            if (index !== -1) {
                this.embeddedModels[index].isInstalled = true;
            }
            
            this.serviceChannel.appendLine(`Model ${model.name} installed successfully from bundled resources`);
            return true;
        } catch (error) {
            this.serviceChannel.appendLine(`Error extracting bundled model: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Download a model from Ollama library
     */
    private async downloadModel(
        model: EmbeddedModel, 
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ): Promise<boolean> {
        try {
            progress.report({ message: `Starting Ollama server for model download...` });
            
            // Ensure the server is running so we can use its model download feature
            const serverRunning = await this.startServer();
            if (!serverRunning) {
                throw new Error('Could not start Ollama server for model download');
            }
            
            // Construct the Ollama pull command with proper logging
            const modelName = model.name;
            this.serviceChannel.appendLine(`Starting model download: ${modelName}`);
            
            // Prepare parameters for model download
            const params = {
                name: modelName,
                stream: true,
                insecure: true // Allow non-verified certificates for download
            };
            
            // Set up cancellation
            const abortController = new AbortController();
            token.onCancellationRequested(() => {
                abortController.abort();
                this.serviceChannel.appendLine(`Download of model ${modelName} cancelled by user`);
            });
            
            // Call the Ollama API to pull the model
            const response = await axios.post(
                `${this.apiBaseUrl}/api/pull`,
                params,
                {
                    responseType: 'stream',
                    signal: abortController.signal
                }
            );
            
            progress.report({ message: `Downloading ${model.displayName} (This may take a while)...` });
            
            // Process the streaming response to track progress
            let downloadProgress = 0;
            
            await new Promise<void>((resolve, reject) => {
                response.data.on('data', (chunk: Buffer) => {
                    try {
                        const text = chunk.toString();
                        const lines = text.split('\n').filter(Boolean);
                        
                        for (const line of lines) {
                            try {
                                const data = JSON.parse(line);
                                
                                // Check for progress information
                                if (data.completed && data.total) {
                                    const percent = Math.round((data.completed / data.total) * 100);
                                    downloadProgress = percent;
                                    
                                    // Convert to more readable units
                                    const downloadedMB = (data.completed / (1024 * 1024)).toFixed(1);
                                    const totalMB = (data.total / (1024 * 1024)).toFixed(1);
                                    
                                    progress.report({ 
                                        message: `Downloading ${model.displayName}: ${downloadedMB}MB / ${totalMB}MB (${percent}%)` 
                                    });
                                }
                                
                                // Check for other status updates
                                if (data.status) {
                                    progress.report({ message: data.status });
                                    this.serviceChannel.appendLine(`Status update: ${data.status}`);
                                    
                                    // Check for completion
                                    if (data.status.includes('done') || data.status.includes('complete')) {
                                        this.serviceChannel.appendLine(`Model download completed: ${data.status}`);
                                    }
                                }
                            } catch (e) {
                                // Ignore JSON parsing errors
                            }
                        }
                    } catch (e) {
                        // Ignore data processing errors
                    }
                });
                
                response.data.on('error', (err: Error) => {
                    this.serviceChannel.appendLine(`Download stream error: ${err.message}`);
                    reject(err);
                });
                
                response.data.on('end', () => {
                    this.serviceChannel.appendLine(`Download stream ended`);
                    
                    // Check if download was successful (at least partially completed)
                    if (downloadProgress > 50) {
                        resolve();
                    } else {
                        reject(new Error('Download did not complete successfully'));
                    }
                });
            });
            
            progress.report({ message: `Finalizing model installation...` });
            
            // Mark model as installed
            const index = this.embeddedModels.findIndex(m => m.name === model.name);
            if (index !== -1) {
                this.embeddedModels[index].isInstalled = true;
            }
            
            // Wait for any post-processing to complete
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            this.serviceChannel.appendLine(`Model ${modelName} downloaded and installed successfully`);
            return true;
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                this.serviceChannel.appendLine(`Model download cancelled by user`);
                return false;
            }
            
            this.serviceChannel.appendLine(`Error downloading model: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Generate completion using the embedded Ollama server
     */
    public async generateCompletion(
        modelName: string, 
        prompt: string, 
        onChunk?: (text: string) => void,
        options?: {
            stream?: boolean,
            maxTokens?: number,
            temperature?: number
        }
    ): Promise<string> {
        // Ensure server is running
        if (!this.isRunning) {
            const started = await this.startServer();
            if (!started) {
                throw new Error('Failed to start embedded Ollama server');
            }
        }
        
        try {
            const useStreaming = options?.stream !== false && onChunk !== undefined;
            
            if (useStreaming) {
                // Streaming implementation
                return this.streamingGeneration(modelName, prompt, onChunk!, options);
            } else {
                // Non-streaming implementation
                const response = await axios.post(
                    `${this.apiBaseUrl}/api/generate`,
                    {
                        model: modelName,
                        prompt,
                        options: {
                            num_predict: options?.maxTokens || 2048,
                            temperature: options?.temperature || 0.7
                        }
                    },
                    {
                        timeout: 30000
                    }
                );
                
                if (response.data && response.data.response) {
                    return response.data.response;
                } else {
                    throw new Error('Invalid response from Ollama API');
                }
            }
        } catch (error) {
            this.serviceChannel.appendLine(`Error generating completion: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Stream generation results
     */
    private async streamingGeneration(
        modelName: string, 
        prompt: string, 
        onChunk: (text: string) => void,
        options?: {
            maxTokens?: number,
            temperature?: number
        }
    ): Promise<string> {
        try {
            // Send initial thinking message
            onChunk('_Thinking..._');
            
            const response = await axios.post(
                `${this.apiBaseUrl}/api/generate`,
                {
                    model: modelName,
                    prompt,
                    stream: true,
                    options: {
                        num_predict: options?.maxTokens || 2048,
                        temperature: options?.temperature || 0.7
                    }
                },
                {
                    responseType: 'stream',
                    timeout: 30000
                }
            );
            
            // Clear thinking message
            onChunk('');
            
            // Collect the full response
            let fullResponse = '';
            
            // Process the streaming response
            return new Promise<string>((resolve, reject) => {
                response.data.on('data', (chunk: Buffer) => {
                    try {
                        const text = chunk.toString();
                        const lines = text.split('\n').filter(Boolean);
                        
                        for (const line of lines) {
                            try {
                                const data = JSON.parse(line);
                                if (data.response) {
                                    fullResponse += data.response;
                                    onChunk(data.response);
                                }
                            } catch (e) {
                                // Ignore parsing errors
                            }
                        }
                    } catch (e) {
                        // Ignore processing errors
                    }
                });
                
                response.data.on('end', () => {
                    resolve(fullResponse);
                });
                
                response.data.on('error', (err: Error) => {
                    reject(err);
                });
            });
        } catch (error) {
            this.serviceChannel.appendLine(`Streaming error: ${error instanceof Error ? error.message : String(error)}`);
            onChunk(`\n\n_Error: ${error instanceof Error ? error.message : String(error)}_`);
            throw error;
        }
    }
    
    /**
     * Get API base URL for embedded Ollama
     */
    public getApiUrl(): string {
        return this.apiBaseUrl;
    }
    
    /**
     * Check if embedded Ollama server is running
     */
    public isServerRunning(): boolean {
        return this.isRunning;
    }
    
    /**
     * Clean up resources when extension is deactivated
     */
    public async dispose(): Promise<void> {
        try {
            await this.stopServer();
            
            // Remove any temporary files that might have been created
            const tempDir = path.join(os.tmpdir(), 'vscode-ollama-download');
            if (fs.existsSync(tempDir)) {
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (error) {
                    this.serviceChannel.appendLine(`Warning: Could not clean up temp directory: ${error}`);
                }
            }
            
            this.serviceChannel.appendLine('Embedded Ollama service disposed successfully');
        } catch (error) {
            this.serviceChannel.appendLine(`Error disposing embedded service: ${error}`);
        }
    }
}