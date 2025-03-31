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
                    case 'sendPrompt':
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
                        
                    case 'getProjectContext':
                        const context = await this.getProjectContext();
                        this.panel.webview.postMessage({
                            command: 'projectContext',
                            context
                        });
                        break;
                        
                    case 'applyEdit':
                        await this.applyEdit(message.filePath, message.edit);
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
                                currentResponseElement.textContent += '\\n\\nError: ' + message.message;
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

    private getWebviewContent() {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Ollama Chat</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 0;
                    margin: 0;
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    box-sizing: border-box;
                }
                .header {
                    padding: 10px 16px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .header-title {
                    font-size: 14px;
                    font-weight: bold;
                }
                .model-indicator {
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                .main-content {
                    display: flex;
                    flex: 1;
                    overflow: hidden;
                }
                .chat-panel {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                .context-panel {
                    width: 250px;
                    border-left: 1px solid var(--vscode-panel-border);
                    overflow-y: auto;
                    display: none;
                }
                .context-panel.visible {
                    display: block;
                }
                .chat-container {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                }
                
                /* Message formatting */
                .message {
                    margin-bottom: 16px;
                    display: flex;
                    flex-direction: column;
                    animation: fadeIn 0.3s ease-in-out;
                }
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .user-message {
                    align-self: flex-end;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border-radius: 8px 8px 0 8px;
                    padding: 8px 12px;
                    max-width: 80%;
                }
                .bot-message {
                    align-self: flex-start;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 8px 8px 8px 0;
                    padding: 8px 12px;
                    max-width: 80%;
                    white-space: pre-wrap;
                    line-height: 1.5;
                }
                .system-message {
                    align-self: center;
                    margin: 10px 0;
                }
                .system-message-content {
                    font-style: italic;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    padding: 4px 8px;
                    background-color: var(--vscode-badge-background);
                    border-radius: 4px;
                }

                /* Markdown and code styles */
                .bot-message code {
                    background-color: rgba(0, 0, 0, 0.1);
                    padding: 2px 4px;
                    border-radius: 3px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 0.9em;
                }
                .bot-message pre {
                    background-color: var(--vscode-textBlockQuote-background);
                    padding: 12px;
                    border-radius: 4px;
                    overflow-x: auto;
                    margin: 8px 0;
                    border-left: 3px solid var(--vscode-button-background);
                }
                .bot-message em {
                    opacity: 0.8;
                }
                .bot-message strong {
                    font-weight: bold;
                    color: var(--vscode-textLink-activeForeground);
                }
                .bot-message blockquote {
                    border-left: 3px solid var(--vscode-panel-border);
                    margin: 8px 0;
                    padding-left: 12px;
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
                .bot-message a {
                    color: var(--vscode-textLink-foreground);
                    text-decoration: none;
                }
                .bot-message a:hover {
                    text-decoration: underline;
                }
                .bot-message .md-header {
                    margin: 16px 0 8px 0;
                    color: var(--vscode-textLink-activeForeground);
                    font-weight: bold;
                }
                .bot-message h1 { font-size: 1.5em; margin-top: 0.8em; }
                .bot-message h2 { font-size: 1.3em; margin-top: 0.8em; }
                .bot-message h3 { font-size: 1.1em; margin-top: 0.7em; }
                .bot-message .list-item {
                    display: block;
                    margin: 4px 0;
                    line-height: 1.4;
                }
                
                /* Actions and buttons */
                .bot-actions {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                    margin-top: 4px;
                }
                .action-button {
                    background-color: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    border: none;
                    border-radius: 4px;
                    padding: 2px 6px;
                    font-size: 11px;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                .action-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .code-block {
                    position: relative;
                    margin: 12px 0;
                }
                .code-actions {
                    position: absolute;
                    top: 4px;
                    right: 4px;
                    display: flex;
                    gap: 4px;
                    opacity: 0.7;
                    transition: opacity 0.2s ease;
                }
                .code-block:hover .code-actions {
                    opacity: 1;
                }
                .code-action {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    padding: 2px 6px;
                    font-size: 10px;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                .code-action:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                /* Input area */
                .input-container {
                    padding: 16px;
                    border-top: 1px solid var(--vscode-panel-border);
                }
                .input-row {
                    display: flex;
                }
                .input-options {
                    display: flex;
                    justify-content: space-between;
                    margin-top: 8px;
                }
                #prompt-input {
                    flex: 1;
                    padding: 8px 12px;
                    border: 1px solid var(--vscode-input-border);
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border-radius: 4px;
                    margin-right: 8px;
                    min-height: 60px;
                    resize: vertical;
                    font-family: var(--vscode-font-family);
                    line-height: 1.5;
                    font-size: 13px;
                    transition: border-color 0.2s ease;
                }
                #prompt-input:focus {
                    outline: none;
                    border-color: var(--vscode-focusBorder);
                }
                button.primary {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s ease;
                }
                button.primary:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                
                /* Context panel */
                .checkbox-container {
                    display: flex;
                    align-items: center;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                .checkbox-container input {
                    margin-right: 4px;
                }
                .toggle-context {
                    background: none;
                    border: none;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    cursor: pointer;
                    text-decoration: underline;
                }
                .toggle-context:hover {
                    color: var(--vscode-foreground);
                }
                .context-title {
                    padding: 8px;
                    font-size: 12px;
                    font-weight: bold;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .context-list {
                    padding: 8px;
                }
                .context-item {
                    font-size: 12px;
                    margin-bottom: 4px;
                    cursor: pointer;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    transition: color 0.2s ease;
                    padding: 2px 4px;
                    border-radius: 2px;
                }
                .context-item:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    color: var(--vscode-textLink-foreground);
                }
                .context-section {
                    margin-bottom: 16px;
                }
                .context-section-title {
                    font-size: 11px;
                    font-weight: bold;
                    margin-bottom: 4px;
                    color: var(--vscode-descriptionForeground);
                    padding-left: 4px;
                }
                
                /* Utilities */
                .marked-text {
                    background-color: rgba(255, 255, 0, 0.2);
                }
                .hidden {
                    display: none;
                }
                
                /* Keyboard shortcuts tooltip */
                .keyboard-shortcuts {
                    position: absolute;
                    bottom: 75px;
                    right: 16px;
                    background-color: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 8px;
                    font-size: 12px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                    z-index: 1000;
                    display: none;
                }
                .keyboard-shortcuts-title {
                    font-weight: bold;
                    margin-bottom: 6px;
                }
                .keyboard-shortcut {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 4px;
                }
                .keyboard-shortcut-key {
                    background-color: var(--vscode-input-background);
                    padding: 2px 4px;
                    border-radius: 3px;
                    margin-left: 12px;
                    font-family: monospace;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="header-title">Ollama Chat</div>
                    <div class="model-indicator" id="model-display">No model selected</div>
                </div>
                <div class="main-content">
                    <div class="chat-panel">
                        <div class="chat-container" id="chat-container"></div>
                        <div class="input-container">
                            <div class="input-row">
                                <textarea id="prompt-input" placeholder="Ask about your code or project... (Enter to send, Shift+Enter for new line)" rows="3"></textarea>
                                <button id="send-button" class="primary">Send</button>
                            </div>
                            <div class="input-options">
                                <div class="checkbox-container">
                                    <input type="checkbox" id="include-context" checked>
                                    <label for="include-context">Include selected code/file context</label>
                                </div>
                                <div>
                                    <button id="toggle-context-panel" class="toggle-context">Show project files</button>
                                    <button id="show-shortcuts" class="toggle-context">⌨️ Shortcuts</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="context-panel" id="context-panel">
                        <div class="context-title">Project Context</div>
                        <div class="context-list">
                            <div class="context-section">
                                <div class="context-section-title">ACTIVE FILE</div>
                                <div id="active-file-context" class="context-item"></div>
                            </div>
                            <div class="context-section">
                                <div class="context-section-title">PROJECT FILES</div>
                                <div id="project-files-context"></div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Keyboard shortcuts panel -->
                <div class="keyboard-shortcuts" id="keyboard-shortcuts">
                    <div class="keyboard-shortcuts-title">Keyboard Shortcuts</div>
                    <div class="keyboard-shortcut">
                        <span>Send message</span>
                        <span class="keyboard-shortcut-key">Enter</span>
                    </div>
                    <div class="keyboard-shortcut">
                        <span>New line</span>
                        <span class="keyboard-shortcut-key">Shift+Enter</span>
                    </div>
                    <div class="keyboard-shortcut">
                        <span>Previous prompt</span>
                        <span class="keyboard-shortcut-key">↑</span>
                    </div>
                    <div class="keyboard-shortcut">
                        <span>Next prompt</span>
                        <span class="keyboard-shortcut-key">↓</span>
                    </div>
                    <div class="keyboard-shortcut">
                        <span>Clear chat</span>
                        <span class="keyboard-shortcut-key">Ctrl+L</span>
                    </div>
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                const chatContainer = document.getElementById('chat-container');
                const promptInput = document.getElementById('prompt-input');
                const sendButton = document.getElementById('send-button');
                const modelDisplay = document.getElementById('model-display');
                const includeContextCheckbox = document.getElementById('include-context');
                const toggleContextPanelButton = document.getElementById('toggle-context-panel');
                const contextPanel = document.getElementById('context-panel');
                const activeFileContext = document.getElementById('active-file-context');
                const projectFilesContext = document.getElementById('project-files-context');
                
                // Keep track of the current state
                let currentResponseElement = null;
                let projectContext = null;
                let currentModelName = '';
                
                // Chat history for current session
                let chatHistory = [];
                let historyPosition = -1;
                
                // Load saved state if it exists
                const savedState = vscode.getState();
                if (savedState) {
                    if (savedState.modelName) {
                        currentModelName = savedState.modelName;
                        modelDisplay.textContent = `Using model: ${currentModelName}`;
                    }
                    
                    if (savedState.chatHistory && Array.isArray(savedState.chatHistory)) {
                        restoreChatHistory(savedState.chatHistory);
                    }
                }
                
                // Save state between sessions
                function saveState() {
                    vscode.setState({
                        modelName: currentModelName,
                        chatHistory: chatHistory,
                    });
                }
                
                // Restore chat history from saved state
                function restoreChatHistory(history) {
                    chatHistory = history;
                    
                    // Clear the chat container
                    chatContainer.innerHTML = '';
                    
                    // Recreate the messages in the UI
                    for (const item of chatHistory) {
                        if (item.role === 'user') {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message';
                            
                            const contentDiv = document.createElement('div');
                            contentDiv.className = 'user-message';
                            contentDiv.textContent = item.content;
                            
                            messageDiv.appendChild(contentDiv);
                            chatContainer.appendChild(messageDiv);
                        } else if (item.role === 'assistant') {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = 'message';
                            
                            const contentDiv = document.createElement('div');
                            contentDiv.className = 'bot-message';
                            contentDiv.innerHTML = item.html || item.content;
                            
                            const actionsDiv = document.createElement('div');
                            actionsDiv.className = 'bot-actions';
                            
                            // Add copy action for the whole message
                            const copyButton = document.createElement('button');
                            copyButton.className = 'action-button';
                            copyButton.textContent = 'Copy All';
                            copyButton.onclick = () => {
                                navigator.clipboard.writeText(item.content);
                                showTooltip(copyButton, 'Copied!');
                            };
                            actionsDiv.appendChild(copyButton);
                            
                            messageDiv.appendChild(contentDiv);
                            messageDiv.appendChild(actionsDiv);
                            chatContainer.appendChild(messageDiv);
                        }
                    }
                    
                    // Scroll to the bottom
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                // Command history navigation
                function setupPromptHistory() {
                    let promptHistory = [];
                    let historyPosition = -1;
                    
                    // Add to history when sending prompt
                    function addToHistory(prompt) {
                        if (prompt && promptHistory[0] !== prompt) {
                            promptHistory.unshift(prompt);
                            if (promptHistory.length > 50) {
                                promptHistory.pop(); // Keep last 50 prompts
                            }
                            historyPosition = -1;
                        }
                    }
                    
                    // Navigate history
                    promptInput.addEventListener('keydown', (e) => {
                        if (e.key === 'ArrowUp' && promptInput.value.indexOf('\n') === -1) {
                            // Only use history if we're at the first line
                            e.preventDefault();
                            if (historyPosition === -1) {
                                // Save current input if we're starting history navigation
                                promptHistory.unshift(promptInput.value);
                                historyPosition = 0;
                            }
                            
                            if (historyPosition < promptHistory.length - 1) {
                                historyPosition++;
                                promptInput.value = promptHistory[historyPosition];
                            }
                        } else if (e.key === 'ArrowDown' && historyPosition > -1) {
                            e.preventDefault();
                            historyPosition--;
                            if (historyPosition === -1) {
                                promptInput.value = promptHistory[0];
                            } else {
                                promptInput.value = promptHistory[historyPosition];
                            }
                        } else if (e.key === 'Enter') {
                            if (e.shiftKey) {
                                // Normal behavior - add new line
                                return;
                            } else {
                                // Submit the prompt
                                e.preventDefault();
                                if (promptInput.value.trim()) {
                                    addToHistory(promptInput.value);
                                    sendPrompt();
                                }
                            }
                        } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
                            // Clear screen with Ctrl+L / Cmd+L
                            e.preventDefault();
                            chatContainer.innerHTML = '';
                            chatHistory = [];
                            saveState();
                        }
                    });
                    
                    return { addToHistory };
                }
                
                // Set up history navigation
                const promptHistoryHandler = setupPromptHistory();

                // Initialize
                vscode.postMessage({ command: 'getProjectContext' });
                
                // Toggle context panel
                toggleContextPanelButton.addEventListener('click', () => {
                    if (contextPanel.classList.contains('visible')) {
                        contextPanel.classList.remove('visible');
                        toggleContextPanelButton.textContent = 'Show project files';
                    } else {
                        contextPanel.classList.add('visible');
                        toggleContextPanelButton.textContent = 'Hide project files';
                    }
                });
                
                // Update context panel with project information
                function updateContextPanel(context) {
                    // Update active file
                    if (context.activeFile) {
                        const filename = context.activeFile.split('/').pop();
                        activeFileContext.textContent = filename;
                        activeFileContext.title = context.activeFile;
                        activeFileContext.dataset.path = context.activeFile;
                        activeFileContext.onclick = () => openFile(context.activeFile);
                    } else {
                        activeFileContext.textContent = 'No active file';
                        activeFileContext.title = '';
                        activeFileContext.dataset.path = '';
                        activeFileContext.onclick = null;
                    }
                    
                    // Update project files
                    projectFilesContext.innerHTML = '';
                    if (context.files && context.files.length > 0) {
                        context.files.forEach(file => {
                            const fileItem = document.createElement('div');
                            fileItem.className = 'context-item';
                            const filename = file.split('/').pop();
                            fileItem.textContent = filename;
                            fileItem.title = file;
                            fileItem.dataset.path = file;
                            fileItem.onclick = () => openFile(file);
                            projectFilesContext.appendChild(fileItem);
                        });
                    } else {
                        const noFiles = document.createElement('div');
                        noFiles.textContent = 'No files found';
                        noFiles.style.fontStyle = 'italic';
                        noFiles.style.color = 'var(--vscode-descriptionForeground)';
                        projectFilesContext.appendChild(noFiles);
                    }
                }
                
                function openFile(filePath) {
                    vscode.postMessage({
                        command: 'openFile',
                        filePath
                    });
                }
                
                // Process Markdown in bot responses
                function processMarkdownAndCode(element) {
                    const text = element.textContent;
                    
                    // Process code blocks first
                    let processedText = '';
                    let lastIndex = 0;
                    
                    // Match code blocks with language specified
                    const codeBlockRegex = /```([a-zA-Z0-9_+-]*)?\n([\s\S]*?)\n```/g;
                    let match;
                    
                    while ((match = codeBlockRegex.exec(text)) !== null) {
                        // Add text before the code block
                        processedText += processMarkdownInline(text.substring(lastIndex, match.index));
                        
                        // Get the language and code
                        const language = match[1] ? match[1].trim() : '';
                        const code = match[2];
                        
                        // Add code block with actions
                        processedText += `
                            <div class="code-block">
                                <div class="code-actions">
                                    <button class="code-action" data-action="copy" title="Copy to clipboard">Copy</button>
                                    <button class="code-action" data-action="apply" title="Apply this code">Apply</button>
                                </div>
                                <pre><code class="language-${language}" data-language="${language}">${escapeHTML(code)}</code></pre>
                            </div>
                        `;
                        
                        lastIndex = match.index + match[0].length;
                    }
                    
                    // Add any remaining text with inline markdown
                    if (lastIndex < text.length) {
                        processedText += processMarkdownInline(text.substring(lastIndex));
                    }
                    
                    // Update the element content
                    element.innerHTML = processedText;
                    
                    // Add event listeners to code block actions
                    element.querySelectorAll('.code-action').forEach(button => {
                        button.addEventListener('click', (e) => {
                            const action = e.target.dataset.action;
                            const codeElement = e.target.closest('.code-block').querySelector('code');
                            const code = codeElement.textContent;
                            
                            if (action === 'copy') {
                                navigator.clipboard.writeText(code);
                                showTooltip(e.target, 'Copied!');
                            } else if (action === 'apply') {
                                promptToApplyCode(code, codeElement.dataset.language);
                            }
                        });
                    });
                }
                
                // Process inline markdown
                function processMarkdownInline(text) {
                    let processed = text;
                    
                    // Bold: **text** or __text__
                    processed = processed.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
                    
                    // Italic: *text* or _text_
                    processed = processed.replace(/(\*|_)(.*?)\1/g, '<em>$2</em>');
                    
                    // Inline code: `code`
                    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');
                    
                    // Links: [title](url)
                    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 
                        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
                    
                    // Headers: # Header, ## Header, etc.
                    processed = processed.replace(/^(#{1,6})\s+(.+)$/gm, (match, hashes, content) => {
                        const level = hashes.length;
                        return `<h${level} class="md-header">${content}</h${level}>`;
                    });
                    
                    // Lists: - item or * item or 1. item
                    processed = processed.replace(/^(\s*)(-|\*|\d+\.)\s+(.+)$/gm, 
                        '<div class="list-item">$1• $3</div>');
                    
                    // Blockquotes: > text
                    processed = processed.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
                    
                    // Convert newlines to <br>
                    processed = processed.replace(/\n/g, '<br>');
                    
                    return processed;
                }
                
                // Show tooltip for copy action
                function showTooltip(element, text) {
                    const tooltip = document.createElement('div');
                    tooltip.className = 'tooltip';
                    tooltip.textContent = text;
                    tooltip.style.position = 'absolute';
                    tooltip.style.top = '-20px';
                    tooltip.style.left = '50%';
                    tooltip.style.transform = 'translateX(-50%)';
                    tooltip.style.backgroundColor = 'var(--vscode-editor-foreground)';
                    tooltip.style.color = 'var(--vscode-editor-background)';
                    tooltip.style.padding = '2px 6px';
                    tooltip.style.borderRadius = '4px';
                    tooltip.style.fontSize = '10px';
                    tooltip.style.zIndex = '1000';
                    
                    // Position tooltip
                    element.style.position = 'relative';
                    element.appendChild(tooltip);
                    
                    // Remove after a short delay
                    setTimeout(() => {
                        tooltip.remove();
                    }, 1500);
                }
                
                function escapeHTML(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }
                
                function promptToApplyCode(code, language) {
                    if (!projectContext || !projectContext.activeFile) {
                        const filePathInput = prompt('Enter file path to apply this code:', '');
                        if (filePathInput) {
                            vscode.postMessage({
                                command: 'createFile',
                                filePath: filePathInput,
                                content: code
                            });
                        }
                        return;
                    }
                    
                    const options = [
                        'Replace current selection',
                        'Replace entire file',
                        'Create new file'
                    ];
                    
                    const choice = prompt(\`How would you like to apply this code?\\n1. \${options[0]}\\n2. \${options[1]}\\n3. \${options[2]}\\n\\nEnter 1, 2, or 3:\`);
                    
                    if (!choice) return;
                    
                    switch (choice) {
                        case '1':
                            if (projectContext.selection) {
                                // Replace selection
                                vscode.postMessage({
                                    command: 'applyEdit',
                                    filePath: projectContext.activeFile,
                                    edit: {
                                        // This is a placeholder for the actual selection range
                                        // In a real implementation, you would need to get the actual range
                                        range: [0, 0, 0, 0],
                                        text: code
                                    }
                                });
                            } else {
                                alert('No text currently selected in editor');
                            }
                            break;
                            
                        case '2':
                            // Replace entire file
                            vscode.postMessage({
                                command: 'applyEdit',
                                filePath: projectContext.activeFile,
                                edit: {
                                    // Represents the entire file
                                    range: [0, 0, 999999, 0],
                                    text: code
                                }
                            });
                            break;
                            
                        case '3':
                            // Create new file
                            const filePathInput = prompt('Enter file path:', '');
                            if (filePathInput) {
                                vscode.postMessage({
                                    command: 'createFile',
                                    filePath: filePathInput,
                                    content: code
                                });
                            }
                            break;
                    }
                }
                
                // Send prompt to extension
                function sendPrompt() {
                    const text = promptInput.value.trim();
                    if (text) {
                        // Add user message to chat and history
                        addUserMessage(text);
                        
                        // Add to prompt history for up/down navigation
                        if (promptHistoryHandler) {
                            promptHistoryHandler.addToHistory(text);
                        }
                        
                        // Add to chat history
                        chatHistory.push({
                            role: 'user',
                            content: text
                        });
                        
                        // Save state
                        saveState();
                        
                        // Clear input
                        promptInput.value = '';
                        
                        // Send to extension
                        vscode.postMessage({
                            command: 'sendPrompt',
                            text: text,
                            includeContext: includeContextCheckbox.checked
                        });
                    }
                }
                
                // Add user message to chat
                function addUserMessage(text) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message';
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'user-message';
                    contentDiv.textContent = text;
                    
                    messageDiv.appendChild(contentDiv);
                    chatContainer.appendChild(messageDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                // Add bot message (or prepare for streaming)
                function addBotMessage(initialText = '') {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message';
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'bot-message';
                    contentDiv.textContent = initialText;
                    
                    const actionsDiv = document.createElement('div');
                    actionsDiv.className = 'bot-actions';
                    
                    messageDiv.appendChild(contentDiv);
                    messageDiv.appendChild(actionsDiv);
                    chatContainer.appendChild(messageDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                    
                    // Create empty assistant message in history
                    if (initialText) {
                        chatHistory.push({
                            role: 'assistant',
                            content: initialText
                        });
                    }
                    
                    return contentDiv;
                }
                
                // Add a system message (status, info, etc.)
                function addSystemMessage(text) {
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message system-message';
                    
                    const contentDiv = document.createElement('div');
                    contentDiv.className = 'system-message-content';
                    contentDiv.textContent = text;
                    
                    messageDiv.appendChild(contentDiv);
                    chatContainer.appendChild(messageDiv);
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }
                
                // Listen for messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    switch (message.command) {
                        case 'setModel':
                            currentModelName = message.model;
                            modelDisplay.textContent = `Using model: ${message.model}`;
                            saveState();
                            break;
                            
                        case 'startResponse':
                            currentResponseElement = addBotMessage();
                            
                            // Add to chat history as an empty assistant message that will be updated
                            chatHistory.push({
                                role: 'assistant',
                                content: '',
                                html: ''
                            });
                            break;
                            
                        case 'appendResponse':
                            if (currentResponseElement) {
                                // Add to the displayed content
                                currentResponseElement.textContent += message.text;
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                                
                                // Update the last assistant message in chat history
                                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
                                    chatHistory[chatHistory.length - 1].content += message.text;
                                }
                            }
                            break;
                            
                        case 'endResponse':
                            if (currentResponseElement) {
                                // Process markdown and code blocks in the response
                                const rawContent = currentResponseElement.textContent;
                                processMarkdownAndCode(currentResponseElement);
                                
                                // Store both raw and HTML content in history
                                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
                                    chatHistory[chatHistory.length - 1].content = rawContent;
                                    chatHistory[chatHistory.length - 1].html = currentResponseElement.innerHTML;
                                }
                                
                                // Add copy action for entire message
                                const actionsDiv = currentResponseElement.closest('.message').querySelector('.bot-actions');
                                if (actionsDiv) {
                                    const copyButton = document.createElement('button');
                                    copyButton.className = 'action-button';
                                    copyButton.textContent = 'Copy All';
                                    copyButton.onclick = () => {
                                        navigator.clipboard.writeText(rawContent);
                                        showTooltip(copyButton, 'Copied!');
                                    };
                                    actionsDiv.appendChild(copyButton);
                                }
                                
                                // Save state
                                saveState();
                                
                                // Reset current response element
                                currentResponseElement = null;
                            }
                            break;
                            
                        case 'error':
                            if (currentResponseElement) {
                                // Format error as italic markdown
                                currentResponseElement.textContent += '\\n\\n_Error: ' + message.message + '_';
                                
                                // Process markdown to make it look nice
                                processMarkdownAndCode(currentResponseElement);
                                
                                // Update history with the error message
                                if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
                                    chatHistory[chatHistory.length - 1].content += '\\n\\n_Error: ' + message.message + '_';
                                    chatHistory[chatHistory.length - 1].html = currentResponseElement.innerHTML;
                                }
                                
                                // Save state
                                saveState();
                                
                                currentResponseElement = null;
                            } else {
                                const errorElement = addBotMessage('_Error: ' + message.message + '_');
                                processMarkdownAndCode(errorElement);
                                
                                // Save state
                                saveState();
                            }
                            break;
                            
                        case 'projectContext':
                            projectContext = message.context;
                            updateContextPanel(projectContext);
                            break;
                            
                        case 'projectContextChanged':
                            projectContext = message.context;
                            updateContextPanel(projectContext);
                            break;
                            
                        case 'injectPrompt':
                            // Add the injected prompt to the input
                            promptInput.value = message.text;
                            // Send it automatically after a brief delay
                            setTimeout(() => {
                                sendPrompt();
                            }, 100);
                            break;
                            
                        case 'editApplied':
                        case 'fileCreated':
                        case 'fileOpened':
                            // Could add a notification or status update here
                            break;
                    }
                });
                
                // Event listeners
                sendButton.addEventListener('click', sendPrompt);
                
                // Initialize keyboard shortcuts panel
                const keyboardShortcutsPanel = document.getElementById('keyboard-shortcuts');
                const showShortcutsButton = document.getElementById('show-shortcuts');
                
                // Toggle keyboard shortcuts panel
                showShortcutsButton.addEventListener('click', () => {
                    if (keyboardShortcutsPanel.style.display === 'block') {
                        keyboardShortcutsPanel.style.display = 'none';
                    } else {
                        keyboardShortcutsPanel.style.display = 'block';
                    }
                });
                
                // Click outside to close keyboard shortcuts panel
                document.addEventListener('click', (e) => {
                    if (keyboardShortcutsPanel.style.display === 'block' && 
                        !keyboardShortcutsPanel.contains(e.target) && 
                        e.target !== showShortcutsButton) {
                        keyboardShortcutsPanel.style.display = 'none';
                    }
                });
                
                // Key press handler with Enter to send
                promptInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendPrompt();
                    }
                });
            </script>
        </body>
        </html>`;
    }
}