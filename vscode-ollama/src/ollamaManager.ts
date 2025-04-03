import * as vscode from 'vscode';
import { OllamaService, OllamaModel } from './ollamaService';
import { EmbeddedOllamaService, EmbeddedModel } from './embeddedOllamaService';

/**
 * OllamaMode determines how Ollama will be used by the extension
 */
export enum OllamaMode {
    /**
     * Use system-installed Ollama (default)
     */
    System = 'system',
    
    /**
     * Use embedded Ollama bundled with the extension
     */
    Embedded = 'embedded',
    
    /**
     * Auto-detect: use embedded if system is not available
     */
    Auto = 'auto'
}

/**
 * Manages access to Ollama services, providing a unified interface 
 * to either system-installed or embedded Ollama
 */
export class OllamaManager {
    private systemService: OllamaService;
    private embeddedService: EmbeddedOllamaService | null = null;
    private currentMode: OllamaMode = OllamaMode.Auto; // Default to auto mode
    private serviceChannel: vscode.OutputChannel;
    private apiChannel: vscode.OutputChannel;
    private extensionPath: string;
    
    constructor(
        extensionPath: string, 
        serviceChannel: vscode.OutputChannel, 
        apiChannel: vscode.OutputChannel
    ) {
        this.extensionPath = extensionPath;
        this.serviceChannel = serviceChannel;
        this.apiChannel = apiChannel;
        
        // Initialize system Ollama service first
        this.systemService = new OllamaService(serviceChannel, apiChannel);
        
        // Initialize embedded service only when requested
        this.initializeServices();
    }
    
    /**
     * Initialize services based on configured mode
     */
    private async initializeServices(): Promise<void> {
        // Get the configured mode
        this.currentMode = this.getConfiguredMode();
        
        this.serviceChannel.appendLine(`OllamaManager initializing with mode: ${this.currentMode}`);
        
        if (this.currentMode !== OllamaMode.System) {
            // Initialize embedded service if not in system-only mode
            this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
        }
        
        // Try to establish which service we'll use based on mode
        await this.determineActiveService();
    }
    
    /**
     * Get the configured mode from settings
     */
    private getConfiguredMode(): OllamaMode {
        const configMode = vscode.workspace.getConfiguration('ollamaEnhanced').get('mode', 'auto');
        
        switch (configMode) {
            case 'system':
                return OllamaMode.System;
            case 'embedded':
                return OllamaMode.Embedded;
            case 'auto':
            default:
                return OllamaMode.Auto;
        }
    }
    
    /**
     * Determine which service to use based on mode and availability
     */
    private async determineActiveService(): Promise<void> {
        if (this.currentMode === OllamaMode.System) {
            // Use system Ollama only
            this.serviceChannel.appendLine('Using system Ollama service only (configured mode)');
            return;
        }
        
        if (this.currentMode === OllamaMode.Embedded) {
            // Initialize and use embedded Ollama
            this.serviceChannel.appendLine('Using embedded Ollama service (configured mode)');
            if (!this.embeddedService) {
                this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
            }
            return;
        }
        
        // For Auto mode, check system Ollama first
        try {
            const isSystemInstalled = await this.systemService.checkOllamaInstalled();
            
            if (isSystemInstalled) {
                this.serviceChannel.appendLine('System Ollama detected, using system service (auto mode)');
            } else {
                this.serviceChannel.appendLine('System Ollama not available, will use embedded service (auto mode)');
                if (!this.embeddedService) {
                    this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
                }
            }
        } catch (error) {
            this.serviceChannel.appendLine(`Error checking system Ollama: ${error instanceof Error ? error.message : String(error)}`);
            this.serviceChannel.appendLine('Defaulting to embedded service due to error');
            if (!this.embeddedService) {
                this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
            }
        }
    }
    
    /**
     * Get the active Ollama service based on current mode
     */
    private async getActiveService(): Promise<OllamaService | EmbeddedOllamaService> {
        if (this.currentMode === OllamaMode.System) {
            return this.systemService;
        }
        
        if (this.currentMode === OllamaMode.Embedded) {
            if (!this.embeddedService) {
                this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
            }
            return this.embeddedService;
        }
        
        // In Auto mode, use system Ollama if available
        try {
            const isSystemInstalled = await this.systemService.checkOllamaInstalled();
            if (isSystemInstalled) {
                return this.systemService;
            }
        } catch (error) {
            // If there's an error checking system Ollama, use embedded
            this.serviceChannel.appendLine(`Error checking system Ollama: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        // Fallback to embedded
        if (!this.embeddedService) {
            this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
        }
        return this.embeddedService;
    }
    
    /**
     * Check if Ollama (either system or embedded) is installed/available
     */
    public async checkOllamaInstalled(): Promise<boolean> {
        try {
            // First try system Ollama based on mode
            if (this.currentMode === OllamaMode.System || this.currentMode === OllamaMode.Auto) {
                try {
                    const isSystemInstalled = await this.systemService.checkOllamaInstalled();
                    if (isSystemInstalled) {
                        return true;
                    }
                } catch (error) {
                    this.serviceChannel.appendLine(`System Ollama check failed: ${error instanceof Error ? error.message : String(error)}`);
                    // If in system-only mode, propagate the error
                    if (this.currentMode === OllamaMode.System) {
                        throw error;
                    }
                }
            }
            
            // Try embedded Ollama if not in system-only mode
            if (this.currentMode !== OllamaMode.System) {
                if (!this.embeddedService) {
                    this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
                }
                
                // Just check if embedded service can be set up
                if (this.embeddedService) {
                    // Offer to install an embedded model
                    const embeddedModels = await this.embeddedService.getAvailableModels();
                    if (embeddedModels.length > 0) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch (error) {
            this.serviceChannel.appendLine(`Ollama availability check failed: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    
    /**
     * List available models from the active Ollama service
     */
    public async listModels(): Promise<(OllamaModel | EmbeddedModel)[]> {
        try {
            const service = await this.getActiveService();
            
            if (service === this.systemService) {
                return await this.systemService.listModels();
            } else if (this.embeddedService) {
                return await this.embeddedService.getAvailableModels();
            }
            
            return [];
        } catch (error) {
            this.serviceChannel.appendLine(`Error listing models: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Generate completion using the active Ollama service
     */
    public async generateCompletion(
        model: string, 
        prompt: string,
        onChunk?: (text: string) => void,
        options?: {
            stream?: boolean,
            maxTokens?: number,
            temperature?: number,
            timeoutSeconds?: number
        }
    ): Promise<string> {
        const service = await this.getActiveService();
        
        if (service === this.systemService) {
            if (options?.stream && onChunk) {
                // Use streaming API
                await this.systemService.streamCompletion(
                    model, 
                    prompt, 
                    onChunk, 
                    {
                        maxTokens: options.maxTokens,
                        temperature: options.temperature,
                        timeoutSeconds: options.timeoutSeconds
                    }
                );
                return ''; // The response is delivered via onChunk
            } else {
                // Use non-streaming API
                return await this.systemService.generateCompletion(model, prompt);
            }
        } else if (this.embeddedService) {
            return await this.embeddedService.generateCompletion(
                model, 
                prompt, 
                onChunk,
                {
                    stream: options?.stream,
                    maxTokens: options?.maxTokens,
                    temperature: options?.temperature
                }
            );
        }
        
        throw new Error('No Ollama service available');
    }
    
    /**
     * Show a dialog to select and install an embedded model
     */
    public async showEmbeddedModelInstaller(): Promise<void> {
        if (!this.embeddedService) {
            this.embeddedService = new EmbeddedOllamaService(this.extensionPath, this.serviceChannel);
        }
        
        const embeddedModels = await this.embeddedService.getAvailableModels();
        
        const items = embeddedModels.map(model => ({
            label: model.displayName,
            description: model.isInstalled ? 'Already installed' : model.size,
            detail: model.description,
            model: model.name,
            isInstalled: model.isInstalled
        }));
        
        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select an embedded model to install',
            title: 'Embedded Ollama Models',
        });
        
        if (selection) {
            if (selection.isInstalled) {
                vscode.window.showInformationMessage(`${selection.label} is already installed`);
                return;
            }
            
            const success = await this.embeddedService.installEmbeddedModel(selection.model);
            if (success) {
                vscode.window.showInformationMessage(`${selection.label} was installed successfully`);
            } else {
                vscode.window.showErrorMessage(`Failed to install ${selection.label}`);
            }
        }
    }
    
    /**
     * Switch between Ollama modes
     */
    public async switchMode(newMode: OllamaMode): Promise<void> {
        if (this.currentMode === newMode) {
            return;
        }
        
        this.serviceChannel.appendLine(`Switching Ollama mode from ${this.currentMode} to ${newMode}`);
        this.currentMode = newMode;
        
        // Update configuration
        await vscode.workspace.getConfiguration('ollamaEnhanced').update('mode', newMode, vscode.ConfigurationTarget.Global);
        
        // Make sure services are properly initialized
        await this.determineActiveService();
        
        // Notify user
        vscode.window.showInformationMessage(`Switched to ${this.getModeDisplayName(newMode)} mode`);
    }
    
    /**
     * Get user-friendly name for a mode
     */
    private getModeDisplayName(mode: OllamaMode): string {
        switch (mode) {
            case OllamaMode.System:
                return 'System Ollama';
            case OllamaMode.Embedded:
                return 'Embedded Ollama';
            case OllamaMode.Auto:
                return 'Auto-detect';
            default:
                return 'Unknown mode';
        }
    }
    
    /**
     * Get current mode
     */
    public getCurrentMode(): OllamaMode {
        return this.currentMode;
    }
    
    /**
     * Get base URL of the active Ollama API
     */
    public async getApiUrl(): Promise<string> {
        const service = await this.getActiveService();
        
        if (service === this.systemService) {
            return vscode.workspace.getConfiguration('ollamaEnhanced').get('apiUrl') as string || 'http://localhost:11434';
        } else if (this.embeddedService) {
            return this.embeddedService.getApiUrl();
        }
        
        return 'http://localhost:11434';
    }
    
    /**
     * Clean up resources when the extension is deactivated
     */
    public async dispose(): Promise<void> {
        // Stop embedded Ollama if it's running
        if (this.embeddedService) {
            await this.embeddedService.dispose();
        }
    }
}