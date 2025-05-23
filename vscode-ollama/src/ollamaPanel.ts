import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OllamaService } from './ollamaService';

interface ProjectContext {
    files: string[];
    activeFile: string | null;
    selection: string | null;
    workspaceFolders: string[];
}

// Define a chat session interface
interface ChatSession {
    id: string;
    name: string;
    modelName: string;
    messages: {
        role: 'user' | 'assistant';
        content: string;
        timestamp: number;
    }[];
    createdAt: number;
    updatedAt: number;
}

export class OllamaPanel {
    /**
     * Extracts code blocks from a response with improved formatting handling
     * @param text The markdown text to parse
     * @returns Array of code blocks with language, content and position information
     */
    private extractCodeBlocks(text: string): Array<{ 
        language: string; 
        code: string;
        position?: { start: number; end: number; }; 
    }> {
        // Optimized regex to handle various code block formats, including spaces after language identifier
        const codeBlockRegex = /```(\w*)\s*([\s\S]*?)```/g;
        const codeBlocks: Array<{ 
            language: string; 
            code: string;
            position?: { start: number; end: number; }; 
        }> = [];
        
        // Reusable match variable
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            // Get language or default to empty string
            const language = match[1] || '';
            
            // Comprehensive normalization for line endings
            const code = match[2]
                .replace(/\r\n/g, '\n')  // Windows CRLF → LF
                .replace(/\r/g, '\n')    // Old Mac CR → LF
                .trim();                  // Remove extra whitespace
            
            // Only add non-empty code blocks
            if (code) {
                codeBlocks.push({ 
                    language, 
                    code,
                    position: {
                        start: match.index,
                        end: match.index + match[0].length
                    }
                });
            }
        }
        
        return codeBlocks;
    }
    public static currentPanel: OllamaPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly ollamaService: OllamaService;
    private currentModel: string | undefined;
    private disposables: vscode.Disposable[] = [];
    private contextWatcher: vscode.Disposable | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    
    // Session management
    private sessions: ChatSession[] = [];
    private currentSessionId: string | null = null;
    private readonly sessionsStorageKey = 'ollama-chat-sessions';
    private extensionContext: vscode.ExtensionContext;
    
    // Request handling properties
    private currentRequestController: AbortController | null = null;
    private currentPromptId: string | null = null;
    
    // Memory optimization properties
    private responseChunks: string[] = []; // Store response chunks for batch processing
    private chunkUpdateTimer: NodeJS.Timeout | null = null;
    private readonly CHUNK_UPDATE_INTERVAL = 100; // Update UI every 100ms to reduce rendering overhead
    private readonly MAX_RESPONSE_SIZE = 100000; // Maximum size for stored response
    private readonly BATCH_SIZE = 500; // Characters per batch to avoid UI sluggishness

    private constructor(panel: vscode.WebviewPanel, ollamaService: OllamaService) {
        this.panel = panel;
        this.ollamaService = ollamaService;
        // Don't try to access the extension context directly

        // Set basic HTML content - moved this later to ensure initialization completes
        
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        
        // Setup watchers for project context
        this.setupProjectWatchers();
        
        try {
            // First set the panel HTML to ensure it's ready for messages
            this.panel.webview.html = this.getBasicWebviewContent();
            
            // Now create a session and setup message handlers
            // Load saved sessions - delay this to ensure HTML is loaded
            setTimeout(() => {
                this.loadSessions().catch(error => {
                    console.error('Error loading sessions during initialization:', error);
                });
            }, 500);
        } catch (initError) {
            console.error('Error initializing OllamaPanel:', initError);
        }
        
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendPrompt':
                        if (!this.currentModel) {
                            vscode.window.showErrorMessage('Please select a model first');
                            return;
                        }
                        
                        // Ensure we have a current session
                        if (!this.currentSessionId) {
                            await this.createNewSession(this.currentModel);
                        }
                        
                        // Record the user message
                        await this.recordMessage('user', message.text);
                        
                        // Get project context to enhance the prompt
                        const projectContext = await this.getProjectContext();
                        
                        this.panel.webview.postMessage({ 
                            command: 'startResponse',
                            prompt: message.text,
                            hasContext: Boolean(projectContext && (projectContext.activeFile || projectContext.selection))
                        });
                        
                        // Create a variable to track this specific request
                        const promptId = Date.now().toString();
                        
                        try {
                            // Reuse project context that was already obtained
                            
                            // Enhance prompt with context if requested
                            let enhancedPrompt = message.text;
                            if (message.includeContext) {
                                enhancedPrompt = this.createEnhancedPrompt(message.text, projectContext);
                            }
                            
                            let fullResponse = '';
                            
                            // Add support for storing current request for cancellation
                            this.currentRequestController = new AbortController();
                            
                            // Store the current prompt ID to handle multiple concurrent requests
                            this.currentPromptId = promptId;
                            
                            // Register cancellation handler for the specific command
                            const cancelDisposable = vscode.commands.registerCommand('vscode-ollama-enhanced.cancelRequest', () => {
                                if (this.currentRequestController) {
                                    this.currentRequestController.abort();
                                    this.panel.webview.postMessage({
                                        command: 'appendResponse',
                                        text: "\n\n_Request cancelled by user._"
                                    });
                                }
                            });
                            
                            // Get configuration settings
                            const timeoutSeconds = vscode.workspace.getConfiguration('ollama').get('requestTimeout') as number || 90;
                            const temperature = vscode.workspace.getConfiguration('ollama').get('temperature') as number || 0.7;
                            
                            // Use enhanced streamCompletion with improved timeout and error handling
                            console.log('Starting stream completion with model:', this.currentModel);
                            
                            // Clear the thinking message first
                            this.panel.webview.postMessage({
                                command: 'appendResponse',
                                text: ''  // Empty text to clear the thinking indicator
                            });
                            
                            // Reset response chunks array
                            this.responseChunks = [];
                            if (this.chunkUpdateTimer) {
                                clearTimeout(this.chunkUpdateTimer);
                                this.chunkUpdateTimer = null;
                            }
                            
                            // Setup batched UI updates with improved error handling
                            const processBatchedChunks = () => {
                                try {
                                    // Check if the prompt is still active
                                    if (this.currentPromptId !== promptId) {
                                        console.log('processBatchedChunks: Processing stopped as prompt ID changed');
                                        return; // Don't schedule another update if prompt changed
                                    }
                                    
                                    if (this.responseChunks.length === 0) {
                                        this.chunkUpdateTimer = setTimeout(processBatchedChunks, this.CHUNK_UPDATE_INTERVAL);
                                        return;
                                    }
                                    
                                    // Get chunks to process in this batch 
                                    const chunksToProcess = this.responseChunks.splice(0, Math.min(5, this.responseChunks.length));
                                    const batchText = chunksToProcess.join('');
                                    
                                    // Post to UI if non-empty and this is still the active prompt
                                    if (batchText.trim() && this.currentPromptId === promptId) {
                                        try {
                                            this.panel.webview.postMessage({
                                                command: 'appendResponse',
                                                text: batchText
                                            });
                                        
                                            // Append to full response, with size limit to prevent memory issues
                                            if (fullResponse.length < this.MAX_RESPONSE_SIZE) {
                                                fullResponse += batchText;
                                            } else if (!fullResponse.includes('[Response truncated due to size...]')) {
                                                // Add truncation notice only once
                                                fullResponse += '\n\n[Response truncated due to size...]';
                                            }
                                        } catch (postError) {
                                            console.error('Error posting message to webview:', postError);
                                            // Push the chunks back if posting failed
                                            this.responseChunks.unshift(...chunksToProcess);
                                        }
                                    }
                                    
                                    // Limit batch processing time to avoid UI freezing
                                    if (this.responseChunks.length > 0 && this.currentPromptId === promptId) {
                                        this.chunkUpdateTimer = setTimeout(processBatchedChunks, this.CHUNK_UPDATE_INTERVAL);
                                    } else if (this.currentPromptId === promptId) {
                                        // If no more chunks but still the active prompt, schedule a check
                                        this.chunkUpdateTimer = setTimeout(processBatchedChunks, this.CHUNK_UPDATE_INTERVAL * 2);
                                    }
                                    
                                } catch (error) {
                                    console.error('Error in processBatchedChunks:', error);
                                    // Make sure we don't stop the processing due to an error
                                    this.chunkUpdateTimer = setTimeout(processBatchedChunks, this.CHUNK_UPDATE_INTERVAL);
                                }
                            };
                            
                            // Start the batch processor
                            this.chunkUpdateTimer = setTimeout(processBatchedChunks, this.CHUNK_UPDATE_INTERVAL);
                            
                            // Track if we've seen an error
                            let hasError = false;
                            
                            try {
                                await this.ollamaService.streamCompletion(
                                    this.currentModel,
                                    enhancedPrompt,
                                    (chunk) => {
                                        // Skip processing if this isn't the current prompt anymore
                                        if (this.currentPromptId !== promptId) {
                                            console.log('Skipping chunk as prompt ID changed');
                                            return;
                                        }
                                        
                                        // Check if this is an error message (they start with _Error:)
                                        if (chunk.trim().startsWith('_Error:')) {
                                            console.error('Received error in chunk:', chunk);
                                            hasError = true;
                                        }
                                        
                                        // Log small preview for debugging
                                        if (chunk.trim()) {
                                            console.log('Received chunk:', 
                                                chunk.substring(0, Math.min(50, chunk.length)) + 
                                                (chunk.length > 50 ? '...' : '')
                                            );
                                            
                                            // Add to processing queue instead of posting directly
                                            this.responseChunks.push(chunk);
                                        }
                                    },
                                    {
                                        timeoutSeconds: timeoutSeconds,
                                        temperature: temperature
                                    }
                                );
                            } catch (streamError) {
                                console.error('Error in streamCompletion:', streamError);
                                
                                // More detailed error logging
                                let errorMessage = '';
                                if (streamError instanceof Error) {
                                    errorMessage = streamError.message;
                                    if (streamError.stack) {
                                        console.error('Error stack:', streamError.stack);
                                    }
                                } else {
                                    errorMessage = String(streamError);
                                }
                                
                                // If we already saw an error message in the chunks, no need to show another
                                if (!hasError) {
                                    // Create a more user-friendly error message based on error content
                                    let userMessage = '';
                                    
                                    if (errorMessage.includes('timed out') || errorMessage.includes('stalled')) {
                                        userMessage = 'The Ollama server stopped responding. This could be because the model is overloaded or the server crashed.';
                                    } else if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND')) {
                                        userMessage = 'Could not connect to the Ollama server. Make sure Ollama is running and accessible.';
                                    } else if (errorMessage.includes('out of memory') || errorMessage.includes('OOM')) {
                                        userMessage = 'The Ollama server ran out of memory. Try using a smaller model or reducing the context size.';
                                    } else {
                                        // Generic error
                                        userMessage = `${errorMessage} - Try restarting Ollama or switching to a different model.`;
                                    }
                                    
                                    // Push an error message to the chunk queue
                                    this.responseChunks.push(`\n\n_Error: ${userMessage}_`);
                                }
                                
                                // Force showing an error in the UI even if chunks are not processed
                                try {
                                    this.panel.webview.postMessage({
                                        command: 'error',
                                        message: errorMessage
                                    });
                                } catch (postError) {
                                    console.error('Failed to post error message to webview:', postError);
                                }
                            }
                            
                            // Cleanup the batch processor
                            if (this.chunkUpdateTimer) {
                                clearTimeout(this.chunkUpdateTimer);
                                this.chunkUpdateTimer = null;
                            }
                            
                            // Process any remaining chunks
                            if (this.responseChunks.length > 0 && this.currentPromptId === promptId) {
                                const remainingText = this.responseChunks.join('');
                                this.panel.webview.postMessage({
                                    command: 'appendResponse',
                                    text: remainingText
                                });
                                
                                // Add remaining chunks to full response
                                if (fullResponse.length < this.MAX_RESPONSE_SIZE) {
                                    fullResponse += remainingText;
                                }
                                
                                this.responseChunks = [];
                            }
                            
                            // Clean up after completion
                            cancelDisposable.dispose();
                            
                            // Make sure this is still the active request
                            if (this.currentPromptId === promptId) {
                                // Process the response for code blocks and suggestions
                                const codeBlocks = this.extractCodeBlocks(fullResponse);
                                
                                // Analyze if this response might contain code suggestions
                                const responseContainsCodeSuggestions = 
                                    enhancedPrompt.toLowerCase().includes('improve') || 
                                    enhancedPrompt.toLowerCase().includes('fix') || 
                                    enhancedPrompt.toLowerCase().includes('refactor') ||
                                    enhancedPrompt.toLowerCase().includes('optimize') ||
                                    enhancedPrompt.toLowerCase().includes('enhance') ||
                                    codeBlocks.length > 0;
                                
                                // Enhanced code suggestion handling to help users understand and apply changes
                                this.panel.webview.postMessage({
                                    command: 'endResponse',
                                    fullResponse,
                                    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
                                    activeFile: projectContext.activeFile,
                                    markdownFormatting: true, // Signal to use markdown parser
                                    suggestCodeChanges: responseContainsCodeSuggestions, // Signal if UI should show code action buttons
                                    originalPrompt: enhancedPrompt // Include original prompt for context
                                });
                            }
                        } catch (error) {
                            // Avoid showing the generic error message when request was cancelled by user 
                            if (error instanceof Error && error.name === 'AbortError') {
                                console.log('Request was aborted by user');
                                return;
                            }
                            
                            // Only show error if this is still the current prompt
                            if (this.currentPromptId === promptId) {
                                this.panel.webview.postMessage({
                                    command: 'error',
                                    message: `Error: ${error instanceof Error ? error.message : String(error)}`
                                });
                            }
                        }
                        break;
                        
                    case 'getProjectContext':
                        const requestedContext = await this.getProjectContext();
                        this.panel.webview.postMessage({
                            command: 'projectContext',
                            context: requestedContext
                        });
                        break;
                        
                    case 'applyEdit':
                        await this.applyEdit(message.filePath, message.edit, message.showDiff !== false);
                        break;
                        
                    case 'applyMultipleEdits':
                        await this.applyMultipleEdits(message.edits, message.skipConfirmation);
                        break;
                        
                    case 'createFile':
                        await this.createFile(message.filePath, message.content);
                        break;
                        
                    case 'refreshContext':
                        const refreshedContext = await this.getProjectContext();
                        this.panel.webview.postMessage({
                            command: 'projectContext',
                            context: refreshedContext
                        });
                        break;
                        
                    // Session management commands
                    case 'createNewSession':
                        await this.createNewSession(message.modelName);
                        break;
                        
                    case 'switchSession':
                        await this.switchToSession(message.sessionId);
                        break;
                        
                    case 'renameSession':
                        await this.renameSession(message.sessionId, message.name);
                        break;
                        
                    case 'deleteSession':
                        await this.deleteSession(message.sessionId);
                        break;
                        
                    case 'getSessions':
                        this.sendSessionsToWebview();
                        break;
                        
                    case 'getModels':
                        await this.getAndSendAvailableModels();
                        break;
                        
                    case 'openFile':
                        await this.openFile(message.filePath, message.selection);
                        break;
                        
                    case 'cancelGeneration':
                        console.log('Cancellation requested from webview');
                        // Execute the registered cancellation command which will handle aborting the request
                        vscode.commands.executeCommand('vscode-ollama-enhanced.cancelRequest');
                        break;
                        
                    case 'copyToClipboard':
                        if (message.text) {
                            vscode.env.clipboard.writeText(message.text);
                            // Inform the user with a status message
                            vscode.window.setStatusBarMessage('Code copied to clipboard', 3000);
                        }
                        break;
                        
                    case 'saveCodeToFile':
                        if (message.text) {
                            // Direct file saving without using the helper method
                            try {
                                console.log(`Attempting to save code with language: ${message.language}`);
                                
                                // Get the root workspace folder
                                const workspaceFolders = vscode.workspace.workspaceFolders;
                                if (!workspaceFolders || workspaceFolders.length === 0) {
                                    throw new Error('No workspace folder is open');
                                }
                                
                                const rootPath = workspaceFolders[0].uri.fsPath;
                                console.log(`Root workspace path: ${rootPath}`);
                                
                                // Create timestamp for filename
                                const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
                                
                                // Determine file extension
                                const fileExt = this.getFileExtensionForLanguage(message.language);
                                console.log(`Using file extension: ${fileExt} for language: ${message.language}`);
                                
                                // Create default filename
                                const defaultName = `generated_${timestamp}${fileExt}`;
                                
                                // Ask user for filename
                                const fileName = await vscode.window.showInputBox({
                                    prompt: 'Enter a filename for your generated code',
                                    value: defaultName
                                });
                                
                                if (!fileName) {
                                    console.log('File save cancelled - no filename provided');
                                    return;
                                }
                                
                                // Create a "generated" folder at workspace root
                                const targetDir = path.join(rootPath, 'generated');
                                if (!fs.existsSync(targetDir)) {
                                    console.log(`Creating directory: ${targetDir}`);
                                    fs.mkdirSync(targetDir, { recursive: true });
                                }
                                
                                // Full path for the new file
                                const filePath = path.join(targetDir, fileName);
                                console.log(`Writing file to: ${filePath}`);
                                
                                // Write the file directly
                                fs.writeFileSync(filePath, message.text, 'utf8');
                                
                                // Show success message and offer to open the file
                                vscode.window.showInformationMessage(
                                    `Code saved to ${fileName}`, 
                                    'Open File'
                                ).then(selection => {
                                    if (selection === 'Open File') {
                                        vscode.workspace.openTextDocument(filePath).then(doc => {
                                            vscode.window.showTextDocument(doc);
                                        });
                                    }
                                });
                                
                                // Log successful save operation for debugging
                                console.log(`Successfully saved file at: ${filePath}`);
                                
                                // Send success message to webview
                                try {
                                    this.panel.webview.postMessage({
                                        command: 'fileSaved',
                                        success: true,
                                        filePath: filePath
                                    });
                                    console.log("Success message sent to webview client");
                                } catch (postError) {
                                    console.error(`Error sending file save success message to webview: ${postError}`);
                                }
                            } catch (error) {
                                console.error(`Failed to save file: ${error instanceof Error ? error.message : String(error)}`);
                                vscode.window.showErrorMessage(`Failed to save code to file: ${error instanceof Error ? error.message : String(error)}`);
                                
                                // Notify webview of failure with detailed error
                                try {
                                    const errorMsg = error instanceof Error ? error.message : String(error);
                                    console.error(`Detailed error saving file: ${errorMsg}`);
                                    
                                    // Check for specific error causes
                                    if (errorMsg.includes('EACCES')) {
                                        console.error("Permission denied error - cannot write to the target directory");
                                    } else if (errorMsg.includes('ENOENT')) {
                                        console.error("Directory not found error - target directory doesn't exist");
                                    }
                                    
                                    // Send error details to webview
                                    this.panel.webview.postMessage({
                                        command: 'fileSaved',
                                        success: false,
                                        error: errorMsg
                                    });
                                    console.log("Error message sent to webview client");
                                } catch (postError) {
                                    console.error(`Error sending failure message to webview: ${postError}`);
                                }
                            }
                        }
                        break;
                        
                    case 'applyCodeToEditor':
                        if (message.text) {
                            console.log(`Applying code to editor, length: ${message.text.length}`);
                            
                            // Check if there is an active editor
                            let editor = vscode.window.activeTextEditor;
                            
                            // If no active editor, ask what to do
                            if (!editor) {
                                console.log("No active editor found, asking user for preference");
                                
                                // Try to determine the language for the file extension
                                let fileExtension = '.txt';  // Default
                                if (message.language) {
                                    fileExtension = this.getFileExtensionForLanguage(message.language);
                                }
                                
                                // Ask user what they want to do
                                vscode.window.showInformationMessage(
                                    'No editor is currently active. What would you like to do with the code?', 
                                    'Create New File', 
                                    'Open Editor First'
                                ).then(async selection => {
                                    if (selection === 'Create New File') {
                                        // Create a new file with the code
                                        console.log("User chose to create a new file");
                                        this.createNewFileWithCode(message.text, fileExtension).then(success => {
                                            if (success) {
                                                // File was created and opened successfully
                                                try {
                                                    this.panel.webview.postMessage({
                                                        command: 'codeApplied',
                                                        success: true,
                                                        createdNewFile: true
                                                    });
                                                } catch (err) {
                                                    console.error(`Error sending confirmation to webview: ${err}`);
                                                }
                                            }
                                        }).catch(err => {
                                            console.error(`Error creating new file: ${err}`);
                                            vscode.window.showErrorMessage(`Could not create new file: ${err}`);
                                        });
                                    } else if (selection === 'Open Editor First') {
                                        // Open new untitled document
                                        console.log("User chose to open an editor first");
                                        try {
                                            // Create an untitled document
                                            const document = await vscode.workspace.openTextDocument({ 
                                                content: '',
                                                language: message.language || 'plaintext'
                                            });
                                            const editor = await vscode.window.showTextDocument(document);
                                            
                                            // Now insert the code at the beginning
                                            editor.edit(editBuilder => {
                                                editBuilder.insert(new vscode.Position(0, 0), message.text);
                                            }).then(success => {
                                                if (success) {
                                                    vscode.window.setStatusBarMessage('Code applied to new document', 3000);
                                                    try {
                                                        this.panel.webview.postMessage({
                                                            command: 'codeApplied',
                                                            success: true,
                                                            createdNewFile: true
                                                        });
                                                    } catch (err) {
                                                        console.error(`Error sending confirmation to webview: ${err}`);
                                                    }
                                                }
                                            });
                                        } catch (err) {
                                            console.error(`Error creating new document: ${err}`);
                                            vscode.window.showErrorMessage(`Could not create new document: ${err}`);
                                        }
                                    }
                                });
                            } else {
                                // Use the existing editor
                                try {
                                    // Apply the code to the active editor
                                    editor.edit(editBuilder => {
                                        // Replace entire selection or insert at cursor
                                        if (editor.selection.isEmpty) {
                                            console.log(`Inserting at cursor position: ${editor.selection.active.line}:${editor.selection.active.character}`);
                                            editBuilder.insert(editor.selection.active, message.text);
                                        } else {
                                            console.log(`Replacing selection from line ${editor.selection.start.line} to ${editor.selection.end.line}`);
                                            editBuilder.replace(editor.selection, message.text);
                                        }
                                    }).then(success => {
                                        if (success) {
                                            // Inform the user
                                            vscode.window.setStatusBarMessage('Code applied to editor', 3000);
                                            console.log("Code successfully applied to editor");
                                            
                                            // Send confirmation back to webview
                                            try {
                                                this.panel.webview.postMessage({
                                                    command: 'codeApplied',
                                                    success: true
                                                });
                                            } catch (err) {
                                                console.error(`Error sending confirmation to webview: ${err}`);
                                            }
                                        } else {
                                            vscode.window.showErrorMessage('Failed to apply code to editor');
                                            console.error("Failed to apply code to editor - edit returned false");
                                        }
                                    }).catch(err => {
                                        console.error(`Error in editor.edit promise: ${err}`);
                                        vscode.window.showErrorMessage(`Error applying code: ${err}`);
                                    });
                                } catch (err) {
                                    console.error(`Exception applying code to editor: ${err}`);
                                    vscode.window.showErrorMessage(`Exception applying code: ${err}`);
                                }
                            }
                        } else {
                            console.error('Apply code to editor called with empty text');
                        }
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(ollamaService: OllamaService) {
        // Determine the right column for the chat panel
        let column = vscode.ViewColumn.Beside; // Default to beside
        
        // If we have an active text editor, create the chat panel beside it
        // This ensures side-by-side layout
        if (vscode.window.activeTextEditor) {
            column = vscode.ViewColumn.Beside;
        } else {
            column = vscode.ViewColumn.One; // No editor open, use the first column
        }
        
        // Check if panel already exists
        if (OllamaPanel.currentPanel) {
            OllamaPanel.currentPanel.panel.reveal(column);
            return;
        }

        // Create panel with side-by-side option
        const panel = vscode.window.createWebviewPanel(
            'ollamaChat',
            'Ollama Chat',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.resolve(__dirname, '..')), // Allow access to the parent directory
                    vscode.Uri.joinPath(vscode.Uri.file(path.resolve(__dirname, '..')), 'media'),
                    vscode.Uri.joinPath(vscode.Uri.file(path.resolve(__dirname, '..')), 'src')
                ]
            }
        );

        OllamaPanel.currentPanel = new OllamaPanel(panel, ollamaService);
    }

    // Session management methods
    private async loadSessions() {
        try {
            // Use memory store for now
            const sessionData = this.getSessionsFromStorage();
            if (sessionData && Array.isArray(sessionData)) {
                this.sessions = sessionData;
                console.log(`Loaded ${this.sessions.length} chat sessions`);
            } else {
                this.sessions = [];
            }
            
            // Initialize with a default session if none exists
            if (this.sessions.length === 0) {
                await this.createNewSession();
            }
            
            // Set current session to the most recently used
            const mostRecent = this.sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            this.currentSessionId = mostRecent.id;
            
            // Notify webview of sessions
            this.sendSessionsToWebview();
            
            // If the current session has a model, set it
            if (this.currentSessionId) {
                const session = this.getSessionById(this.currentSessionId);
                if (session && session.modelName) {
                    this.currentModel = session.modelName;
                    this.panel.webview.postMessage({
                        command: 'setModel',
                        model: session.modelName
                    });
                }
            }
        } catch (error) {
            console.error('Error loading sessions:', error);
            // Create a default session if loading fails
            await this.createNewSession();
        }
    }
    
    // Memory-based storage for sessions since we don't have access to globalState
    private static sessionsMemoryStore: ChatSession[] = [];
    
    private getSessionsFromStorage(): ChatSession[] {
        return OllamaPanel.sessionsMemoryStore;
    }
    
    private async saveSessions() {
        try {
            // Store sessions in memory 
            OllamaPanel.sessionsMemoryStore = [...this.sessions];
        } catch (error) {
            console.error('Error saving sessions:', error);
        }
    }
    
    private async createNewSession(modelName?: string) {
        // Generate a unique ID
        const id = Date.now().toString();
        
        // Create new session
        const newSession: ChatSession = {
            id,
            name: `Chat ${this.sessions.length + 1}`,
            modelName: modelName || this.currentModel || '',
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        
        // Add to sessions list
        this.sessions.push(newSession);
        
        // Set as current session
        this.currentSessionId = id;
        
        // Save sessions
        await this.saveSessions();
        
        // Update webview
        this.sendSessionsToWebview();
        
        return id;
    }
    
    private getSessionById(id: string): ChatSession | undefined {
        return this.sessions.find(s => s.id === id);
    }
    
    private async switchToSession(id: string) {
        // Find the session
        const session = this.getSessionById(id);
        if (!session) {
            return;
        }
        
        // Set current session
        this.currentSessionId = id;
        
        // Update session last used time
        session.updatedAt = Date.now();
        
        // Save sessions
        await this.saveSessions();
        
        // Set model from session
        if (session.modelName) {
            this.currentModel = session.modelName;
            this.panel.webview.postMessage({
                command: 'setModel',
                model: session.modelName
            });
        }
        
        // Send messages to webview
        this.panel.webview.postMessage({
            command: 'loadSessionMessages',
            messages: session.messages
        });
    }
    
    private async recordMessage(role: 'user' | 'assistant', content: string) {
        // Get current session
        const session = this.getSessionById(this.currentSessionId!);
        if (!session) {
            return;
        }
        
        // Add message
        session.messages.push({
            role,
            content,
            timestamp: Date.now()
        });
        
        // Update session last used time
        session.updatedAt = Date.now();
        
        // Update model if not set
        if (!session.modelName && this.currentModel) {
            session.modelName = this.currentModel;
        }
        
        // Save sessions
        await this.saveSessions();
    }
    
    private async renameSession(id: string, newName: string) {
        // Find the session
        const session = this.getSessionById(id);
        if (!session) {
            return;
        }
        
        // Update session name
        session.name = newName.trim() || `Chat ${this.sessions.indexOf(session) + 1}`;
        
        // Save sessions
        await this.saveSessions();
        
        // Update webview
        this.sendSessionsToWebview();
    }
    
    private async deleteSession(id: string) {
        // Find session index
        const index = this.sessions.findIndex(s => s.id === id);
        if (index === -1) {
            return;
        }
        
        // Remove session
        this.sessions.splice(index, 1);
        
        // If current session was deleted, switch to another session
        if (this.currentSessionId === id) {
            if (this.sessions.length === 0) {
                // Create a new session if none left
                await this.createNewSession();
            } else {
                // Switch to most recent session
                const mostRecent = this.sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
                await this.switchToSession(mostRecent.id);
            }
        } else {
            // Just save the updated sessions list
            await this.saveSessions();
            this.sendSessionsToWebview();
        }
    }
    
    private sendSessionsToWebview() {
        this.panel.webview.postMessage({
            command: 'updateSessions',
            sessions: this.sessions.map(s => ({
                id: s.id,
                name: s.name,
                modelName: s.modelName,
                messageCount: s.messages.length,
                lastUpdated: s.updatedAt
            })),
            currentSessionId: this.currentSessionId
        });
    }
    
    private async getAndSendAvailableModels() {
        try {
            // Get available models from the service
            const models = await this.ollamaService.listModels();
            
            // Format models for the webview
            const formattedModels = models.map(model => ({
                name: model.name,
                details: `${model.size ? Math.round(model.size / (1024 * 1024 * 1024)) + 'GB' : 'Unknown size'}`
            }));
            
            // Send to webview
            this.panel.webview.postMessage({
                command: 'updateModels',
                models: formattedModels,
                currentModel: this.currentModel
            });
        } catch (error) {
            console.error('Error fetching models:', error);
            this.panel.webview.postMessage({
                command: 'error',
                message: `Failed to load models: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }
    
    public async setModel(modelName: string) {
        this.currentModel = modelName;
        
        // Update the current session with this model
        if (this.currentSessionId) {
            const session = this.getSessionById(this.currentSessionId);
            if (session) {
                session.modelName = modelName;
                await this.saveSessions();
            }
        }
        
        this.panel.webview.postMessage({
            command: 'setModel',
            model: modelName
        });
    }
    
    // Method to send prompt directly to the panel
    public async sendPrompt(promptText: string) {
        if (!this.currentModel) {
            vscode.window.showErrorMessage('Please select a model first');
            return;
        }
        
        // Ensure we have a current session
        if (!this.currentSessionId) {
            await this.createNewSession(this.currentModel);
        }
        
        // Record the user message
        await this.recordMessage('user', promptText);
        
        // Get fresh project context before sending prompt
        const projectContext = await this.getProjectContext(true); // Force refresh
        console.log('Current project context for prompt:', JSON.stringify({
            hasActiveFile: Boolean(projectContext.activeFile),
            hasSelection: Boolean(projectContext.selection),
            selectionLength: projectContext.selection ? projectContext.selection.length : 0
        }));
        
        // Send prompt to the webview with context flag enabled
        this.panel.webview.postMessage({
            command: 'injectPrompt', 
            text: promptText,
            includeContext: true // Enable context for all prompts
        });
    }
    
    // Method to add a reference to the chat without sending it as a prompt
    public async addReference(referenceText: string) {
        // Make sure the panel is ready
        if (!this.panel) {
            throw new Error('Panel not initialized');
        }
        
        // Ensure we have a current session
        if (!this.currentSessionId) {
            // Create a default session to store references
            await this.createNewSession(this.currentModel);
        }
        
        // Send reference to the webview UI
        this.panel.webview.postMessage({
            command: 'addReference',
            text: referenceText
        });
    }

    public dispose() {
        // Clean up watchers
        if (this.contextWatcher) {
            this.contextWatcher.dispose();
            this.contextWatcher = null;
        }
        
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = null;
        }
        
        // Clean up response processing
        if (this.chunkUpdateTimer) {
            clearTimeout(this.chunkUpdateTimer);
            this.chunkUpdateTimer = null;
        }
        
        // Abort any in-progress request
        if (this.currentRequestController) {
            try {
                this.currentRequestController.abort();
                this.currentRequestController = null;
            } catch (e) {
                console.error('Error aborting request during disposal:', e);
            }
        }
        
        // Clear up memory
        this.responseChunks = [];
        this.currentPromptId = null;
        this.fileCache = null;
        
        OllamaPanel.currentPanel = undefined;
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
        
        console.log('OllamaPanel disposed and resources cleaned up');
    }
    
    private setupProjectWatchers() {
        // Watch for active editor changes
        this.contextWatcher = vscode.window.onDidChangeActiveTextEditor(async () => {
            const context = await this.getProjectContext();
            this.panel.webview.postMessage({
                command: 'projectContext',
                context
            });
        });
        
        // Watch for file changes in the workspace
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
            
            // File created
            this.fileWatcher.onDidCreate(() => this.notifyContextChange());
            
            // File changed
            this.fileWatcher.onDidChange(() => this.notifyContextChange());
            
            // File deleted
            this.fileWatcher.onDidDelete(() => this.notifyContextChange());
            
            this.disposables.push(this.fileWatcher);
        }
    }
    
    public async notifyContextChange() {
        // Throttle updates to avoid spamming
        if (this._throttleTimeout) {
            clearTimeout(this._throttleTimeout);
        }
        
        this._throttleTimeout = setTimeout(async () => {
            const context = await this.getProjectContext();
            this.panel.webview.postMessage({
                command: 'projectContextChanged',
                context
            });
            
            // Log context update for debugging
            console.log('Context updated with selection:', 
                Boolean(context.selection), 
                context.selection ? `(${context.selection.length} chars)` : '');
                
            this._throttleTimeout = null;
        }, 300); // Reduced throttle time for more responsive updates
    }
    
    private _throttleTimeout: NodeJS.Timeout | null = null;
    
    // File cache to avoid repeated file scans
    private fileCache: { files: string[], timestamp: number } | null = null;
    private readonly FILE_CACHE_TTL = 60 * 1000; // 60 seconds cache for files
    private readonly MAX_FILES = 300; // Maximum number of files to include
    private readonly MAX_FILE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - only include recently modified files
    
    private async getProjectContext(forceRefresh = false): Promise<ProjectContext> {
        const context: ProjectContext = {
            files: [],
            activeFile: null,
            selection: null,
            workspaceFolders: []
        };
        
        // Get workspace folders
        if (vscode.workspace.workspaceFolders) {
            context.workspaceFolders = vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath);
            
            // Use file cache if available and recent, unless force refresh requested
            const now = Date.now();
            if (!forceRefresh && this.fileCache && (now - this.fileCache.timestamp < this.FILE_CACHE_TTL)) {
                context.files = [...this.fileCache.files]; // Clone the array
                console.log(`Using cached file list (${context.files.length} files)`);
            } else {
                // Otherwise scan for files (with improved performance)
                await this.updateFileCache();
                if (this.fileCache) {
                    context.files = [...this.fileCache.files];
                }
            }
        }
        
        // Get active file - always fresh data
        if (vscode.window.activeTextEditor) {
            context.activeFile = vscode.window.activeTextEditor.document.uri.fsPath;
            
            // Get selected text
            const selection = vscode.window.activeTextEditor.selection;
            if (!selection.isEmpty) {
                // Only include selection if it's not too large (improve memory usage)
                const document = vscode.window.activeTextEditor.document;
                const selectionText = document.getText(selection);
                if (selectionText.length <= 5000) { // Limit selection size
                    context.selection = selectionText;
                } else {
                    // If selection is too large, truncate it and add a note
                    context.selection = selectionText.substring(0, 5000) + 
                        `\n\n[Selection truncated - ${selectionText.length} characters total]`;
                }
                
                // Add selection range information for later use
                (context as any).selectionRange = {
                    start: { line: selection.start.line, character: selection.start.character },
                    end: { line: selection.end.line, character: selection.end.character }
                };
            }
        }
        
        return context;
    }
    
    /**
     * Optimized file scanning that collects only the most relevant files
     * - Limits total number of files
     * - Prioritizes recently modified files
     * - Filters by extension and patterns more efficiently
     */
    private async updateFileCache(): Promise<void> {
        console.log('Updating file cache...');
        
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            this.fileCache = { files: [], timestamp: Date.now() };
            return;
        }
        
        try {
            // Get all file pattern configurations
            const configFilePatterns = vscode.workspace.getConfiguration('ollama').get('filePatterns') as string[] || 
                ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.py', '**/*.html', '**/*.css', '**/*.json', '**/README.md'];
            
            // Get excluded patterns from config
            const excludePatterns = vscode.workspace.getConfiguration('ollama').get('excludePatterns') as string[] || 
                ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
            
            const allFiles: { path: string, mtime: number }[] = [];
            
            // Process each workspace folder
            for (const folder of vscode.workspace.workspaceFolders) {
                // Join patterns for glob
                const patternString = '{' + configFilePatterns.join(',') + '}';
                const pattern = new vscode.RelativePattern(folder, patternString);
                
                // Find files with exclusions as glob pattern - limit to 500 per workspace folder
                const files = await vscode.workspace.findFiles(
                    pattern, 
                    '{' + excludePatterns.join(',') + '}', 
                    500 
                );
                
                // Get file modification times to prioritize recent files
                const fileInfos = await Promise.all(
                    files.map(async file => {
                        try {
                            const stat = await vscode.workspace.fs.stat(file);
                            return { 
                                path: file.fsPath,
                                mtime: stat.mtime // File modification time 
                            };
                        } catch (e) {
                            // If stats fail, use current time as fallback
                            return { path: file.fsPath, mtime: Date.now() };
                        }
                    })
                );
                
                allFiles.push(...fileInfos);
            }
            
            // Only include files modified within the last MAX_FILE_AGE_MS
            const now = Date.now();
            const recentFiles = allFiles.filter(f => (now - f.mtime) < this.MAX_FILE_AGE_MS);
            
            // Sort by most recently modified
            recentFiles.sort((a, b) => b.mtime - a.mtime);
            
            // Limit to MAX_FILES 
            const trimmedFiles = recentFiles.slice(0, this.MAX_FILES).map(f => f.path);
            
            console.log(`File cache updated: ${trimmedFiles.length} files included out of ${allFiles.length} total`);
            
            // Update the cache
            this.fileCache = {
                files: trimmedFiles,
                timestamp: Date.now()
            };
        } catch (error) {
            console.error('Error updating file cache:', error);
            // If caching fails, set empty cache with short TTL
            this.fileCache = { 
                files: [],
                timestamp: Date.now() - (this.FILE_CACHE_TTL - 5000) // Expire in 5 seconds on error
            };
        }
    }
    
    // Limit for total prompt size to prevent out of memory errors and improve performance
    private readonly MAX_PROMPT_SIZE = 8000; // Reduced to improve model responsiveness
    private readonly MAX_FILE_SIZE = 4000; // Characters for a single file - reduced for better performance
    private readonly MAX_SELECTION_SIZE = 3000; // Characters for selected code - reduced for better performance
    
    // Cache for file contents to avoid repeated file reads
    private fileContentCache = new Map<string, {content: string, timestamp: number}>();
    private readonly FILE_CACHE_TTL = 60000; // 60 seconds TTL for file cache
    
    /**
     * Create an enhanced prompt with context information
     * Optimized to handle large contexts more efficiently with:
     * - Smart caching of file content
     * - Improved truncation strategies for better context retention
     * - Better prioritization of relevant content
     * - Memory-efficient operation
     */
    private createEnhancedPrompt(userPrompt: string, context: ProjectContext): string {
        // Start with just the user prompt (fallback)
        const promptParts: {type: string, content: string, priority: number}[] = [];
        let contextAdded = false;
        
        // Calculate available space for context
        const userPromptWithFormatting = `USER QUERY: ${userPrompt}`;
        const availableSpace = this.MAX_PROMPT_SIZE - userPromptWithFormatting.length - 100; // Buffer
        
        // Skip context gathering if no space available
        if (availableSpace <= 200) {
            return userPrompt;
        }
        
        // If there's selected text, prioritize including it
        if (context.selection) {
            const selection = this.truncateContentSmartly(
                context.selection, 
                this.MAX_SELECTION_SIZE,
                'code'
            );
            
            promptParts.push({
                type: 'selection',
                content: `SELECTED CODE:\n\`\`\`\n${selection}\n\`\`\`\n\n`,
                priority: 1 // Highest priority
            });
        }
        
        // If there's an active file but no selection, include the file content
        else if (context.activeFile) {
            // Try to get content from cache first
            const cachedContent = this.getCachedFileContent(context.activeFile);
            
            if (cachedContent) {
                const fileExt = path.extname(context.activeFile).replace('.', '');
                const content = this.truncateContentSmartly(
                    cachedContent, 
                    this.MAX_FILE_SIZE,
                    'file'
                );
                
                promptParts.push({
                    type: 'file',
                    content: `CURRENT FILE (${path.basename(context.activeFile)}):\n\`\`\`${fileExt}\n${content}\n\`\`\`\n\n`,
                    priority: 2 // Second priority
                });
            } else {
                // If can't read the file, just use the path
                promptParts.push({
                    type: 'file-reference',
                    content: `CURRENT FILE: ${context.activeFile}\n\n`,
                    priority: 4 // Lower priority
                });
            }
        }
        
        // Add workspace context summary if available
        if (context.workspaceFolders && context.workspaceFolders.length > 0) {
            const fileCount = context.files ? context.files.length : 0;
            const workspaceInfo = `WORKSPACE: ${context.workspaceFolders.length} folder(s), ${fileCount} files indexed\n` +
                `PROJECT ROOT: ${context.workspaceFolders[0]}\n\n`;
            
            promptParts.push({
                type: 'workspace-summary',
                content: workspaceInfo,
                priority: 5 // Low priority
            });
            
            // Only include project files if the user is asking about configuration/setup
            const needsProjectContext = 
                userPrompt.toLowerCase().includes('config') ||
                userPrompt.toLowerCase().includes('setup') ||
                userPrompt.toLowerCase().includes('package') ||
                userPrompt.toLowerCase().includes('dependency') ||
                userPrompt.toLowerCase().includes('project');
                
            if (needsProjectContext && context.files && context.files.length > 0) {
                // Only look for truly important files
                const importantFiles = context.files.filter(file => {
                    const filename = path.basename(file).toLowerCase();
                    return filename === 'package.json' || 
                           filename === 'readme.md';
                }).slice(0, 1); // Limit to 1 most critical file
                
                for (const file of importantFiles) {
                    const cachedContent = this.getCachedFileContent(file);
                    
                    if (cachedContent) {
                        const fileExt = path.extname(file).replace('.', '');
                        const filename = path.basename(file);
                        
                        // Stricter truncation for project files
                        const content = this.truncateContentSmartly(
                            cachedContent, 
                            this.MAX_FILE_SIZE / 3, // Even shorter limit for context files
                            'config'
                        );
                        
                        promptParts.push({
                            type: 'project-file',
                            content: `PROJECT FILE (${filename}):\n\`\`\`${fileExt}\n${content}\n\`\`\`\n\n`,
                            priority: 3 // Medium priority
                        });
                    }
                }
            }
        }
        
        // Sort parts by priority (lowest number = highest priority)
        promptParts.sort((a, b) => a.priority - b.priority);
        
        // Build the prompt within size constraints
        let contextContent = "";
        let availableChars = availableSpace;
        
        for (const part of promptParts) {
            if (part.content.length <= availableChars) {
                contextContent += part.content;
                availableChars -= part.content.length;
                contextAdded = true;
            } else if (availableChars > 200) {
                // Include a smartly truncated version
                const truncated = part.content.substring(0, availableChars - 100) + 
                    `\n\n... [truncated due to size limits] ...\n\n`;
                contextContent += truncated;
                availableChars = 0;
                contextAdded = true;
                break;
            } else {
                // No more space
                break;
            }
        }
        
        // Finalize the prompt with context and user query
        let enhancedPrompt = userPrompt;
        if (contextAdded) {
            enhancedPrompt = `${contextContent}USER QUERY: ${userPrompt}`;
        }
        
        return enhancedPrompt;
    }
    
    /**
     * Get file content with caching to avoid repeated file system reads
     */
    private getCachedFileContent(filePath: string): string | null {
        const now = Date.now();
        
        // Check if we have a cached version that's still valid
        if (this.fileContentCache.has(filePath)) {
            const cached = this.fileContentCache.get(filePath)!;
            if (now - cached.timestamp < this.FILE_CACHE_TTL) {
                return cached.content;
            }
        }
        
        // No valid cache, read from file
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Cache the file content
            this.fileContentCache.set(filePath, {
                content,
                timestamp: now
            });
            
            // Manage cache size to prevent memory issues
            if (this.fileContentCache.size > 10) {
                // Find and remove oldest entry
                let oldestKey = filePath;
                let oldestTime = now;
                
                this.fileContentCache.forEach((value, key) => {
                    if (value.timestamp < oldestTime) {
                        oldestTime = value.timestamp;
                        oldestKey = key;
                    }
                });
                
                if (oldestKey !== filePath) {
                    this.fileContentCache.delete(oldestKey);
                }
            }
            
            return content;
        } catch (error) {
            console.log(`Error reading file ${filePath}:`, error);
            return null;
        }
    }
    
    /**
     * Smarter content truncation that preserves more structure
     * Works better than simple middle truncation for code/config files
     */
    private truncateContentSmartly(content: string, maxSize: number, contentType: 'code' | 'file' | 'config'): string {
        if (content.length <= maxSize) {
            return content;
        }
        
        if (contentType === 'config') {
            // For config files, just keep the beginning which usually has the most important info
            return content.substring(0, maxSize) + 
                `\n\n... [${content.length - maxSize} characters truncated] ...`;
        }
        
        if (contentType === 'code') {
            // For code, try to keep imports/includes and some beginning and end
            const lines = content.split('\n');
            
            // Find all import/include lines at the beginning
            const importLines: string[] = [];
            let firstNonImportLine = 0;
            
            for (let i = 0; i < Math.min(30, lines.length); i++) {
                const line = lines[i].trim();
                if (line.startsWith('import ') || 
                    line.startsWith('from ') || 
                    line.startsWith('#include') || 
                    line.startsWith('using ') ||
                    line.startsWith('require ')) {
                    importLines.push(lines[i]);
                } else if (importLines.length > 0) {
                    // We found non-import line after imports
                    firstNonImportLine = i;
                    break;
                }
            }
            
            // Determine how much space is left after including imports
            const importsText = importLines.join('\n');
            const remainingSpace = maxSize - importsText.length - 50; // 50 chars for ellipsis
            
            if (remainingSpace <= 0) {
                // Not enough space after imports, just truncate normally
                return content.substring(0, maxSize/2) + 
                    `\n\n... [${content.length - maxSize} chars truncated] ...\n\n` +
                    content.substring(content.length - maxSize/2);
            }
            
            // Split remaining space between beginning and end
            const halfRemaining = Math.floor(remainingSpace / 2);
            
            // Get content after imports for beginning
            const beginContent = lines.slice(firstNonImportLine, 
                Math.min(lines.length, firstNonImportLine + 20)).join('\n').substring(0, halfRemaining);
                
            // Get end content
            const endContent = lines.slice(Math.max(0, lines.length - 20)).join('\n').substring(0, halfRemaining);
            
            // Combine with imports
            return importsText + '\n\n' + beginContent + 
                `\n\n... [${content.length - (importsText.length + beginContent.length + endContent.length)} chars truncated] ...\n\n` +
                endContent;
        }
        
        // Default truncation strategy for general files
        return content.substring(0, maxSize/2) + 
            `\n\n... [${content.length - maxSize} characters truncated] ...\n\n` +
            content.substring(content.length - maxSize/2);
    }
    
    private async applyEdit(filePath: string, edit: { range: [number, number, number, number], text: string }, showDiff = true) {
        try {
            // Convert file path to URI
            const uri = vscode.Uri.file(filePath);
            
            // Open the document
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Create the range for the edit
            const range = new vscode.Range(
                new vscode.Position(edit.range[0], edit.range[1]),
                new vscode.Position(edit.range[2], edit.range[3])
            );
            
            // Get the original text for diff view
            const originalText = document.getText(range);
            
            // If showDiff is true, show a diff view before applying
            if (showDiff && originalText !== edit.text) {
                // Show diff and ask for confirmation
                const diffResult = await this.showDiffAndConfirm(document, range, originalText, edit.text);
                
                if (diffResult === 'cancel') {
                    // User cancelled the edit
                    this.panel.webview.postMessage({
                        command: 'editApplied',
                        filePath,
                        success: false,
                        cancelled: true,
                        error: 'Edit cancelled by user'
                    });
                    return;
                }
            }
            
            // Apply the edit
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.replace(uri, range, edit.text);
            
            // Apply the edit
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            
            if (success) {
                // Show the file with the edit in the editor column
                // Use ViewColumn.One to ensure it opens in the editor column
                const textEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
                
                // Highlight the edited range
                textEditor.selection = new vscode.Selection(
                    range.start, 
                    range.end
                );
                
                // Reveal the edited range in the editor
                textEditor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                
                // Make sure the panel is still visible beside the editor
                this.panel.reveal(vscode.ViewColumn.Beside, true);
                
                this.panel.webview.postMessage({
                    command: 'editApplied',
                    filePath,
                    success: true
                });
                
                // Notify user about the successful edit
                vscode.window.showInformationMessage(`Successfully applied edit to ${path.basename(filePath)}`);
            } else {
                this.panel.webview.postMessage({
                    command: 'editApplied',
                    filePath,
                    success: false,
                    error: 'Failed to apply edit'
                });
            }
        } catch (error) {
            this.panel.webview.postMessage({
                command: 'editApplied',
                filePath,
                success: false,
                error: `Error: ${error instanceof Error ? error.message : String(error)}`
            });
            vscode.window.showErrorMessage(`Failed to apply edit: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    // Shows a diff view and asks for confirmation
    private async showDiffAndConfirm(
        document: vscode.TextDocument, 
        range: vscode.Range, 
        originalText: string, 
        newText: string
    ): Promise<'apply' | 'cancel'> {
        // Create temporary files for the diff
        const fileName = path.basename(document.fileName);
        // Use runtime require for OS-specific functionality
        const tempDir = require('os').tmpdir();
        const originalFile = path.join(tempDir, `ollama-original-${fileName}`);
        const newFile = path.join(tempDir, `ollama-new-${fileName}`);
        
        try {
            // Write the files for comparison
            fs.writeFileSync(originalFile, originalText);
            fs.writeFileSync(newFile, newText);
            
            // Create URIs for diff
            const originalUri = vscode.Uri.file(originalFile);
            const newUri = vscode.Uri.file(newFile);
            
            // Show diff
            await vscode.commands.executeCommand('vscode.diff', 
                originalUri, 
                newUri, 
                `${fileName}: Original ↔ Modified`, 
                { viewColumn: vscode.ViewColumn.One }
            );
            
            // Ask for confirmation
            const result = await vscode.window.showInformationMessage(
                'Apply this code change?', 
                { modal: true },
                'Apply', 'Cancel'
            );
            
            // Clean up temp files
            try {
                fs.unlinkSync(originalFile);
                fs.unlinkSync(newFile);
            } catch (e) {
                console.error('Failed to delete temp files:', e);
            }
            
            return result === 'Apply' ? 'apply' : 'cancel';
        } catch (error) {
            console.error('Error showing diff:', error);
            
            // Clean up temp files
            try {
                if (fs.existsSync(originalFile)) fs.unlinkSync(originalFile);
                if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
            } catch (e) {
                console.error('Failed to delete temp files:', e);
            }
            
            // Default to asking for confirmation without diff
            const result = await vscode.window.showInformationMessage(
                'Apply this code change? (Diff view failed)',
                { modal: true },
                'Apply', 'Cancel'
            );
            
            return result === 'Apply' ? 'apply' : 'cancel';
        }
    }
    
    // Apply multiple edits at once, with option to bypass individual confirmations
    private async applyMultipleEdits(
        edits: Array<{
            filePath: string;
            edit: { range: [number, number, number, number]; text: string };
        }>,
        skipConfirmation = false
    ) {
        if (edits.length === 0) {
            vscode.window.showInformationMessage('No code changes to apply.');
            return;
        }
        
        // If skipping confirmation, ask once for all changes
        let applyAll = skipConfirmation;
        
        if (!applyAll) {
            const result = await vscode.window.showInformationMessage(
                `Apply all ${edits.length} code changes?`,
                { modal: true },
                'Apply All', 'Review Each', 'Cancel'
            );
            
            if (result === 'Cancel') {
                return;
            }
            
            applyAll = result === 'Apply All';
        }
        
        // Track results
        const results: { 
            filePath: string; 
            success: boolean; 
            message?: string;
        }[] = [];
        
        // Apply each edit
        for (const edit of edits) {
            try {
                await this.applyEdit(edit.filePath, edit.edit, !applyAll);
                results.push({
                    filePath: edit.filePath,
                    success: true
                });
            } catch (error) {
                results.push({
                    filePath: edit.filePath,
                    success: false,
                    message: error instanceof Error ? error.message : String(error)
                });
            }
        }
        
        // Report results
        const successful = results.filter(r => r.success).length;
        this.panel.webview.postMessage({
            command: 'multipleEditsApplied',
            results,
            summary: `Applied ${successful} of ${edits.length} changes`
        });
        
        // Show summary to user
        if (successful === edits.length) {
            vscode.window.showInformationMessage(`Successfully applied all ${edits.length} code changes.`);
        } else {
            vscode.window.showWarningMessage(
                `Applied ${successful} of ${edits.length} code changes. Some changes could not be applied.`,
                'Show Details'
            ).then(selection => {
                if (selection === 'Show Details') {
                    // Show detailed results in output channel
                    const outputChannel = vscode.window.createOutputChannel('Ollama Code Changes');
                    outputChannel.appendLine('--- Code Change Results ---');
                    results.forEach(r => {
                        outputChannel.appendLine(
                            `${r.success ? '✓' : '✗'} ${r.filePath}${r.message ? ': ' + r.message : ''}`
                        );
                    });
                    outputChannel.show();
                }
            });
        }
    }
    
    /**
     * Save generated code to a file in the project directory
     * @param code The code to save
     * @param language The programming language of the code
     */
    // Create a new file with the given code when no editor is open
    private async createNewFileWithCode(code: string, fileExtension: string = '.txt'): Promise<boolean> {
        try {
            // Create a timestamp for the filename
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
            
            // Create a default filename
            const defaultFileName = `generated_${timestamp}${fileExtension}`;
            
            // Ask the user for a file name
            const fileName = await vscode.window.showInputBox({
                prompt: 'Enter a filename for the code',
                value: defaultFileName,
                validateInput: input => {
                    // Basic validation to avoid invalid file names
                    if (!input || /[<>:"/\\|?*]/.test(input)) {
                        return 'Filename contains invalid characters';
                    }
                    return null;
                }
            });
            
            if (!fileName) {
                // User canceled the operation
                console.log("User canceled file name input");
                return false;
            }
            
            // Check if we have a workspace open
            const workspaceFolders = vscode.workspace.workspaceFolders;
            let filePath: string;
            
            if (workspaceFolders && workspaceFolders.length > 0) {
                // We have a workspace, so create in proper location
                const rootPath = workspaceFolders[0].uri.fsPath;
                
                // Create a "generated" folder at the workspace root
                const targetDir = path.join(rootPath, 'generated');
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
                
                filePath = path.join(targetDir, fileName);
            } else {
                // No workspace, create in temp directory
                const tempDir = path.join(os.tmpdir(), 'vscode-ollama-generated');
                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }
                
                filePath = path.join(tempDir, fileName);
            }
            
            // Write the code to the file
            fs.writeFileSync(filePath, code, 'utf8');
            console.log(`Created new file at: ${filePath}`);
            
            // Open the file in the editor
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
            
            // Show success message
            vscode.window.showInformationMessage(`Created file: ${fileName}`);
            
            return true;
        } catch (error) {
            console.error(`Error creating new file: ${error}`);
            vscode.window.showErrorMessage(`Failed to create new file: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private async saveCodeToFile(code: string, language: string) {
        try {
            // Get the root workspace folder
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                throw new Error('No workspace folder is open');
            }
            
            const rootPath = workspaceFolders[0].uri.fsPath;
            
            // Determine a suitable file extension based on the language
            const fileExtension = this.getFileExtensionForLanguage(language);
            
            // Create a timestamp for the filename
            const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').split('.')[0];
            
            // Create a default filename
            const defaultFileName = `generated_${timestamp}${fileExtension}`;
            
            // Ask the user for a file name
            const fileName = await vscode.window.showInputBox({
                prompt: 'Enter a filename for your generated code',
                value: defaultFileName,
                validateInput: input => {
                    // Basic validation to avoid invalid file names
                    if (!input || /[<>:"/\\|?*]/.test(input)) {
                        return 'Filename contains invalid characters';
                    }
                    return null;
                }
            });
            
            if (!fileName) {
                // User canceled the operation
                return;
            }
            
            // Determine the target directory
            // First try to find a suitable directory based on language
            let targetDir = this.getSuggestedDirectoryForLanguage(rootPath, language);
            
            // If no specific directory found, use the root workspace
            if (!targetDir) {
                // Create a "generated" folder at the workspace root
                targetDir = path.join(rootPath, 'generated');
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }
            }
            
            // Create the full file path
            const filePath = path.join(targetDir, fileName);
            
            // Create the file
            await this.createFile(filePath, code);
            
            // Show a confirmation message with an option to open the file
            const openFile = await vscode.window.showInformationMessage(
                `Saved file to: ${vscode.workspace.asRelativePath(filePath)}`,
                'Open File'
            );
            
            if (openFile === 'Open File') {
                const document = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(document);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save code to file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Get the appropriate file extension for a programming language
     * @param language The programming language
     * @returns The file extension including the dot
     */
    private getFileExtensionForLanguage(language: string): string {
        const normalizedLanguage = (language || '').toLowerCase().trim();
        
        const languageExtensionMap: Record<string, string> = {
            'javascript': '.js',
            'js': '.js',
            'typescript': '.ts',
            'ts': '.ts',
            'python': '.py',
            'py': '.py',
            'java': '.java',
            'c': '.c',
            'cpp': '.cpp',
            'c++': '.cpp',
            'csharp': '.cs',
            'cs': '.cs',
            'go': '.go',
            'rust': '.rs',
            'ruby': '.rb',
            'php': '.php',
            'html': '.html',
            'css': '.css',
            'scss': '.scss',
            'sass': '.sass',
            'json': '.json',
            'xml': '.xml',
            'markdown': '.md',
            'md': '.md',
            'shell': '.sh',
            'sh': '.sh',
            'bash': '.sh',
            'zsh': '.sh',
            'sql': '.sql',
            'jsx': '.jsx',
            'tsx': '.tsx',
            'swift': '.swift',
            'kotlin': '.kt',
            'yaml': '.yaml',
            'yml': '.yml',
            'dart': '.dart',
            'lua': '.lua',
            'r': '.r',
            'scala': '.scala'
        };
        
        return languageExtensionMap[normalizedLanguage] || '.txt';
    }
    
    /**
     * Try to find a suitable directory in the project for a given language
     * @param rootPath The workspace root path
     * @param language The programming language
     * @returns A suggested directory path or null if none found
     */
    private getSuggestedDirectoryForLanguage(rootPath: string, language: string): string | null {
        const normalizedLanguage = (language || '').toLowerCase().trim();
        
        // Common directory patterns for different languages
        const directoryPatterns: Record<string, string[]> = {
            'javascript': ['src/js', 'src/javascript', 'js', 'javascript', 'src'],
            'typescript': ['src/ts', 'src/typescript', 'ts', 'typescript', 'src'],
            'python': ['src/python', 'python', 'py', 'src'],
            'java': ['src/main/java', 'src/java', 'java', 'src'],
            'c': ['src/c', 'c', 'src'],
            'cpp': ['src/cpp', 'cpp', 'src/c++', 'c++', 'src'],
            'csharp': ['src/cs', 'cs', 'src/csharp', 'csharp', 'src'],
            'go': ['src/go', 'go', 'src'],
            'rust': ['src/rust', 'rust', 'src'],
            'html': ['src/html', 'html', 'public', 'static', 'src'],
            'css': ['src/css', 'css', 'styles', 'public/css', 'src'],
            'scss': ['src/scss', 'scss', 'styles', 'src'],
        };
        
        const patterns = directoryPatterns[normalizedLanguage] || ['src', 'lib', 'source'];
        
        // Try to find an existing directory matching one of the patterns
        for (const pattern of patterns) {
            const dirPath = path.join(rootPath, pattern);
            if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
                return dirPath;
            }
        }
        
        return null;
    }
    
    private async createFile(filePath: string, content: string) {
        try {
            console.log(`Creating file at: ${filePath}`);
            
            // Make sure directory exists
            const directory = path.dirname(filePath);
            if (!fs.existsSync(directory)) {
                console.log(`Creating directory: ${directory}`);
                fs.mkdirSync(directory, { recursive: true });
            }
            
            // Write the file
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`File written successfully: ${filePath}`);
            
            // Open the file
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(document);
            console.log(`File opened in editor`);
            
            // Send success message to webview
            this.panel.webview.postMessage({
                command: 'fileCreated',
                filePath,
                success: true
            });
        } catch (error) {
            console.error(`Error creating file: ${error instanceof Error ? error.message : String(error)}`);
            // Send error message to webview
            this.panel.webview.postMessage({
                command: 'fileCreated',
                filePath,
                success: false,
                error: `Error: ${error instanceof Error ? error.message : String(error)}`
            });
            
            // Show error to user
            vscode.window.showErrorMessage(`Failed to create file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    private async openFile(filePath: string, selectionRange?: [number, number, number, number]) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File does not exist: ${filePath}`);
            }
            
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const editor = await vscode.window.showTextDocument(document);
            
            // If selection is provided, select that range
            if (selectionRange) {
                try {
                    // Make sure selection is within document bounds
                    const docLineCount = document.lineCount;
                    const startLine = Math.min(selectionRange[0], docLineCount - 1);
                    const endLine = Math.min(selectionRange[2], docLineCount - 1);
                    
                    // Get line length for start and end lines to validate character positions
                    const startLineLength = document.lineAt(startLine).text.length;
                    const endLineLength = document.lineAt(endLine).text.length;
                    
                    // Ensure character positions are valid
                    const startChar = Math.min(selectionRange[1], startLineLength);
                    const endChar = Math.min(selectionRange[3], endLineLength);
                    
                    const range = new vscode.Range(
                        new vscode.Position(startLine, startChar),
                        new vscode.Position(endLine, endChar)
                    );
                    
                    editor.selection = new vscode.Selection(range.start, range.end);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                } catch (selectionError) {
                    console.error('Error setting selection:', selectionError);
                    // Continue even if selection fails - at least the file is open
                }
            }
            
            // Provide the file content with syntax highlighting information
            const fileContent = document.getText();
            const languageId = document.languageId;
            
            this.panel.webview.postMessage({
                command: 'fileOpened',
                filePath,
                success: true,
                fileInfo: {
                    language: languageId,
                    lineCount: document.lineCount,
                    size: fileContent.length
                }
            });
        } catch (error) {
            this.panel.webview.postMessage({
                command: 'fileOpened',
                filePath,
                success: false,
                error: `Error: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }
    
    private getBasicWebviewContent(): string {
        let markdownScriptUri, clientScriptUri;
        
        try {
            // Adjust the path for development or production mode
            const distPath = path.resolve(__dirname, '..');
            console.log(`Looking for script files in: ${distPath}`);
            
            // Recursively find files - simple implementation
            const findFileInDir = (dir: string, filename: string): string | null => {
                if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
                    return null;
                }
                
                try {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                        const filePath = path.join(dir, file);
                        
                        if (file === filename) {
                            return filePath;
                        }
                        
                        if (fs.statSync(filePath).isDirectory()) {
                            const found = findFileInDir(filePath, filename);
                            if (found) {
                                return found;
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Error searching dir ${dir}:`, e);
                }
                
                return null;
            };
            
            // Find script files
            let markdownScriptPath = findFileInDir(distPath, 'markdownParser.js');
            let clientScriptPath = findFileInDir(distPath, 'ollamaClient.js');
            
            console.log(`Found markdownParser.js: ${markdownScriptPath}`);
            console.log(`Found ollamaClient.js: ${clientScriptPath}`);
            
            if (!markdownScriptPath) {
                console.error('Failed to find markdownParser.js, using placeholder');
                markdownScriptPath = path.join(distPath, 'markdownParser.js');
            }
            
            if (!clientScriptPath) {
                console.error('Failed to find ollamaClient.js, using placeholder');
                clientScriptPath = path.join(distPath, 'ollamaClient.js');
            }
            
            // Convert to webview URIs
            markdownScriptUri = this.panel.webview.asWebviewUri(
                vscode.Uri.file(markdownScriptPath)
            );
            
            clientScriptUri = this.panel.webview.asWebviewUri(
                vscode.Uri.file(clientScriptPath)
            );
            
        } catch (error) {
            console.error('Error setting up webview resources:', error);
            
            // Use hardcoded URIs as fallback if necessary
            markdownScriptUri = vscode.Uri.parse('vscode-resource:/markdownParser.js');
            clientScriptUri = vscode.Uri.parse('vscode-resource:/ollamaClient.js');
        }

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ollama Chat</title>
            <script src="${markdownScriptUri}"></script>
            <script>
                // Essential function needed for code formatting
                function highlightCodeBlocks(codeElements) {
                    if (!codeElements || codeElements.length === 0) return;
                    
                    for (let i = 0; i < codeElements.length; i++) {
                        const block = codeElements[i];
                        if (!block || !block.className) continue;
                        
                        const lang = block.className.replace('language-', '');
                        let code = block.innerHTML || '';
                        
                        // Skip empty or already highlighted blocks
                        if (!code || code.includes('token')) continue;
                        
                        // Set language display on the parent pre element
                        const preElement = block.parentElement;
                        if (preElement && preElement.tagName === 'PRE') {
                            if (!preElement.hasAttribute('data-language')) {
                                preElement.setAttribute('data-language', lang || 'text');
                            }
                        }
                        
                        // Apply basic syntax highlighting (simplified for HTML string)
                        if (lang === 'javascript' || lang === 'js' || lang === 'typescript' || lang === 'ts') {
                            // Basic keywords (simplified)
                            code = code.replace(/\\b(const|let|var|function|return|if|else|for|class)\\b/g, 
                                '<span class="token keyword">$1</span>');
                            
                            // Basic strings (simplified)
                            code = code.replace(/"([^"]*)"/g, '<span class="token string">"$1"</span>');
                            code = code.replace(/'([^']*)'/g, '<span class="token string">\'$1\'</span>');
                            
                            // Comments (simplified)
                            code = code.replace(/\/\/(.*)/g, '<span class="token comment">//$1</span>');
                        }
                        
                        block.innerHTML = code;
                    }
                }
            </script>
            <style>
                :root {
                    --scrollbar-width: 10px;
                    --message-spacing: 24px;
                    --message-padding: 16px;
                    --animation-duration: 0.3s;
                    --paragraph-spacing: 16px;
                    --content-max-width: 800px;
                    --code-block-radius: 6px;
                    --message-transition: all 0.2s ease-out;
                    --message-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    --heading-margin: 24px 0 16px 0;
                    --blockquote-border: 4px solid var(--vscode-textBlockQuote-border);
                    --blockquote-background: var(--vscode-textBlockQuote-background);
                    --blockquote-padding: 8px 0 8px 16px;
                    --table-border-color: var(--vscode-panel-border);
                    --link-color: var(--vscode-textLink-foreground);
                    --link-hover-color: var(--vscode-textLink-activeForeground);
                    --syntax-string: var(--vscode-debugTokenExpression-string);
                    --syntax-number: var(--vscode-debugTokenExpression-number);
                    --syntax-boolean: var(--vscode-debugTokenExpression-boolean);
                    --syntax-function: var(--vscode-debugTokenExpression-name);
                    --syntax-keyword: var(--vscode-debugTokenExpression-name);
                    --syntax-comment: var(--vscode-debugTokenExpression-value);
                    --reference-background: var(--vscode-editor-inactiveSelectionBackground);
                    --reference-border: var(--vscode-focusBorder);
                }
                
                html, body {
                    height: 100%;
                    width: 100%;
                    overflow: hidden; /* Prevent double scrollbars */
                    margin: 0;
                    padding: 0;
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    font-size: 14px;
                    line-height: 1.6;
                    scroll-behavior: smooth;
                }
                
                /* Improved scrollbar styling */
                ::-webkit-scrollbar {
                    width: var(--scrollbar-width);
                    height: var(--scrollbar-width);
                }
                
                ::-webkit-scrollbar-track {
                    background: transparent;
                }
                
                ::-webkit-scrollbar-thumb {
                    background: var(--vscode-scrollbarSlider-background);
                    border-radius: 5px;
                }
                
                ::-webkit-scrollbar-thumb:hover {
                    background: var(--vscode-scrollbarSlider-hoverBackground);
                }
                
                ::-webkit-scrollbar-thumb:active {
                    background: var(--vscode-scrollbarSlider-activeBackground);
                }
                
                /* Main container */
                .container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    max-width: 100%;
                    margin: 0 auto;
                    position: relative;
                    overflow: hidden;
                }
                
                /* Header styling */
                .header {
                    padding: 10px 16px;
                    font-size: 16px;
                    font-weight: bold;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-shrink: 0;
                    z-index: 10;
                }
                
                .model-indicator {
                    font-size: 12px;
                    font-weight: normal;
                    color: var(--vscode-badge-foreground);
                    background-color: var(--vscode-badge-background);
                    padding: 2px 8px;
                    border-radius: 10px;
                    margin-left: 8px;
                    opacity: 0.8;
                    transition: opacity 0.2s ease;
                }
                
                .model-indicator:hover {
                    opacity: 1;
                }
                
                /* Improved chat container */
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                    padding: 20px;
                    scroll-behavior: smooth;
                    scrollbar-width: thin;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    align-items: stretch;
                }
                
                /* Bottom input area */
                .input-container {
                    padding: 12px 16px;
                    display: flex;
                    border-top: 1px solid var(--vscode-panel-border);
                    background: var(--vscode-editor-background);
                    position: relative;
                    flex-shrink: 0;
                    z-index: 10;
                }
                
                /* Textarea improvements */
                #prompt-input {
                    flex: 1;
                    padding: 12px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 6px;
                    resize: none;
                    font-family: inherit;
                    font-size: inherit;
                    line-height: inherit;
                    transition: border-color 0.2s ease;
                    margin-right: 8px;
                }
                
                #prompt-input:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                
                /* Button styling */
                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: background-color 0.2s ease;
                    align-self: flex-end;
                }
                
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                
                button:active {
                    transform: translateY(1px);
                }
                
                button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                
                /* Improved message styling */
                .message {
                    margin-bottom: var(--message-spacing);
                    padding: var(--message-padding);
                    border-radius: 8px;
                    max-width: 90%;
                    position: relative;
                    word-wrap: break-word;
                    display: inline-block;
                    transition: var(--message-transition);
                    line-height: 1.6;
                    animation: fadeIn var(--animation-duration) ease-out;
                    box-shadow: var(--message-shadow);
                }
                
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                
                .user-message {
                    align-self: flex-end;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    margin-left: auto;
                    border-bottom-right-radius: 2px;
                }
                
                .bot-message {
                    align-self: flex-start;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    white-space: pre-wrap;
                    border-bottom-left-radius: 2px;
                }
                
                /* Reset white-space for markdown formatted content */
                .bot-message.markdown-content {
                    white-space: normal;
                }
                
                /* Improved text formatting within messages */
                .bot-message p {
                    margin-top: 0;
                    margin-bottom: var(--paragraph-spacing);
                }
                
                .bot-message p:last-child {
                    margin-bottom: 0;
                }
                
                /* Enhanced markdown styling */
                .bot-message h1, .bot-message h2, .bot-message h3, 
                .bot-message h4, .bot-message h5, .bot-message h6 {
                    margin: var(--heading-margin);
                    font-weight: 600;
                    line-height: 1.25;
                }
                
                .bot-message h1 {
                    font-size: 1.5em;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 0.3em;
                }
                
                .bot-message h2 {
                    font-size: 1.3em;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    padding-bottom: 0.3em;
                }
                
                .bot-message h3 {
                    font-size: 1.15em;
                }
                
                .bot-message h4 {
                    font-size: 1.1em;
                }
                
                .bot-message blockquote {
                    border-left: var(--blockquote-border);
                    background: var(--blockquote-background);
                    padding: var(--blockquote-padding);
                    margin: 0 0 16px 0;
                }
                
                .bot-message a {
                    color: var(--link-color);
                    text-decoration: none;
                }
                
                .bot-message a:hover {
                    color: var(--link-hover-color);
                    text-decoration: underline;
                }
                
                /* Code action buttons */
                .code-actions {
                    display: flex;
                    justify-content: flex-end;
                    padding: 8px;
                    background-color: var(--vscode-editor-background);
                    border-top: 1px solid var(--vscode-editor-lineHighlightBorder);
                    opacity: 0.8;
                    transition: opacity 0.2s ease;
                }
                
                .code-actions:hover {
                    opacity: 1;
                }
                
                .code-action-button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-border);
                    border-radius: 4px;
                    padding: 4px 12px;
                    margin-left: 8px;
                    font-size: 12px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .code-action-button:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                .code-action-button:active {
                    transform: translateY(1px);
                }
                
                /* Enhanced Code Formatting */
                .bot-message pre {
                    margin: 16px 0;
                    padding: 16px;
                    background: var(--vscode-editor-background, #1e1e1e);
                    border-radius: 8px;
                    overflow-x: auto;
                    border: 1px solid var(--vscode-panel-border, #555);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                    position: relative;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 14px;
                    line-height: 1.5;
                    max-width: 100%;
                    display: block;
                }
                
                /* Language indicator */
                .bot-message pre::before {
                    content: attr(data-language);
                    position: absolute;
                    top: 0;
                    right: 0;
                    padding: 4px 8px;
                    font-size: 11px;
                    border-radius: 0 var(--code-block-radius) 0 4px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    opacity: 0.8;
                    font-family: var(--vscode-font-family);
                }
                
                /* Quick copy button */
                .bot-message pre::after {
                    content: "📋 Copy All";
                    position: absolute;
                    top: 0;
                    left: 0;
                    padding: 4px 8px;
                    font-size: 11px;
                    border-radius: var(--code-block-radius) 0 4px 0;
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    opacity: 0;
                    font-family: var(--vscode-font-family);
                    cursor: pointer;
                    transition: opacity 0.2s ease;
                }
                
                .bot-message pre:hover::after {
                    opacity: 0.8;
                }
                
                .bot-message pre:hover::after:hover {
                    opacity: 1;
                }
                
                /* Line numbers */
                .bot-message pre {
                    counter-reset: line;
                }
                
                .bot-message pre code {
                    display: block;
                    padding: 0;
                    background: none;
                    line-height: 1.5;
                    tab-size: 4;
                    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
                    font-size: 0.9em;
                }
                
                .bot-message pre code > div.line {
                    position: relative;
                    padding-left: 3em;
                    padding-right: 0.5em;
                    min-height: 1.2em;
                    line-height: 1.5;
                    white-space: pre;
                    display: block;
                    transition: background-color 0.1s ease;
                }
                
                .bot-message pre code > div.line:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                }
                
                .bot-message pre code > div.line::before {
                    counter-increment: line;
                    content: counter(line);
                    position: absolute;
                    left: 0;
                    width: 2.5em;
                    text-align: right;
                    color: var(--vscode-editorLineNumber-foreground, #888);
                    opacity: 0.8;
                    padding-right: 0.5em;
                    border-right: 1px solid var(--vscode-editorLineNumber-activeForeground, #aaa);
                    user-select: none;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 0.9em;
                }
                
                /* Line copy button - appears on hover */
                .bot-message pre code > div.line {
                    position: relative;
                }
                
                .bot-message pre code > div.line:hover::after {
                    content: "📋";
                    position: absolute;
                    right: 0.5em;
                    top: 0;
                    font-size: 12px;
                    opacity: 0.5;
                    cursor: pointer;
                    transition: opacity 0.2s ease;
                }
                
                .bot-message pre code > div.line:hover::after:hover {
                    opacity: 1;
                }
                
                /* Inline code */
                .bot-message code:not(pre code) {
                    background: var(--vscode-textCodeBlock-background);
                    color: var(--vscode-textCodeBlock-foreground);
                    padding: 2px 5px;
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
                    font-size: 0.9em;
                }
                
                /* Syntax highlighting tokens */
                .token.keyword { color: var(--syntax-keyword, #569CD6); font-weight: bold; }
                .token.string { color: var(--syntax-string, #CE9178); }
                .token.number { color: var(--syntax-number, #B5CEA8); }
                .token.boolean { color: var(--syntax-boolean, #569CD6); }
                .token.function { color: var(--syntax-function, #DCDCAA); }
                .token.comment { color: var(--syntax-comment, #6A9955); }
                
                /* Explicit token styling as fallback */
                span.token.keyword { color: #569CD6; font-weight: bold; }
                span.token.string { color: #CE9178; }
                span.token.number { color: #B5CEA8; }
                span.token.boolean { color: #569CD6; }
                span.token.function { color: #DCDCAA; }
                span.token.comment { color: #6A9955; }
                
                /* Reference message styling */
                .reference-message {
                    background-color: var(--reference-background) !important;
                    border-left: 3px solid var(--reference-border) !important;
                    position: relative;
                    padding-top: 20px;
                    opacity: 0.9;
                    transition: opacity 0.2s ease;
                }
                
                .reference-message:hover {
                    opacity: 1;
                }
                
                .reference-use-button {
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-secondaryBackground);
                    font-size: 11px;
                    padding: 3px 8px;
                    margin-top: 8px;
                    border-radius: 3px;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                
                .reference-use-button:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                
                /* Enhanced syntax highlighting */
                .token.string {
                    color: var(--syntax-string, #ce9178);
                }
                
                .token.number {
                    color: var(--syntax-number, #b5cea8);
                }
                
                .token.boolean {
                    color: var(--syntax-boolean, #569cd6);
                }
                
                .token.function {
                    color: var(--syntax-function, #dcdcaa);
                }
                
                .token.keyword {
                    color: var(--syntax-keyword, #569cd6);
                    font-weight: bold;
                }
                
                .token.comment {
                    color: var(--syntax-comment, #6a9955);
                    font-style: italic;
                }
                
                .token.operator {
                    color: var(--vscode-symbolIcon-operatorForeground, #d4d4d4);
                }
                
                .token.punctuation {
                    color: var(--vscode-symbolIcon-operatorForeground, #d4d4d4);
                }
                
                .token.class-name {
                    color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
                }
                
                .token.parameter {
                    color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
                }
                
                /* Highlight the active line on hover */
                .bot-message pre code > div.line:hover {
                    background-color: rgba(255, 255, 255, 0.1);
                }
                
                /* Table styling */
                .bot-message table {
                    border-collapse: collapse;
                    margin: 16px 0;
                    width: 100%;
                    display: block;
                    overflow-x: auto;
                }
                
                .bot-message table th,
                .bot-message table td {
                    border: 1px solid var(--table-border-color);
                    padding: 8px 12px;
                    text-align: left;
                }
                
                .bot-message table th {
                    background-color: rgba(0, 0, 0, 0.1);
                    font-weight: bold;
                }
                
                .bot-message table tr:nth-child(even) {
                    background-color: rgba(0, 0, 0, 0.05);
                }
                
                /* Lists styling */
                .bot-message ul, .bot-message ol {
                    margin-top: 8px;
                    margin-bottom: 16px;
                    padding-left: 24px;
                }
                
                .bot-message li {
                    margin-bottom: 4px;
                }
                
                .bot-message li > ul,
                .bot-message li > ol {
                    margin-top: 4px;
                    margin-bottom: 4px;
                }
                
                /* Status indicators */
                .model-indicator {
                    margin-left: 8px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                    display: inline-flex;
                    align-items: center;
                }
                
                /* Improved cancel button */
                .cancel-button {
                    display: none;
                    margin-top: 10px;
                    color: var(--vscode-errorForeground);
                    cursor: pointer;
                    background: transparent;
                    border: 1px solid var(--vscode-errorForeground);
                    padding: 6px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    align-self: flex-start;
                    transition: all 0.2s ease;
                }
                
                .cancel-button:hover {
                    background: var(--vscode-errorForeground);
                    color: var(--vscode-button-foreground);
                }
                
                /* Thinking animation */
                .thinking {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    opacity: 0.8;
                    margin: 4px 0;
                }
                
                .thinking .dots {
                    display: flex;
                }
                
                .thinking .dot {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background-color: var(--vscode-descriptionForeground);
                    animation: pulse 1.5s infinite;
                    margin-right: 5px;
                }
                
                .thinking .dot:nth-child(2) {
                    animation-delay: 0.2s;
                }
                
                .thinking .dot:nth-child(3) {
                    animation-delay: 0.4s;
                }
                
                @keyframes pulse {
                    0%, 100% { transform: scale(0.7); opacity: 0.7; }
                    50% { transform: scale(1); opacity: 1; }
                }
                
                /* Session Management Styling */
                .header-left, .header-right {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                /* Session Management Styling */
                
                .dropdown {
                    position: relative;
                    display: inline-block;
                }
                
                .dropdown-button {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 10px;
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: 1px solid var(--vscode-button-secondaryBackground);
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                }
                
                .dropdown-button:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                
                .dropdown-icon {
                    font-size: 9px;
                    opacity: 0.7;
                    transition: transform 0.2s ease;
                }
                
                .dropdown.active .dropdown-icon {
                    transform: rotate(180deg);
                }
                
                .dropdown-content {
                    display: none;
                    position: absolute;
                    top: 100%;
                    left: 0;
                    min-width: 220px;
                    max-height: 350px;
                    overflow-y: auto;
                    background: var(--vscode-dropdown-background);
                    border: 1px solid var(--vscode-dropdown-border);
                    border-radius: 4px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
                    z-index: 100;
                    margin-top: 4px;
                }
                
                .dropdown.active .dropdown-content {
                    display: block;
                    animation: fadeIn 0.15s ease-out;
                }
                
                .session-item, .model-item, .menu-button {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px 12px;
                    font-size: 13px;
                    cursor: pointer;
                    transition: background-color 0.15s ease;
                }
                
                .session-item:hover, .model-item:hover, .menu-button:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                
                .session-item.active, .model-item.active {
                    background: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
                
                .model-indicator {
                    font-size: 13px;
                    opacity: 0.9;
                }
                
                .session-actions {
                    display: flex;
                    gap: 5px;
                    opacity: 0.7;
                    font-size: 11px;
                }
                
                .session-action {
                    cursor: pointer;
                    padding: 2px 4px;
                    border-radius: 3px;
                }
                
                .session-action:hover {
                    background: rgba(255, 255, 255, 0.1);
                }
                
                .dropdown-divider {
                    border-top: 1px solid var(--vscode-dropdown-border);
                    margin: 6px 0;
                }
                
                .menu-button {
                    width: 100%;
                    text-align: left;
                    background: transparent;
                    color: var(--vscode-foreground);
                    border: none;
                    border-radius: 0;
                }
                
                .menu-button:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                
                .menu-button .icon {
                    font-weight: bold;
                    margin-right: 5px;
                }
                
                /* Position the model dropdown to the right side */
                .model-dropdown .dropdown-content {
                    right: 0;
                    left: auto;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="header-left">
                        <span class="title">Ollama Chat</span>
                        <span class="model-indicator" id="title-model-indicator"></span>
                        <div class="dropdown">
                            <button id="session-selector" class="dropdown-button">
                                <span id="current-session-name">Current Chat</span>
                                <span class="dropdown-icon">▼</span>
                            </button>
                            <div id="session-dropdown" class="dropdown-content">
                                <div id="sessions-list"></div>
                                <div class="dropdown-divider"></div>
                                <button id="new-session-button" class="menu-button">
                                    <span class="icon">+</span> New Chat
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="header-right">
                        <div class="dropdown model-dropdown">
                            <button id="model-selector" class="dropdown-button">
                                <span id="model-display" class="model-indicator">No model selected</span>
                                <span class="dropdown-icon">▼</span>
                            </button>
                            <div id="model-dropdown" class="dropdown-content">
                                <div id="models-list"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="chat-container" class="chat-container"></div>
                <div class="input-container">
                    <textarea id="prompt-input" placeholder="Ask about your code..." rows="3"></textarea>
                    <button id="send-button">Send</button>
                </div>
            </div>
            <script src="${clientScriptUri}"></script>
        </body>
        </html>`;
    }
}