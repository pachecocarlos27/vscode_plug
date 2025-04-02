/**
 * Status bar management for the Ollama VS Code extension
 */
import * as vscode from 'vscode';
import { OllamaService } from './ollamaService';
import { Logger, ConfigHelper } from './utils';

/**
 * Manages the status bar item for Ollama
 */
export class StatusManager {
    private statusBarItem: vscode.StatusBarItem;
    private ollamaService: OllamaService;
    private outputChannel: vscode.OutputChannel;
    private pollingTimer: NodeJS.Timeout | null = null;
    private lastStatus: 'running' | 'not_running' | 'error' | 'unknown' = 'unknown';
    private consecutiveStatus = 0;
    private pollInterval = 5000; // Start with 5 seconds
    private readonly MIN_INTERVAL = 5000;     // 5 seconds
    private readonly MAX_INTERVAL = 300000;   // 5 minutes
    
    constructor(ollamaService: OllamaService, outputChannel?: vscode.OutputChannel) {
        this.ollamaService = ollamaService;
        this.outputChannel = outputChannel || Logger.getChannel('Ollama Status');
        
        // Create status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.text = "$(sync~spin) Checking Ollama...";
        this.statusBarItem.tooltip = "Checking if Ollama is installed and running";
        this.statusBarItem.show();
    }
    
    /**
     * Initialize the status polling
     */
    initialize() {
        // Check immediately
        this.checkStatus();
        
        // Then set up polling
        this.startPolling();
    }
    
    /**
     * Check Ollama status and update status bar
     */
    async checkStatus() {
        this.log('Checking Ollama status...');
        
        // Set to checking state
        this.statusBarItem.text = "$(sync~spin) Checking Ollama...";
        this.statusBarItem.tooltip = "Checking if Ollama is installed and running";
        this.statusBarItem.command = 'vscode-ollama.debug';
        
        try {
            const isRunning = await this.ollamaService.checkOllamaInstalled();
            
            if (isRunning) {
                this.updateStatusRunning();
                this.lastStatus = 'running';
            } else {
                this.updateStatusNotRunning();
                this.lastStatus = 'not_running';
            }
            
            // Adapt polling interval based on status pattern
            this.updatePollingInterval();
            
        } catch (e) {
            this.log(`Error checking status: ${e instanceof Error ? e.message : String(e)}`, 'error');
            this.statusBarItem.text = "$(error) Ollama: Error";
            this.statusBarItem.tooltip = "Error checking Ollama status. Click to retry.";
            this.statusBarItem.command = 'vscode-ollama.checkInstallation';
            
            this.lastStatus = 'error';
            this.pollInterval = 30000; // 30 seconds on error
        }
    }
    
    /**
     * Start or restart polling with current interval
     */
    private startPolling() {
        this.stopPolling();
        
        // Only start polling if enabled in configuration
        if (ConfigHelper.get('statusBarPolling', true)) {
            this.pollingTimer = setInterval(() => this.checkStatus(), this.pollInterval);
            this.log(`Started status polling with interval ${this.pollInterval / 1000}s`);
        } else {
            this.log('Status polling disabled by configuration');
        }
    }
    
    /**
     * Stop polling
     */
    private stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    }
    
    /**
     * Update polling interval based on status pattern
     */
    private updatePollingInterval() {
        const currentStatus = this.lastStatus;
        
        if (currentStatus === this.lastStatus) {
            // Same status as before, potentially increase interval
            this.consecutiveStatus++;
            
            if (this.consecutiveStatus >= 3) {
                // After 3 consecutive same status, gradually increase interval
                this.pollInterval = Math.min(this.pollInterval * 1.5, this.MAX_INTERVAL);
                this.consecutiveStatus = 3; // Cap the counter
                
                // Restart polling with new interval
                this.startPolling();
            }
        } else {
            // Status changed, reset counter and decrease interval
            this.lastStatus = currentStatus;
            this.consecutiveStatus = 1;
            this.pollInterval = Math.max(this.pollInterval / 2, this.MIN_INTERVAL);
            
            // Restart polling with new interval
            this.startPolling();
        }
    }
    
    /**
     * Update the status bar for running state
     */
    private async updateStatusRunning() {
        this.statusBarItem.text = "$(check) Ollama";
        this.statusBarItem.tooltip = "Ollama is running. Click to open chat.";
        this.statusBarItem.command = 'vscode-ollama.runModel';
        
        try {
            // Try to get models for enhanced information
            const models = await this.ollamaService.listModels();
            
            if (models.length > 0) {
                const defaultModel = ConfigHelper.getDefaultModel();
                
                if (defaultModel && models.some(m => m.name === defaultModel)) {
                    this.statusBarItem.text = `$(check) Ollama: ${defaultModel}`;
                    this.statusBarItem.tooltip = `Using model: ${defaultModel}. Click to open chat.`;
                } else {
                    this.statusBarItem.text = `$(check) Ollama: ${models.length} models`;
                    this.statusBarItem.tooltip = `${models.length} models available. Click to open chat.`;
                }
            }
        } catch (error) {
            // Keep the basic status if we can't get models
            this.log(`Error fetching models for status: ${error instanceof Error ? error.message : String(error)}`, 'warn');
        }
    }
    
    /**
     * Update the status bar for not running state
     */
    private updateStatusNotRunning() {
        this.statusBarItem.text = "$(warning) Ollama: Not Running";
        this.statusBarItem.tooltip = "Ollama is not installed or not running. Click to install/start.";
        this.statusBarItem.command = 'vscode-ollama.checkInstallation';
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
    
    /**
     * Dispose resources
     */
    dispose() {
        this.stopPolling();
        this.statusBarItem.dispose();
    }
}