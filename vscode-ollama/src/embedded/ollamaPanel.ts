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

export class OllamaPanel {
    public static currentPanel: OllamaPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly ollamaService: OllamaService;
    private currentModel: string | undefined;
    private disposables: vscode.Disposable[] = [];
    private contextWatcher: vscode.Disposable | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;

    private constructor(panel: vscode.WebviewPanel, ollamaService: OllamaService) {
        this.panel = panel;
        this.ollamaService = ollamaService;

        // Set basic HTML content 
        this.panel.webview.html = this.getBasicWebviewContent();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        
        // Setup watchers for project context
        this.setupProjectWatchers();
        
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'sendPrompt': {
                        if (!this.currentModel) {
                            vscode.window.showErrorMessage('Please select a model first');
                            return;
                        }
                        
                        this.panel.webview.postMessage({ 
                            command: 'startResponse',
                            prompt: message.text
                        });
                        
                        try {
                            // Get project context to enhance the prompt
                            const context = await this.getProjectContext();
                            
                            // Enhance prompt with context if requested
                            let enhancedPrompt = message.text;
                            if (message.includeContext) {
                                enhancedPrompt = this.createEnhancedPrompt(message.text, context);
                            }
                            
                            let fullResponse = '';
                            await this.ollamaService.streamCompletion(
                                this.currentModel,
                                enhancedPrompt,
                                (chunk) => {
                                    fullResponse += chunk;
                                    this.panel.webview.postMessage({
                                        command: 'appendResponse',
                                        text: chunk
                                    });
                                }
                            );

                            this.panel.webview.postMessage({
                                command: 'endResponse',
                                fullResponse
                            });
                        } catch (error) {
                            this.panel.webview.postMessage({
                                command: 'error',
                                message: `Error: ${error instanceof Error ? error.message : String(error)}`
                            });
                        }
                        break;
                        
                    case 'getProjectContext': {
                        const context = await this.getProjectContext();
                        this.panel.webview.postMessage({
                            command: 'projectContext',
                            context
                        });
                        break;
                    }
                        
                    case 'applyEdit':
                        await this.applyEdit(message.filePath, message.edit);
                        break;
                        
                    case 'createFile':
                        await this.createFile(message.filePath, message.content);
                        break;
                        
                    case 'refreshContext': {
                        const refreshedContext = await this.getProjectContext();
                        this.panel.webview.postMessage({
                            command: 'projectContext',
                            context: refreshedContext
                        });
                        break;
                    }
                        
                    case 'openFile':
                        await this.openFile(message.filePath, message.selection);
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(ollamaService: OllamaService) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (OllamaPanel.currentPanel) {
            OllamaPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'ollamaChat',
            'Ollama Chat',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(vscode.Uri.file(path.resolve(__dirname, '..')), 'media')
                ]
            }
        );

        OllamaPanel.currentPanel = new OllamaPanel(panel, ollamaService);
    }

    public async setModel(modelName: string) {
        this.currentModel = modelName;
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
        
        // Send prompt to the webview
        this.panel.webview.postMessage({
            command: 'injectPrompt', 
            text: promptText
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
        
        OllamaPanel.currentPanel = undefined;
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
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
            
            // Get files in workspace (limit to reasonable number)
            for (const folder of vscode.workspace.workspaceFolders) {
                try {
                    // Load configuration for which files to include
                    const configFilePatterns = vscode.workspace.getConfiguration('ollama').get('filePatterns') as string[] || 
                        ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.py', '**/*.html', '**/*.css', '**/*.json', '**/README.md'];
                    
                    // Join patterns for glob, escaping special characters
                    const patternString = '{' + configFilePatterns.join(',') + '}';
                    const pattern = new vscode.RelativePattern(folder, patternString);
                    
                    // Get excluded patterns from config
                    const excludePatterns = vscode.workspace.getConfiguration('ollama').get('excludePatterns') as string[] || 
                        ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'];
                    
                    // Find files with exclusions as glob pattern
                    const files = await vscode.workspace.findFiles(
                        pattern, 
                        '{' + excludePatterns.join(',') + '}', 
                        1000
                    );
                    
                    // Add files to context, skipping any that match exclusion patterns
                    const newFiles = files.map(file => file.fsPath)
                        .filter(filePath => !excludePatterns.some(pattern => 
                            // Simple wildcard matching for exclusion patterns
                            new RegExp('^' + pattern.replace(/\*/g, '.*') + '$').test(filePath)
                        ));
                    
                    context.files = context.files.concat(newFiles);
                } catch (error) {
                    console.error('Error gathering files:', error);
                }
            }
            
            // Sort files by extension and name for better organization
            context.files.sort((a, b) => {
                const extA = path.extname(a).toLowerCase();
                const extB = path.extname(b).toLowerCase();
                if (extA !== extB) return extA.localeCompare(extB);
                return path.basename(a).localeCompare(path.basename(b));
            });
        }
        
        // Get active file
        if (vscode.window.activeTextEditor) {
            context.activeFile = vscode.window.activeTextEditor.document.uri.fsPath;
            
            // Get selected text
            const selection = vscode.window.activeTextEditor.selection;
            if (!selection.isEmpty) {
                const document = vscode.window.activeTextEditor.document;
                context.selection = document.getText(selection);
                
                // Add selection range information for later use
                (context as any).selectionRange = {
                    start: { line: selection.start.line, character: selection.start.character },
                    end: { line: selection.end.line, character: selection.end.character }
                };
            }
        }
        
        return context;
    }
    
    private createEnhancedPrompt(userPrompt: string, context: ProjectContext): string {
        let enhancedPrompt = userPrompt;
        
        // If there's selected text, include it
        if (context.selection) {
            enhancedPrompt = `SELECTED CODE:\n\`\`\`\n${context.selection}\n\`\`\`\n\nUSER QUERY: ${userPrompt}`;
        }
        
        // If there's an active file but no selection, try to include the file content
        else if (context.activeFile) {
            try {
                const content = fs.readFileSync(context.activeFile, 'utf8');
                if (content.length < 10000) { // Limit to reasonable size
                    enhancedPrompt = `CURRENT FILE (${path.basename(context.activeFile)}):\n\`\`\`\n${content}\n\`\`\`\n\nUSER QUERY: ${userPrompt}`;
                } else {
                    // File too large, include just the filename and path
                    enhancedPrompt = `CURRENT FILE: ${context.activeFile}\n\nUSER QUERY: ${userPrompt}`;
                }
            } catch (error) {
                // If can't read the file, just use the path
                enhancedPrompt = `CURRENT FILE: ${context.activeFile}\n\nUSER QUERY: ${userPrompt}`;
            }
        }
        
        return enhancedPrompt;
    }
    
    private async applyEdit(filePath: string, edit: { range: [number, number, number, number], text: string }) {
        try {
            // Convert file path to URI
            const uri = vscode.Uri.file(filePath);
            
            // Open the document
            const document = await vscode.workspace.openTextDocument(uri);
            
            // Apply the edit
            const workspaceEdit = new vscode.WorkspaceEdit();
            const range = new vscode.Range(
                new vscode.Position(edit.range[0], edit.range[1]),
                new vscode.Position(edit.range[2], edit.range[3])
            );
            
            workspaceEdit.replace(uri, range, edit.text);
            
            // Apply the edit
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            
            if (success) {
                // Show the file with the edit
                await vscode.window.showTextDocument(document);
                
                this.panel.webview.postMessage({
                    command: 'editApplied',
                    filePath,
                    success: true
                });
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
    
    private async openFile(filePath: string, selection?: [number, number, number, number]) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File does not exist: ${filePath}`);
            }
            
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
            const editor = await vscode.window.showTextDocument(document);
            
            // If selection is provided, select that range
            if (selection) {
                try {
                    // Make sure selection is within document bounds
                    const docLineCount = document.lineCount;
                    const startLine = Math.min(selection[0], docLineCount - 1);
                    const endLine = Math.min(selection[2], docLineCount - 1);
                    
                    // Get line length for start and end lines to validate character positions
                    const startLineLength = document.lineAt(startLine).text.length;
                    const endLineLength = document.lineAt(endLine).text.length;
                    
                    // Ensure character positions are valid
                    const startChar = Math.min(selection[1], startLineLength);
                    const endChar = Math.min(selection[3], endLineLength);
                    
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
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ollama Chat</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    margin: 0;
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                }
                .header {
                    padding: 10px;
                    font-size: 16px;
                    font-weight: bold;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 15px;
                }
                .input-container {
                    padding: 10px;
                    display: flex;
                    border-top: 1px solid var(--vscode-panel-border);
                }
                #prompt-input {
                    flex: 1;
                    padding: 8px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
                button {
                    margin-left: 8px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                }
                .message {
                    margin-bottom: 16px;
                    padding: 8px 12px;
                    border-radius: 4px;
                    max-width: 80%;
                }
                .user-message {
                    align-self: flex-end;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .bot-message {
                    align-self: flex-start;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    white-space: pre-wrap;
                }
                .model-indicator {
                    margin-top: 5px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    Ollama Chat <span id="model-display" class="model-indicator">No model selected</span>
                </div>
                <div id="chat-container" class="chat-container"></div>
                <div class="input-container">
                    <textarea id="prompt-input" placeholder="Ask about your code..." rows="3"></textarea>
                    <button id="send-button">Send</button>
                </div>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chat-container');
                const promptInput = document.getElementById('prompt-input');
                const sendButton = document.getElementById('send-button');
                const modelDisplay = document.getElementById('model-display');
                
                let currentResponseElement = null;
                
                // Send prompt to extension
                function sendPrompt() {
                    const text = promptInput.value.trim();
                    if (text) {
                        addUserMessage(text);
                        promptInput.value = '';
                        
                        vscode.postMessage({
                            command: 'sendPrompt',
                            text: text,
                            includeContext: true
                        });
                    }
                }
                
                // Add user message to chat
                function addUserMessage(text) {
                    const div = document.createElement('div');
                    div.className = 'message user-message';
                    div.textContent = text;
                    chatContainer.appendChild(div);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                // Add bot message
                function addBotMessage(text = '') {
                    const div = document.createElement('div');
                    div.className = 'message bot-message';
                    div.textContent = text;
                    chatContainer.appendChild(div);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    return div;
                }
                
                // Event listeners
                sendButton.addEventListener('click', sendPrompt);
                
                promptInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendPrompt();
                    }
                });
                
                // Handle messages from extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'setModel':
                            modelDisplay.textContent = 'Model: ' + message.model;
                            break;
                        
                        case 'startResponse':
                            currentResponseElement = addBotMessage();
                            break;
                        
                        case 'appendResponse':
                            if (currentResponseElement) {
                                currentResponseElement.textContent += message.text;
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            }
                            break;
                        
                        case 'endResponse':
                            currentResponseElement = null;
                            break;
                        
                        case 'error':
                            if (currentResponseElement) {
                                currentResponseElement.textContent += '\n\nError: ' + message.message;
                                currentResponseElement = null;
                            } else {
                                addBotMessage('Error: ' + message.message);
                            }
                            break;
                        
                        case 'injectPrompt':
                            promptInput.value = message.text;
                            setTimeout(() => sendPrompt(), 100);
                            break;
                    }
                });
                
                // Initialize by requesting project context
                vscode.postMessage({ command: 'getProjectContext' });
            </script>
        </body>
        </html>`;
    }
}