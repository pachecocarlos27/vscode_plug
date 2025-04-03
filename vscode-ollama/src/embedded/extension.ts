import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaService } from './ollamaService';
import { OllamaPanel } from './ollamaPanel';

export function activate(context: vscode.ExtensionContext) {
    const ollamaService = new OllamaService();
    
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
    checkOllamaStatus(statusBarItem, ollamaService);
    
    // Add configuration setting for Ollama API URL
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ollama.apiUrl') || 
                e.affectsConfiguration('ollama.defaultModel') ||
                e.affectsConfiguration('ollama.includeProjectContext') ||
                e.affectsConfiguration('ollama.showFileExplorer')) {
                    
                // Recreate the Ollama service with the new URL
                // This will pick up the new configuration value
                const newOllamaService = new OllamaService();
                
                // If there's an active panel, dispose and recreate it
                if (OllamaPanel.currentPanel) {
                    OllamaPanel.currentPanel.dispose();
                    OllamaPanel.createOrShow(newOllamaService);
                }
                
                // Update status bar
                checkOllamaStatus(statusBarItem, newOllamaService);
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
        listModelsCommand, 
        runModelCommand, 
        checkInstallationCommand, 
        pullModelCommand,
        explainCodeCommand,
        improveCodeCommand,
        generateDocumentationCommand,
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
}

// Check if Ollama is installed and running, update status bar accordingly
async function checkOllamaStatus(statusBarItem: vscode.StatusBarItem, ollamaService: OllamaService) {
    statusBarItem.text = "$(sync~spin) Checking Ollama...";
    statusBarItem.tooltip = "Checking if Ollama is installed and running";
    
    try {
        const isInstalled = await ollamaService.checkOllamaInstalled();
        if (isInstalled) {
            statusBarItem.text = "$(check) Ollama";
            statusBarItem.tooltip = "Ollama is installed and running";
            statusBarItem.command = 'vscode-ollama.runModel';
        } else {
            statusBarItem.text = "$(warning) Ollama";
            statusBarItem.tooltip = "Ollama is not installed or not running";
            statusBarItem.command = 'vscode-ollama.checkInstallation';
        }
    } catch (e) {
        statusBarItem.text = "$(error) Ollama";
        statusBarItem.tooltip = "Error checking Ollama status";
        statusBarItem.command = 'vscode-ollama.checkInstallation';
    }
}

export function deactivate() {
    // Dispose of any resources when the extension is deactivated
    if (OllamaPanel.currentPanel) {
        OllamaPanel.currentPanel.dispose();
    }
}