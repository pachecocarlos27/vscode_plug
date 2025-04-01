import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OllamaService } from './ollamaService';
import { OllamaPanel } from './ollamaPanel';

// Create global output channels that are available even if extension fails to activate
// IMPORTANT: These need to be exported and defined at the module level for VS Code to register them
export let GLOBAL_OUTPUT_CHANNEL: vscode.OutputChannel;
export let MAIN_OUTPUT_CHANNEL: vscode.OutputChannel;
export let SERVICE_OUTPUT_CHANNEL: vscode.OutputChannel;
export let API_OUTPUT_CHANNEL: vscode.OutputChannel;

// We need to initialize these channels in the activate function to avoid the 'window is not defined' error
function initializeOutputChannels() {
    try {
        GLOBAL_OUTPUT_CHANNEL = vscode.window.createOutputChannel('Ollama Debug');
        MAIN_OUTPUT_CHANNEL = vscode.window.createOutputChannel('Ollama');
        SERVICE_OUTPUT_CHANNEL = vscode.window.createOutputChannel('Ollama Service');
        API_OUTPUT_CHANNEL = vscode.window.createOutputChannel('Ollama API');
        
        GLOBAL_OUTPUT_CHANNEL.appendLine('Ollama Debug Channel Created: ' + new Date().toISOString());
        GLOBAL_OUTPUT_CHANNEL.appendLine(`VS Code Version: ${vscode.version}`);
        GLOBAL_OUTPUT_CHANNEL.appendLine(`OS: ${os.platform()} ${os.release()}`);
        
        // Log to other channels
        [MAIN_OUTPUT_CHANNEL, SERVICE_OUTPUT_CHANNEL, API_OUTPUT_CHANNEL].forEach(channel => {
            channel.appendLine(`${channel.name} output channel created: ${new Date().toISOString()}`);
        });
        
        // Show the channels
        GLOBAL_OUTPUT_CHANNEL.show(false);
        MAIN_OUTPUT_CHANNEL.show(false);
        SERVICE_OUTPUT_CHANNEL.show(false);
        API_OUTPUT_CHANNEL.show(false);
        
        return true;
    } catch (error) {
        console.error('Error initializing output channels:', error);
        return false;
    }
}

// This function ensures output channels are created and logs initial information
export function ensureOutputChannelsCreated() {
    try {
        if (!GLOBAL_OUTPUT_CHANNEL) {
            // Initialize channels if they haven't been created yet
            return initializeOutputChannels();
        }
        
        GLOBAL_OUTPUT_CHANNEL.appendLine('Refreshing all output channels...');
        
        // Log basic info to each channel
        const channels = [MAIN_OUTPUT_CHANNEL, SERVICE_OUTPUT_CHANNEL, API_OUTPUT_CHANNEL];
        channels.forEach(channel => {
            channel.appendLine(`${channel.name} output channel refresh: ${new Date().toISOString()}`);
            channel.appendLine(`VS Code Version: ${vscode.version}`);
            channel.appendLine(`OS: ${os.platform()} ${os.release()}`);
            // Make sure the channel appears in the output panel dropdown
            channel.show(false);
        });
        
        GLOBAL_OUTPUT_CHANNEL.appendLine('All output channels refreshed successfully');
        return true;
    } catch (error) {
        console.error('Error refreshing output channels:', error);
        return false;
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating Ollama Extension...');
    
    // Initialize output channels when the extension activates
    initializeOutputChannels();
    
    // Now we can use the channels
    MAIN_OUTPUT_CHANNEL.appendLine('Ollama Extension Activated: ' + new Date().toISOString());
    MAIN_OUTPUT_CHANNEL.show(false); // Make it visible in dropdown but don't focus
    
    // Log basic environment information 
    MAIN_OUTPUT_CHANNEL.appendLine(`VS Code Version: ${vscode.version}`);
    MAIN_OUTPUT_CHANNEL.appendLine(`Extension Path: ${context.extensionPath}`);
    MAIN_OUTPUT_CHANNEL.appendLine(`Extension Mode: ${context.extensionMode === vscode.ExtensionMode.Development ? 'Development' : 'Production'}`);
    
    try {
        // Initialize the Ollama service
        MAIN_OUTPUT_CHANNEL.appendLine('Initializing Ollama service...');
        // Pass the output channels to the service
        const ollamaService = new OllamaService(SERVICE_OUTPUT_CHANNEL, API_OUTPUT_CHANNEL);
        
        // Add error handler to the global error handling
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            
            // Only use output channel if it's initialized
            if (GLOBAL_OUTPUT_CHANNEL) {
                GLOBAL_OUTPUT_CHANNEL.appendLine(`CRITICAL ERROR: ${error.message}`);
                GLOBAL_OUTPUT_CHANNEL.appendLine(error.stack || 'No stack trace available');
                // Make sure the error is visible
                GLOBAL_OUTPUT_CHANNEL.show(true);
            }
        });
    
    // Register debug command
    const debugCommand = vscode.commands.registerCommand('vscode-ollama.debug', async () => {
        try {
            // Use the debug channel for diagnostics
            GLOBAL_OUTPUT_CHANNEL.show(true);
            GLOBAL_OUTPUT_CHANNEL.appendLine('======== OLLAMA EXTENSION DEBUG INFO ========');
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Date: ${new Date().toISOString()}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`VS Code version: ${vscode.version}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Extension path: ${context.extensionPath}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Extension mode: ${context.extensionMode}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`OS: ${os.platform()} ${os.release()}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`CPU Architecture: ${os.arch()}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine('============================================');
            
            // List all output channels
            GLOBAL_OUTPUT_CHANNEL.appendLine('\nOutput channels:');
            GLOBAL_OUTPUT_CHANNEL.appendLine(`- GLOBAL_OUTPUT_CHANNEL: ${GLOBAL_OUTPUT_CHANNEL ? 'exists' : 'not found'}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`- MAIN_OUTPUT_CHANNEL: ${MAIN_OUTPUT_CHANNEL ? 'exists' : 'not found'}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`- SERVICE_OUTPUT_CHANNEL: ${SERVICE_OUTPUT_CHANNEL ? 'exists' : 'not found'}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`- API_OUTPUT_CHANNEL: ${API_OUTPUT_CHANNEL ? 'exists' : 'not found'}`);
            
            // Check if Ollama is installed and running
            GLOBAL_OUTPUT_CHANNEL.appendLine('\nChecking Ollama installation...');
            const isInstalled = await ollamaService.checkOllamaInstalled();
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Ollama installation check result: ${isInstalled}`);
            
            // Try to list models
            try {
                GLOBAL_OUTPUT_CHANNEL.appendLine('\nAttempting to list models...');
                const models = await ollamaService.listModels();
                GLOBAL_OUTPUT_CHANNEL.appendLine(`Models found: ${models.length}`);
                if (models.length > 0) {
                    GLOBAL_OUTPUT_CHANNEL.appendLine('Available models:');
                    models.forEach(model => {
                        GLOBAL_OUTPUT_CHANNEL.appendLine(`- ${model.name} (${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
                    });
                } else {
                    GLOBAL_OUTPUT_CHANNEL.appendLine('No models found. You may need to install a model.');
                }
            } catch (modelError) {
                GLOBAL_OUTPUT_CHANNEL.appendLine(`Error listing models: ${modelError instanceof Error ? modelError.message : String(modelError)}`);
            }
            
            // Check status bar
            GLOBAL_OUTPUT_CHANNEL.appendLine('\nStatus bar diagnostics:');
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Status bar polling enabled: ${vscode.workspace.getConfiguration('ollama').get('statusBarPolling', true)}`);
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Force recheck enabled: ${vscode.workspace.getConfiguration('ollama').get('forceRecheck', false)}`);
            
            // Make all output channels visible by sending a message
            MAIN_OUTPUT_CHANNEL.appendLine(`\nOutput channel visibility check: ${new Date().toISOString()}`);
            SERVICE_OUTPUT_CHANNEL.appendLine(`\nOutput channel visibility check: ${new Date().toISOString()}`);
            API_OUTPUT_CHANNEL.appendLine(`\nOutput channel visibility check: ${new Date().toISOString()}`);
            
            // Show all output channels
            MAIN_OUTPUT_CHANNEL.show(false);
            SERVICE_OUTPUT_CHANNEL.show(false);
            API_OUTPUT_CHANNEL.show(false);
            
            // Show diagnostic info to user
            vscode.window.showInformationMessage('Ollama extension debug info has been logged to the output panel.', 'View Log').then(selection => {
                if (selection === 'View Log') {
                    GLOBAL_OUTPUT_CHANNEL.show(true);
                }
            });
        } catch (error) {
            GLOBAL_OUTPUT_CHANNEL.appendLine(`Error in debug command: ${error instanceof Error ? error.message : String(error)}`);
            vscode.window.showErrorMessage(`Error debugging Ollama extension: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    
    // Register command to check Ollama installation
    const checkInstallationCommand = vscode.commands.registerCommand('vscode-ollama.checkInstallation', async () => {
        try {
            const isInstalled = await ollamaService.checkOllamaInstalled();
            if (isInstalled) {
                vscode.window.showInformationMessage('Ollama is installed and running correctly.');
            }
        } catch (error) {
            // Error message is already shown by the service
        }
    });
    
    // Register command to pull/download a new model
    const pullModelCommand = vscode.commands.registerCommand('vscode-ollama.pullModel', async () => {
        // First check if Ollama is installed
        const isInstalled = await ollamaService.checkOllamaInstalled();
        if (!isInstalled) {
            return;
        }
        
        // Show a list of recommended models
        const recommendedModels = [
            { label: 'gemma:7b', description: 'Google Gemma 7B model - 4.8GB' },
            { label: 'llama3:8b', description: 'Meta Llama 3 8B model - 4.7GB' },
            { label: 'mistral:7b', description: 'Mistral 7B model - 4.1GB' },
            { label: 'phi3:mini', description: 'Microsoft Phi-3 mini - 1.7GB' },
            { label: 'neural-chat:7b', description: 'Neural Chat 7B model - 4.1GB' },
            { label: 'codellama:7b', description: 'Meta CodeLlama 7B - 4.3GB, optimized for code' },
            { label: 'custom', description: 'Enter a custom model name (e.g. codellama:7b)' }
        ];
        
        const selectedModel = await vscode.window.showQuickPick(recommendedModels, {
            placeHolder: 'Select a model to install (will download several GB)',
        });
        
        if (!selectedModel) {
            return;
        }
        
        let modelName = selectedModel.label;
        
        // If user chooses custom, prompt for model name
        if (modelName === 'custom') {
            modelName = await vscode.window.showInputBox({
                placeHolder: 'Enter model name (e.g. codellama:7b)',
                prompt: 'Enter the name of the Ollama model to download'
            }) || '';
            
            if (!modelName) {
                return;
            }
        }
        
        // Show progress for downloading the model
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${modelName} model...`,
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: 'Downloading and installing model...' });
                
                // Use private method through any type
                await (ollamaService as any).pullModel(modelName);
                
                vscode.window.showInformationMessage(`Successfully installed ${modelName} model!`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to install model: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    });
    
    // Register command to list and select Ollama models
    const listModelsCommand = vscode.commands.registerCommand('vscode-ollama.listModels', async () => {
        try {
            const models = await ollamaService.listModels();
            
            if (models.length === 0) {
                // The service will handle showing an error and suggesting to install
                return;
            }
            
            const modelItems = models.map(model => ({
                label: model.name,
                detail: `Size: ${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
                description: `Modified: ${new Date(model.modified_at).toLocaleString()}`
            }));
            
            const selectedModel = await vscode.window.showQuickPick(modelItems, {
                placeHolder: 'Select an Ollama model to use',
                matchOnDetail: true,
                matchOnDescription: true
            });
            
            if (selectedModel) {
                // Create the chat panel with the selected model
                OllamaPanel.createOrShow(ollamaService);
                if (OllamaPanel.currentPanel) {
                    OllamaPanel.currentPanel.setModel(selectedModel.label);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to list Ollama models: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });
    
    // Register command to run a model directly (opens the chat panel)
    const runModelCommand = vscode.commands.registerCommand('vscode-ollama.runModel', async () => {
        try {
            const models = await ollamaService.listModels();
            
            if (models.length === 0) {
                // The service will handle showing an error and suggesting to install
                return;
            }
            
            const modelItems = models.map(model => ({
                label: model.name,
                detail: `Size: ${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
                description: `Modified: ${new Date(model.modified_at).toLocaleString()}`
            }));
            
            const selectedModel = await vscode.window.showQuickPick(modelItems, {
                placeHolder: 'Select an Ollama model to use',
                matchOnDetail: true,
                matchOnDescription: true
            });
            
            if (selectedModel) {
                // Create the chat panel with the selected model
                OllamaPanel.createOrShow(ollamaService);
                if (OllamaPanel.currentPanel) {
                    OllamaPanel.currentPanel.setModel(selectedModel.label);
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to run Ollama model: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });
    
    // Code editing and context menu commands
    const explainCodeCommand = vscode.commands.registerCommand('vscode-ollama.explainCode', async () => {
        await executeCodeAction('Explain what this code does in detail:');
    });
    
    const improveCodeCommand = vscode.commands.registerCommand('vscode-ollama.improveCode', async () => {
        await executeCodeAction('Improve this code. Consider performance, readability, and best practices:');
    });
    
    const generateDocumentationCommand = vscode.commands.registerCommand('vscode-ollama.generateDocumentation', async () => {
        await executeCodeAction('Generate comprehensive documentation for this code:');
    });
    
    // Command to add selected text as reference/context to the chat
    const addAsReferenceCommand = vscode.commands.registerCommand('vscode-ollama.addAsReference', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor');
            return;
        }
        
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('No text selected');
            return;
        }
        
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showErrorMessage('Selected text is empty');
            return;
        }
        
        // Get file extension for language context
        const fileExtension = path.extname(editor.document.fileName);
        const fileName = path.basename(editor.document.fileName);
        
        // Format the reference text with markdown formatting
        const referenceText = `Reference from ${fileName}:\n\`\`\`${fileExtension.replace('.', '')}\n${selectedText}\n\`\`\``;
        
        try {
            // Make sure Ollama panel is visible
            OllamaPanel.createOrShow(ollamaService);
            
            if (OllamaPanel.currentPanel) {
                // Send the reference to the panel
                OllamaPanel.currentPanel.addReference(referenceText);
                
                // Show a success message
                vscode.window.setStatusBarMessage('Selection added as reference to Ollama chat', 3000);
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to add reference: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });
    
    // Function to execute code actions with selected text
    async function executeCodeAction(prompt: string) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor');
            return;
        }
        
        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showErrorMessage('No code selected');
            return;
        }
        
        const selectedText = editor.document.getText(selection);
        if (!selectedText) {
            vscode.window.showErrorMessage('Selected text is empty');
            return;
        }
        
        // Get file extension for language context
        const fileExtension = path.extname(editor.document.fileName);
        
        try {
            // Check for Ollama and models
            const models = await ollamaService.listModels();
            if (models.length === 0) {
                return; // Service will handle errors
            }
            
            // Use default model if configured, otherwise ask user to select
            const configDefaultModel = vscode.workspace.getConfiguration('ollama').get('defaultModel') as string;
            let modelToUse = configDefaultModel;
            
            if (!modelToUse) {
                // Get models optimized for code
                const codeModels = models.filter(model => 
                    model.name.toLowerCase().includes('code') || 
                    model.name.toLowerCase().includes('starcoder') ||
                    model.name.toLowerCase().includes('codellama')
                );
                
                // If no code models, use all models
                const modelsToShow = codeModels.length > 0 ? codeModels : models;
                
                const modelItems = modelsToShow.map(model => ({
                    label: model.name,
                    detail: `Size: ${(model.size / 1024 / 1024 / 1024).toFixed(2)} GB`,
                    description: `Modified: ${new Date(model.modified_at).toLocaleString()}`
                }));
                
                const selectedModel = await vscode.window.showQuickPick(modelItems, {
                    placeHolder: 'Select a model for code analysis',
                    matchOnDetail: true,
                    matchOnDescription: true
                });
                
                if (!selectedModel) {
                    return;
                }
                
                modelToUse = selectedModel.label;
            }
            
            // Construct the full prompt with language and file context
            const fullPrompt = `${prompt}\n\nLanguage: ${fileExtension.replace('.', '') || 'Unknown'}\nCode:\n\`\`\`\n${selectedText}\n\`\`\``;
            
            // Create or show the OllamaPanel to display results
            OllamaPanel.createOrShow(ollamaService);
            if (OllamaPanel.currentPanel) {
                // Set the model to use
                OllamaPanel.currentPanel.setModel(modelToUse);
                
                // Send the prompt to the panel
                setTimeout(() => {
                    if (OllamaPanel.currentPanel) {
                        OllamaPanel.currentPanel.sendPrompt(fullPrompt);
                    }
                }, 500); // Small delay to ensure panel is ready
            }
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to analyze code: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }
    
    // Add status bar item to show Ollama status
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(sync~spin) Checking Ollama...";
    statusBarItem.tooltip = "Checking if Ollama is installed and running";
    statusBarItem.show();
    
    // Check Ollama status when extension is activated
    MAIN_OUTPUT_CHANNEL.appendLine('Checking initial Ollama status...');
    checkOllamaStatus(statusBarItem, ollamaService, MAIN_OUTPUT_CHANNEL);
    
    // Set up adaptive status polling with exponential backoff
    const adaptiveStatusPolling = () => {
        // Status tracking for adaptive polling
        let lastStatus: 'running' | 'not_running' | 'error' | 'unknown' = 'unknown';
        let consecutiveStatus = 0;
        let pollInterval = 5000; // Start with 5 seconds
        let checkCount = 0;
        let pollingTimer: NodeJS.Timeout | null = null;
        
        // Minimum and maximum intervals
        const MIN_INTERVAL = 5000;     // 5 seconds
        const MAX_INTERVAL = 300000;   // 5 minutes
        const maxInitialChecks = 5;
        
        // Function to schedule next check with adaptive timing
        const scheduleNextCheck = () => {
            if (pollingTimer) {
                clearTimeout(pollingTimer);
            }
            
            // Log schedule at debug level
            if (checkCount < maxInitialChecks) {
                MAIN_OUTPUT_CHANNEL.appendLine(`Scheduling status check #${checkCount + 1} in ${pollInterval/1000}s`);
            } else if (checkCount === maxInitialChecks) {
                MAIN_OUTPUT_CHANNEL.appendLine(`Initial status checks complete, switching to adaptive polling (current interval: ${pollInterval/1000}s)`);
            }
            
            pollingTimer = setTimeout(performCheck, pollInterval);
        };
        
        // Function to perform the actual check
        const performCheck = async () => {
            checkCount++;
            
            if (checkCount <= maxInitialChecks) {
                MAIN_OUTPUT_CHANNEL.appendLine(`Auto status check #${checkCount}/${maxInitialChecks}...`);
            } else {
                // After initial checks, only log if debugging is enabled
                if (vscode.workspace.getConfiguration('ollama').get('debugMode', false)) {
                    MAIN_OUTPUT_CHANNEL.appendLine(`Adaptive status check (interval: ${pollInterval/1000}s)...`);
                }
            }
            
            try {
                // Use a simpler check method for just status bar updates
                const statusCheckPromise = ollamaService.checkOllamaInstalled();
                
                // Add timeout to avoid blocking
                const timeoutPromise = new Promise<boolean>((_, reject) => {
                    setTimeout(() => reject(new Error('Status check timed out')), 3000);
                });
                
                // Race the status check against the timeout
                const isRunning = await Promise.race([statusCheckPromise, timeoutPromise])
                    .catch(error => {
                        console.error('Status check error:', error);
                        return false;
                    });
                
                // Update status bar
                updateStatusBar(isRunning);
                
                // Adapt polling interval based on status pattern
                const currentStatus = isRunning ? 'running' : 'not_running';
                
                if (currentStatus === lastStatus) {
                    // Same status as before, potentially increase interval
                    consecutiveStatus++;
                    
                    if (consecutiveStatus >= 3) {
                        // After 3 consecutive same status, gradually increase interval
                        // But cap at maximum interval
                        pollInterval = Math.min(pollInterval * 1.5, MAX_INTERVAL);
                        consecutiveStatus = 3; // Cap the counter
                    }
                } else {
                    // Status changed, reset counter and decrease interval
                    lastStatus = currentStatus;
                    consecutiveStatus = 1;
                    pollInterval = Math.max(pollInterval / 2, MIN_INTERVAL);
                }
                
            } catch (e) {
                console.error('Error in status polling:', e);
                lastStatus = 'error';
                // On error, use a medium interval
                pollInterval = 30000; // 30 seconds
                updateStatusBar(false, true);
            }
            
            // After initial fast checks, check if polling should continue
            if (checkCount >= maxInitialChecks && 
                !vscode.workspace.getConfiguration('ollama').get('statusBarPolling', true)) {
                if (pollingTimer) {
                    clearTimeout(pollingTimer);
                    pollingTimer = null;
                }
                MAIN_OUTPUT_CHANNEL.appendLine('Status bar polling disabled by configuration');
                return;
            }
            
            // Schedule next check
            scheduleNextCheck();
        };
        
        // Update the status bar based on status
        const updateStatusBar = (isRunning: boolean, isError = false) => {
            if (isError) {
                statusBarItem.text = "$(error) Ollama: Error";
                statusBarItem.tooltip = "Error checking Ollama status. Click to retry.";
                statusBarItem.command = 'vscode-ollama.checkInstallation';
            } else if (isRunning) {
                statusBarItem.text = "$(check) Ollama";
                statusBarItem.tooltip = "Ollama is running. Click to open chat.";
                statusBarItem.command = 'vscode-ollama.runModel';
            } else {
                statusBarItem.text = "$(warning) Ollama: Not Running";
                statusBarItem.tooltip = "Ollama is not running. Click to start.";
                statusBarItem.command = 'vscode-ollama.checkInstallation';
            }
        };
        
        // Start the first check
        performCheck();
    };
    
    // Perform the first check immediately and trigger auto-start if needed
    const performInitialCheck = async () => {
        try {
            // This initial explicit check will trigger the auto-start logic in ollamaService.ts
            // if Ollama is installed but not running
            MAIN_OUTPUT_CHANNEL.appendLine('Performing initial Ollama status check with auto-start...');
            const isInstalled = await ollamaService.checkOllamaInstalled();
            MAIN_OUTPUT_CHANNEL.appendLine(`Initial Ollama check result: ${isInstalled ? 'running' : 'not running'}`);
            
            // Update status bar after the check
            checkOllamaStatus(statusBarItem, ollamaService, MAIN_OUTPUT_CHANNEL);
        } catch (error) {
            MAIN_OUTPUT_CHANNEL.appendLine(`Error in initial Ollama check: ${error instanceof Error ? error.message : String(error)}`);
            // Update status bar to show error
            checkOllamaStatus(statusBarItem, ollamaService, MAIN_OUTPUT_CHANNEL);
        }
    };
    
    // Execute the initial check
    performInitialCheck();
    
    // Then set up adaptive polling
    adaptiveStatusPolling();
    
    // Add configuration setting for Ollama API URL
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ollama.apiUrl') || 
                e.affectsConfiguration('ollama.defaultModel') ||
                e.affectsConfiguration('ollama.includeProjectContext') ||
                e.affectsConfiguration('ollama.showFileExplorer')) {
                    
                // Recreate the Ollama service with the new URL
                // This will pick up the new configuration value
                const newOllamaService = new OllamaService(SERVICE_OUTPUT_CHANNEL, API_OUTPUT_CHANNEL);
                
                // If there's an active panel, dispose and recreate it
                if (OllamaPanel.currentPanel) {
                    OllamaPanel.currentPanel.dispose();
                    OllamaPanel.createOrShow(newOllamaService);
                }
                
                // Update status bar
                MAIN_OUTPUT_CHANNEL.appendLine('Configuration changed, updating Ollama status...');
                checkOllamaStatus(statusBarItem, newOllamaService, MAIN_OUTPUT_CHANNEL);
            }
        })
    );
    
    // Add editor-related event handlers
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(() => {
            // Notify panel of editor change if it exists
            if (OllamaPanel.currentPanel) {
                const editor = vscode.window.activeTextEditor;
                if (editor) {
                    // No direct method needed - the panel uses watchers
                }
            }
        })
    );
    
    // Add completion provider for code suggestions
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        [{ scheme: 'file' }], // All file types
        {
            async provideCompletionItems(document, position) {
                // Check if autocompletion is enabled in settings
                const enableAutoComplete = vscode.workspace.getConfiguration('ollama').get('codeActionsEnabled', true);
                if (!enableAutoComplete) return;
                
                // Only offer completions when typing at the end of a line
                const lineText = document.lineAt(position.line).text;
                const linePrefix = lineText.substring(0, position.character);
                
                // Check if we're at end of line and it's not a very short line
                const isEndOfLine = linePrefix.length === lineText.length;
                if (!isEndOfLine || linePrefix.trim().length < 3) return;
                
                // Create a completion item for Ollama
                const ollamaCompletion = new vscode.CompletionItem('Ollama: Complete code', vscode.CompletionItemKind.Snippet);
                ollamaCompletion.detail = 'Use Ollama to suggest code completion';
                ollamaCompletion.insertText = '';
                ollamaCompletion.command = {
                    command: 'vscode-ollama.completeCode',
                    title: 'Complete with Ollama'
                };
                
                return [ollamaCompletion];
            }
        }
    );
    
    // Register command to complete code using Ollama
    const completeCodeCommand = vscode.commands.registerCommand('vscode-ollama.completeCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        // Get current document content up to cursor position
        const document = editor.document;
        const position = editor.selection.active;
        const precedingText = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
        
        // Get file extension for language context
        const fileExtension = path.extname(document.fileName);
        
        // Create prompt for code completion
        const prompt = `Complete the following ${fileExtension.replace('.', '')} code. Only return the completion, not the original code:

\`\`\`${fileExtension.replace('.', '')}
${precedingText}
\`\`\``;
        
        try {
            // Get models
            const models = await ollamaService.listModels();
            if (models.length === 0) return;
            
            // Use default model or code-optimized model
            const configDefaultModel = vscode.workspace.getConfiguration('ollama').get('defaultModel') as string;
            let modelToUse = configDefaultModel;
            
            if (!modelToUse) {
                // Get code-optimized models
                const codeModels = models.filter(model => 
                    model.name.toLowerCase().includes('code') || 
                    model.name.toLowerCase().includes('starcoder') ||
                    model.name.toLowerCase().includes('codellama')
                );
                
                // If there are code-optimized models, use the first one
                if (codeModels.length > 0) {
                    modelToUse = codeModels[0].name;
                } else if (models.length > 0) {
                    // Otherwise use the first available model
                    modelToUse = models[0].name;
                } else {
                    return;
                }
            }
            
            // Show progress indicator
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Generating code completion...',
                cancellable: true
            }, async (progress, token) => {
                // Handle cancellation
                if (token.isCancellationRequested) return;
                
                progress.report({ message: 'Thinking...' });
                
                try {
                    // Generate completion using non-streaming mode for better control
                    const completion = await ollamaService.generateCompletion(modelToUse, prompt);
                    
                    // If completion is generated, insert it at cursor position
                    if (completion && !token.isCancellationRequested) {
                        // Clean up the completion to extract only the generated code
                        const cleanedCompletion = completion
                            .replace(/^```[\w]*\n?/m, '') // Remove opening code fence
                            .replace(/\n?```$/m, '');      // Remove closing code fence
                        
                        editor.edit(editBuilder => {
                            editBuilder.insert(position, cleanedCompletion);
                        });
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Code completion failed: ${error instanceof Error ? error.message : String(error)}`);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Code completion error: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    // Add commands to context
    context.subscriptions.push(
        debugCommand,
        listModelsCommand, 
        runModelCommand, 
        checkInstallationCommand, 
        pullModelCommand,
        explainCodeCommand,
        improveCodeCommand,
        generateDocumentationCommand,
        addAsReferenceCommand,
        completeCodeCommand,
        completionProvider,
        statusBarItem
    );
    
    // Command to handle file content extraction
    const getFileContentCommand = vscode.commands.registerCommand('vscode-ollama._getFileContent', async (filePath: string) => {
        try {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                return content;
            }
            return null;
        } catch (error) {
            console.error('Error reading file:', error);
            return null;
        }
    });
    
    context.subscriptions.push(getFileContentCommand);
    
    // Register the output channels with the extension context
    context.subscriptions.push(GLOBAL_OUTPUT_CHANNEL, MAIN_OUTPUT_CHANNEL, SERVICE_OUTPUT_CHANNEL, API_OUTPUT_CHANNEL);
    
    // Log successful activation
    MAIN_OUTPUT_CHANNEL.appendLine('Ollama extension activation completed successfully');
    MAIN_OUTPUT_CHANNEL.show(true); // Show the output channel (preserves focus)
    
    } catch (error) {
        // Log any errors during activation
        console.error('ERROR DURING ACTIVATION:', error);
        
        if (MAIN_OUTPUT_CHANNEL) {
            MAIN_OUTPUT_CHANNEL.appendLine(`ERROR DURING ACTIVATION: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                MAIN_OUTPUT_CHANNEL.appendLine(error.stack);
            }
            MAIN_OUTPUT_CHANNEL.show(true);
        }
        
        // Also show a notification to the user
        vscode.window.showErrorMessage(`Ollama extension failed to activate: ${error instanceof Error ? error.message : String(error)}`);
        
        // Even if activation fails, we want to add the output channels to context
        if (MAIN_OUTPUT_CHANNEL) {
            context.subscriptions.push(MAIN_OUTPUT_CHANNEL);
        }
        
        // Re-throw the error to properly report extension activation failure
        throw error;
    }
}

// Check if Ollama is installed and running, update status bar accordingly
async function checkOllamaStatus(statusBarItem: vscode.StatusBarItem, ollamaService: OllamaService, outputChannel: vscode.OutputChannel) {
    outputChannel.appendLine(`Checking Ollama status at ${new Date().toISOString()}...`);
    
    // Set to checking state with visible animation
    statusBarItem.text = "$(sync~spin) Checking Ollama...";
    statusBarItem.tooltip = "Checking if Ollama is installed and running";
    statusBarItem.command = 'vscode-ollama.debug'; // Click to show debug info
    statusBarItem.show();
    
    // Make sure status bar change takes effect immediately
    setTimeout(() => {
        if (statusBarItem.text.includes("Checking")) {
            statusBarItem.text = "$(sync~spin) Checking Ollama..."; // This forces a redraw
        }
    }, 100);
    
    // Create a timeout to handle potential delays in status checks
    const statusCheckTimeout = setTimeout(() => {
        if (statusBarItem.text.includes("Checking")) {
            statusBarItem.text = "$(warning) Ollama: Timeout";
            statusBarItem.tooltip = "Timed out while checking Ollama status. Click to retry.";
            statusBarItem.command = 'vscode-ollama.checkInstallation';
            outputChannel.appendLine(`Status check timed out after 10 seconds`);
        }
    }, 10000); // 10-second timeout
    
    try {
        console.log("Checking Ollama status...");
        
        // Try to check if Ollama is installed and running
        const isInstalled = await ollamaService.checkOllamaInstalled();
        
        // Clear the timeout since we got a response
        clearTimeout(statusCheckTimeout);
        
        // Update status bar based on Ollama status
        if (isInstalled) {
            console.log("Ollama is installed and running");
            statusBarItem.text = "$(check) Ollama";
            statusBarItem.tooltip = "Ollama is installed and running. Click to open chat.";
            statusBarItem.command = 'vscode-ollama.runModel';
            
            // Try to get available models to show more information
            try {
                const models = await ollamaService.listModels();
                if (models.length > 0) {
                    const defaultModel = vscode.workspace.getConfiguration('ollama').get('defaultModel') as string;
                    if (defaultModel && models.some(m => m.name === defaultModel)) {
                        statusBarItem.text = `$(check) Ollama: ${defaultModel}`;
                        statusBarItem.tooltip = `Using model: ${defaultModel}. Click to open chat.`;
                    } else {
                        statusBarItem.text = `$(check) Ollama: ${models.length} models`;
                        statusBarItem.tooltip = `${models.length} models available. Click to open chat.`;
                    }
                }
            } catch (modelError) {
                console.error("Error getting models:", modelError);
                // Keep the basic "Ollama is running" status
            }
        } else {
            console.log("Ollama is not installed or not running");
            statusBarItem.text = "$(warning) Ollama: Not Running";
            statusBarItem.tooltip = "Ollama is not installed or not running. Click to install/start.";
            statusBarItem.command = 'vscode-ollama.checkInstallation';
        }
    } catch (e) {
        // Clear the timeout since we got an error
        clearTimeout(statusCheckTimeout);
        
        console.error("Error checking Ollama status:", e);
        statusBarItem.text = "$(error) Ollama: Error";
        statusBarItem.tooltip = `Error checking Ollama status: ${e instanceof Error ? e.message : String(e)}. Click to retry.`;
        statusBarItem.command = 'vscode-ollama.checkInstallation';
    }
    
    // We no longer need the poll interval here as it's handled by a dedicated interval in the activation
    // This reduces the number of redundant status checks that were happening
    // The main interval is set up in the activation function
}

export function deactivate() {
    console.log('Deactivating Ollama Extension...');
    
    try {
        // Dispose of any resources when the extension is deactivated
        if (OllamaPanel.currentPanel) {
            console.log('Disposing OllamaPanel...');
            OllamaPanel.currentPanel.dispose();
        }
        
        console.log('Ollama Extension deactivated successfully');
    } catch (error) {
        console.error('Error during Ollama Extension deactivation:', error);
    }
}