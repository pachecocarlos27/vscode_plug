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
    // Helper method to extract code blocks from a response
    private extractCodeBlocks(text: string): Array<{ 
        language: string; 
        code: string;
        position?: { start: number; end: number; }; 
    }> {
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        const codeBlocks: Array<{ 
            language: string; 
            code: string;
            position?: { start: number; end: number; }; 
        }> = [];
        
        let match;
        while ((match = codeBlockRegex.exec(text)) !== null) {
            const language = match[1] || '';
            const code = match[2].trim();
            
            if (code) {
                codeBlocks.push({ 
                    language, 
                    code,
                    // Include position information for tracking in the DOM
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
                            const cancelDisposable = vscode.commands.registerCommand('vscode-ollama.cancelRequest', () => {
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
                        vscode.commands.executeCommand('vscode-ollama.cancelRequest');
                        break;
                        
                    case 'copyToClipboard':
                        if (message.text) {
                            vscode.env.clipboard.writeText(message.text);
                            // Inform the user with a status message
                            vscode.window.setStatusBarMessage('Code copied to clipboard', 3000);
                        }
                        break;
                        
                    case 'applyCodeToEditor':
                        if (message.text) {
                            const editor = vscode.window.activeTextEditor;
                            if (editor) {
                                // Apply the code to the active editor
                                editor.edit(editBuilder => {
                                    // Replace entire selection or insert at cursor
                                    if (editor.selection.isEmpty) {
                                        editBuilder.insert(editor.selection.active, message.text);
                                    } else {
                                        editBuilder.replace(editor.selection, message.text);
                                    }
                                }).then(success => {
                                    if (success) {
                                        // Inform the user
                                        vscode.window.setStatusBarMessage('Code applied to editor', 3000);
                                    } else {
                                        vscode.window.showErrorMessage('Failed to apply code to editor');
                                    }
                                });
                            } else {
                                vscode.window.showErrorMessage('No active editor to apply code to');
                            }
                        }
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(ollamaService: OllamaService, extensionContext?: vscode.ExtensionContext) {
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
        
        // Send prompt to the webview with context flag enabled
        this.panel.webview.postMessage({
            command: 'injectPrompt', 
            text: promptText,
            includeContext: true // Enable context for all prompts
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
    
    private async notifyContextChange() {
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
            this._throttleTimeout = null;
        }, 1000);
    }
    
    private _throttleTimeout: NodeJS.Timeout | null = null;
    
    // File cache to avoid repeated file scans
    private fileCache: { files: string[], timestamp: number } | null = null;
    private readonly FILE_CACHE_TTL = 60 * 1000; // 60 seconds cache for files
    private readonly MAX_FILES = 300; // Maximum number of files to include
    private readonly MAX_FILE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days - only include recently modified files
    
    private async getProjectContext(): Promise<ProjectContext> {
        const context: ProjectContext = {
            files: [],
            activeFile: null,
            selection: null,
            workspaceFolders: []
        };
        
        // Get workspace folders
        if (vscode.workspace.workspaceFolders) {
            context.workspaceFolders = vscode.workspace.workspaceFolders.map(folder => folder.uri.fsPath);
            
            // Use file cache if available and recent
            const now = Date.now();
            if (this.fileCache && (now - this.fileCache.timestamp < this.FILE_CACHE_TTL)) {
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
    private readonly MAX_PROMPT_SIZE = 32000; // Characters
    private readonly MAX_FILE_SIZE = 15000; // Characters for a single file
    private readonly MAX_SELECTION_SIZE = 10000; // Characters for selected code
    
    /**
     * Create an enhanced prompt with context information
     * Optimized to handle large contexts more efficiently with:
     * - Truncation of large files and selections
     * - Prompt size limitations
     * - File size detection and truncation strategies
     * - Prioritization of relevant content
     */
    private createEnhancedPrompt(userPrompt: string, context: ProjectContext): string {
        // Start with just the user prompt (fallback)
        let enhancedPrompt = userPrompt;
        let promptSize = userPrompt.length;
        let contextAdded = false;
        
        // Track components to include
        const promptParts: {type: string, content: string, priority: number}[] = [];
        
        // Calculate available space for context
        const availableSpace = this.MAX_PROMPT_SIZE - promptSize;
        
        // If there's selected text, prioritize including it
        if (context.selection) {
            let selection = context.selection;
            
            // Truncate if the selection is too large
            if (selection.length > this.MAX_SELECTION_SIZE) {
                const halfLimit = Math.floor(this.MAX_SELECTION_SIZE / 2);
                selection = selection.substring(0, halfLimit) + 
                    `\n\n... [${selection.length - this.MAX_SELECTION_SIZE} characters truncated] ...\n\n` +
                    selection.substring(selection.length - halfLimit);
            }
            
            promptParts.push({
                type: 'selection',
                content: `SELECTED CODE:\n\`\`\`\n${selection}\n\`\`\`\n\n`,
                priority: 1 // Highest priority
            });
        }
        
        // If there's an active file but no selection, try to include the file content
        else if (context.activeFile) {
            try {
                let content = fs.readFileSync(context.activeFile, 'utf8');
                
                // Get file extension to determine type
                const fileExt = path.extname(context.activeFile).replace('.', '');
                
                // Truncate if the file is too large
                if (content.length > this.MAX_FILE_SIZE) {
                    const halfLimit = Math.floor(this.MAX_FILE_SIZE / 2);
                    content = content.substring(0, halfLimit) + 
                        `\n\n... [${content.length - this.MAX_FILE_SIZE} characters truncated] ...\n\n` +
                        content.substring(content.length - halfLimit);
                }
                
                promptParts.push({
                    type: 'file',
                    content: `CURRENT FILE (${path.basename(context.activeFile)}):\n\`\`\`${fileExt}\n${content}\n\`\`\`\n\n`,
                    priority: 2 // Second priority
                });
            } catch (error) {
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
            
            // Include important project files content
            if (context.files && context.files.length > 0) {
                // Look for important project files like package.json, README.md, etc.
                const importantFiles = context.files.filter(file => {
                    const filename = path.basename(file).toLowerCase();
                    return filename === 'package.json' || 
                           filename === 'readme.md' || 
                           filename === 'cargo.toml' ||
                           filename === 'go.mod' ||
                           filename === 'pyproject.toml' ||
                           filename === 'requirements.txt';
                }).slice(0, 2); // Limit to 2 most important files
                
                for (const file of importantFiles) {
                    try {
                        let content = fs.readFileSync(file, 'utf8');
                        const fileExt = path.extname(file).replace('.', '');
                        const filename = path.basename(file);
                        
                        // Truncate if the file is too large
                        if (content.length > this.MAX_FILE_SIZE / 2) { // Use smaller limit for context files
                            content = content.substring(0, this.MAX_FILE_SIZE / 2) + 
                                `\n\n... [${content.length - this.MAX_FILE_SIZE / 2} characters truncated] ...\n`;
                        }
                        
                        promptParts.push({
                            type: 'project-file',
                            content: `PROJECT FILE (${filename}):\n\`\`\`${fileExt}\n${content}\n\`\`\`\n\n`,
                            priority: 4 // Medium-low priority
                        });
                    } catch (error) {
                        console.log(`Error reading project file ${file}:`, error);
                    }
                }
            }
        }
        
        // Sort parts by priority (lowest number = highest priority)
        promptParts.sort((a, b) => a.priority - b.priority);
        
        // Build the prompt within size constraints
        let contextContent = "";
        let availableChars = this.MAX_PROMPT_SIZE - userPrompt.length - 100; // Buffer for formatting
        
        for (const part of promptParts) {
            if (part.content.length <= availableChars) {
                contextContent += part.content;
                availableChars -= part.content.length;
                contextAdded = true;
            } else if (availableChars > 200) {
                // Try to include a truncated version
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
        if (contextAdded) {
            enhancedPrompt = `${contextContent}USER QUERY: ${userPrompt}`;
        }
        
        console.log(`Enhanced prompt created: ${enhancedPrompt.length} chars (${contextAdded ? 'with' : 'without'} context)`);
        
        return enhancedPrompt;
    }
    
    private async applyEdit(filePath: string, edit: { range: [number, number, number, number], text: string }, showDiff: boolean = true) {
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
        skipConfirmation: boolean = false
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
    
    private async createFile(filePath: string, content: string) {
        try {
            // Make sure directory exists
            const directory = path.dirname(filePath);
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
            }
            
            // Write the file
            fs.writeFileSync(filePath, content, 'utf8');
            
            // Open the file
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            await vscode.window.showTextDocument(document);
            
            this.panel.webview.postMessage({
                command: 'fileCreated',
                filePath,
                success: true
            });
        } catch (error) {
            this.panel.webview.postMessage({
                command: 'fileCreated',
                filePath,
                success: false,
                error: `Error: ${error instanceof Error ? error.message : String(error)}`
            });
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
                
                /* Code formatting */
                .bot-message pre {
                    margin: 12px 0;
                    padding: 12px;
                    background: var(--vscode-editor-background);
                    border-radius: var(--code-block-radius);
                    overflow-x: auto;
                    border: 1px solid var(--vscode-panel-border);
                }
                
                .bot-message code {
                    font-family: var(--vscode-editor-font-family, 'Consolas, monospace');
                    font-size: 0.9em;
                }
                
                .bot-message pre code {
                    padding: 0;
                    background: none;
                }
                
                .bot-message code:not(pre code) {
                    background: rgba(0, 0, 0, 0.1);
                    padding: 2px 5px;
                    border-radius: 3px;
                }
                
                /* Basic syntax highlighting */
                .token.string {
                    color: var(--syntax-string);
                }
                
                .token.number {
                    color: var(--syntax-number);
                }
                
                .token.boolean {
                    color: var(--syntax-boolean);
                }
                
                .token.function {
                    color: var(--syntax-function);
                }
                
                .token.keyword {
                    color: var(--syntax-keyword);
                }
                
                .token.comment {
                    color: var(--syntax-comment);
                    font-style: italic;
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