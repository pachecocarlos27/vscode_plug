# Ollama for VS Code

This VS Code extension allows you to interact with [Ollama](https://ollama.ai/) models directly from your editor with zero configuration, project awareness, and code editing capabilities similar to Cursor.

## Features

- **Zero configuration** - the extension checks if Ollama is installed and helps you install it
- **Model management** - easily download and install models directly from the extension
- **Project-aware** - understands your project context, file structure, and current file
- **Code editing** - apply AI-generated code directly to your files
- **Context menu integration** - right-click on selected code for AI actions
- **Chat interface** - interactive chat with streaming responses and code block formatting
- **Local privacy** - all operations run locally without requiring internet access
- **Status indicator** - shows Ollama status in the status bar

## No Setup Required

The extension handles everything for you:

1. Automatically checks if Ollama is installed and running
2. If not installed, provides download links for your operating system
3. If installed but not running, automatically starts Ollama for you
4. If no models are installed, helps you download and install models

## Code Interaction

Interact directly with your code using these features:

- **Context menu options** (right-click on selected code):
  - "Explain Selected Code" - Get a detailed explanation of what your code does
  - "Improve Selected Code" - Get suggestions to improve code quality and performance
  - "Generate Documentation" - Create documentation for the selected code

- **Code application options**:
  - Apply AI-generated code directly to your current file
  - Replace current selection with the suggested code
  - Replace entire file contents
  - Create new files with generated code

- **Project file explorer**:
  - Browse and open project files from within the chat panel
  - Automatically includes relevant context from your project

## Getting Started

1. Install the extension from the VS Code marketplace
2. Look for the Ollama indicator in the status bar:
   - ✓ Ollama: Installed and running 
   - ⚠ Ollama: Not installed or not running (click to install)
   - ↻ Ollama: Checking status...
3. If Ollama is not installed, the extension will guide you through installation
4. Select code in any file and right-click to use Ollama context menu options
5. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P) and run any of these commands:
   - "Ollama: Run Model" - Start chatting with a model
   - "Ollama: Download/Install Model" - Install a new model
   - "Ollama: List Models" - View and select installed models
   - "Ollama: Check Installation" - Verify Ollama installation status
   - "Ollama: Explain Selected Code" - Explain what the selected code does
   - "Ollama: Improve Selected Code" - Get suggestions to improve your code
   - "Ollama: Generate Documentation" - Generate documentation for your code

## Working Offline

This extension works completely offline once Ollama and models are installed. Perfect for:
- Air-gapped environments
- Working while traveling
- Keeping AI assistance local and private

## Recommended Models

The extension provides quick access to popular compact models that work well on most systems:
- **codellama:7b** - Meta's CodeLlama 7B model (4.3GB) optimized for code
- **gemma:7b** - Google's Gemma 7B model (4.8GB)
- **llama3:8b** - Meta's Llama 3 8B model (4.7GB)
- **mistral:7b** - Mistral 7B model (4.1GB)
- **phi3:mini** - Microsoft's Phi-3 mini model (1.7GB)
- **neural-chat:7b** - Neural Chat 7B model (4.1GB)

You can also install any custom model by name.

## Extension Settings

This extension provides the following settings:

* `ollama.apiUrl`: Set the URL for the Ollama API (default: "http://localhost:11434")
* `ollama.defaultModel`: Default model to use when not specifically selected
* `ollama.includeProjectContext`: Automatically include project context in prompts (default: true)
* `ollama.showFileExplorer`: Show project file explorer panel by default (default: false)

## Release Notes

### 0.0.1

Initial release of Ollama for VS Code:
- Automatic Ollama installation detection and assistance
- Model installation and management
- Project awareness and code editing capabilities
- Context menu integration for code operations
- Code block formatting with copy/apply buttons
- Status bar indicator for Ollama status
- Interactive chat interface with streaming responses
- Works completely offline after initial setup

## Development

### Building the Extension

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Press F5 to launch a new VS Code window with the extension loaded

### Packaging the Extension

```bash
npm install -g @vscode/vsce
vsce package
```

This will create a `.vsix` file that can be installed in VS Code.

## License

MIT