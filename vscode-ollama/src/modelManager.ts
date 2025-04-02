/**
 * Model management functionality for the Ollama VS Code extension
 */
import * as vscode from 'vscode';
import { OllamaService, OllamaModel } from './ollamaService';
import { ConfigHelper, ErrorUtility, Logger } from './utils';

export interface ModelQuickPickItem extends vscode.QuickPickItem {
    model: OllamaModel;
}

/**
 * Centralized class for model-related operations
 */
export class ModelManager {
    private outputChannel: vscode.OutputChannel;
    private ollamaService: OllamaService;
    private modelListCache: OllamaModel[] | null = null;
    private readonly modelCacheTTL = 30 * 1000; // 30 seconds
    private lastCacheTime = 0;

    constructor(ollamaService: OllamaService, outputChannel?: vscode.OutputChannel) {
        this.ollamaService = ollamaService;
        this.outputChannel = outputChannel || vscode.window.createOutputChannel('Ollama Models');
    }

    /**
     * List all available models with caching
     */
    async listModels(forceRefresh = false): Promise<OllamaModel[]> {
        // Check cache first
        const now = Date.now();
        if (!forceRefresh && this.modelListCache && (now - this.lastCacheTime < this.modelCacheTTL)) {
            this.log(`Using cached model list (${this.modelListCache.length} models)`);
            return this.modelListCache;
        }

        try {
            const models = await this.ollamaService.listModels();
            
            // Update cache
            this.modelListCache = models;
            this.lastCacheTime = now;
            
            this.log(`Retrieved ${models.length} models from server`);
            return models;
        } catch (error) {
            this.log(`Error fetching models: ${ErrorUtility.formatError(error)}`, 'error');
            // Return empty array but don't update cache on error
            return [];
        }
    }

    /**
     * Find code-optimized models from the available models
     */
    async getCodeOptimizedModels(): Promise<OllamaModel[]> {
        const models = await this.listModels();
        
        // Filter for models suited for code tasks
        return models.filter(model => 
            model.name.toLowerCase().includes('code') || 
            model.name.toLowerCase().includes('starcoder') ||
            model.name.toLowerCase().includes('codellama')
        );
    }

    /**
     * Prompt user to select a model through QuickPick UI
     */
    async promptForModelSelection(
        placeHolder = 'Select an Ollama model',
        filterPredicate?: (model: OllamaModel) => boolean
    ): Promise<OllamaModel | undefined> {
        try {
            const models = await this.listModels();
            
            if (models.length === 0) {
                vscode.window.showInformationMessage('No Ollama models available. Install a model first.');
                return undefined;
            }
            
            // Apply filter if provided
            const filteredModels = filterPredicate ? models.filter(filterPredicate) : models;
            
            // Create QuickPick items
            const modelItems: ModelQuickPickItem[] = filteredModels.map(model => ({
                label: model.name,
                detail: `Size: ${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
                description: `Modified: ${new Date(model.modified_at).toLocaleString()}`,
                model: model
            }));
            
            // Show QuickPick
            const selectedItem = await vscode.window.showQuickPick(modelItems, {
                placeHolder,
                matchOnDetail: true,
                matchOnDescription: true
            });
            
            return selectedItem?.model;
        } catch (error) {
            ErrorUtility.showError(error, 'Error selecting model');
            return undefined;
        }
    }

    /**
     * Get the default model or prompt user to select one
     */
    async resolveModel(promptIfNotFound = true, preferCodeModels = false): Promise<string | undefined> {
        // First try from configuration
        const configDefaultModel = ConfigHelper.getDefaultModel();
        
        if (configDefaultModel) {
            this.log(`Using configured default model: ${configDefaultModel}`);
            return configDefaultModel;
        }
        
        // If we prefer code models, try to find one
        if (preferCodeModels) {
            const codeModels = await this.getCodeOptimizedModels();
            if (codeModels.length > 0) {
                this.log(`Using code-optimized model: ${codeModels[0].name}`);
                return codeModels[0].name;
            }
        }
        
        // Prompt user if requested
        if (promptIfNotFound) {
            const model = await this.promptForModelSelection(
                preferCodeModels ? 'Select a model for code analysis' : 'Select a model to use'
            );
            return model?.name;
        }
        
        return undefined;
    }

    /**
     * Suggest models if none are installed
     */
    async suggestModels(): Promise<void> {
        const models = await this.listModels(true);
        
        if (models.length === 0) {
            await this.ollamaService.checkAndSuggestModels([]);
        }
    }

    /**
     * Log to output channel
     */
    private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
        const prefix = level === 'info' ? '[INFO]' : 
                     level === 'warn' ? '[WARN]' : 
                     '[ERROR]';
                     
        this.outputChannel.appendLine(`${prefix} ${message}`);
    }
}