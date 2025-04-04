# Ollama Enhanced for VS Code (v1.3.1)

Run [Ollama](https://ollama.ai) models directly from VS Code for AI-powered code editing, analysis, and chat - now with built-in Ollama for easier setup! No external installation required.

![Ollama Enhanced for VS Code](https://raw.githubusercontent.com/CarlosPacheco/vscode-ollama/main/logo.png)

## Features

* **Built-in Ollama engine** - No external installation required!
* **Pre-packaged small models** - Start coding with AI immediately
* **Smart mode switching** - Automatically detects and uses the best available Ollama setup
* **Save generated code to project** - Instantly save AI-generated code as files
* **Context-aware AI** - The assistant understands your project structure and code
* **Code operations** - Explain, improve, and document your code with one click
* **Beautiful code formatting** - Enhanced code blocks with syntax highlighting and line numbers
* **Privacy focused** - All processing happens locally on your machine
* **Compatible with all Ollama models** - Works with Llama, Mistral, Phi, Gemma, and more

## What's New in Version 1.3.1

Version 1.3.1 focuses on stability, reliability, and code quality:

* **Enhanced memory management** - Fixed potential memory leaks in timeout handling
* **Improved type safety** - Eliminated unsafe type assertions for better reliability
* **Better error handling** - More robust error recovery and detailed feedback
* **Code quality improvements** - Fixed variable declarations and scoping issues
* **Resource management** - Enhanced lifecycle handling for WebView panels
* **API refinements** - Public access to core functionality for better extensibility
* **Addressed lint warnings** - Resolved code quality issues from static analysis

These improvements build upon the performance enhancements from v1.3.0:

* **Performance boost** - 50% faster streaming responses for smoother interactions
* **Automatic language detection** - Extension selects the best model for your current language
* **Extended timeout handling** - Support for longer responses up to 20 minutes
* **Enhanced syntax highlighting** - Support for 12+ programming languages

## Quick Install

### [⬇️ Download v1.3.1 VSIX](https://github.com/CarlosPacheco/vscode-ollama/releases/download/v1.3.1/vscode-ollama-enhanced-1.3.1.vsix)

SHA256: `3f618a8756da735d5e75b392408e7168831c80e7f05e6f547c445e671c010cff`

See [INSTALLATION.md](INSTALLATION.md) for detailed installation instructions.

## Requirements

* VS Code 1.60.0 or higher
* **OPTIONAL:** [Ollama](https://ollama.ai) installed on your system (for using larger models)

## Getting Started

Version 1.0 offers multiple ways to get started based on your needs:

### Option 1: Using Embedded Ollama (Recommended for Beginners)

1. Install the extension from the VS Code marketplace
2. Click the Ollama icon in the sidebar or run the "Ollama Enhanced: Install Embedded Model" command
3. Select a model (DeepSeek Coder V2 is pre-selected as the default)
4. Wait for the model to install (usually less than a minute)
5. Start using AI assistance right away!

### Option 2: Using System Ollama (For Advanced Users)

1. Install [Ollama](https://ollama.ai) on your system 
2. Pull a model: `ollama pull llama3:8b` or `ollama pull codellama:7b`
3. Install this extension
4. The extension automatically detects your Ollama installation
5. Run "Ollama Enhanced: Run Model" to start

### Option 3: Auto Mode (Default)

By default, the extension operates in "Auto" mode, which:
1. Checks for a system Ollama installation first
2. Falls back to embedded mode if system Ollama isn't available
3. Recommends the best approach based on your environment

You can switch modes anytime using the "Ollama Enhanced: Switch Mode" command.

## Key Features in Detail

### Code Generation and Management

The extension provides powerful tools for working with AI-generated code:

#### Save Code to File
When you receive code in a response, you'll see three action buttons:
- **Copy** - Copy code to clipboard
- **Save as File** - Save code as a file in your project
- **Apply to Editor** - Insert code at current cursor position

The "Save as File" feature will:
1. Automatically detect the programming language
2. Find the appropriate directory in your project structure
3. Suggest a filename with the right extension
4. Create the file and open it in the editor

#### Code Operations
Select code in your editor and right-click to access:
- **Explain Selected Code** - Get a detailed explanation of how the code works
- **Improve Selected Code** - Receive suggestions for optimization, best practices, and bug fixes
- **Generate Documentation** - Create comprehensive documentation for the selected code
- **Add Selection as Reference** - Include the selected code as context for future chat

### Operation Modes

The extension offers three operation modes:

#### 1. Embedded Mode
- Uses Ollama bundled with the extension
- No external installation required
- Includes small, efficient models for coding tasks
- Perfect for restricted environments or quick setup

#### 2. System Mode
- Uses Ollama installed on your system
- Supports all Ollama models (including larger ones)
- Provides more flexibility and customization
- Good for users who already use Ollama

#### 3. Auto Mode (Default)
- Automatically selects the best mode
- Tries system Ollama first, falls back to embedded
- Seamlessly adapts to your environment
- Recommended for most users

## Commands

* `Ollama Enhanced: Run Model` - Start a chat session with a model
* `Ollama Enhanced: List Models` - Show all available models
* `Ollama Enhanced: Install Embedded Model` - Install a bundled model
* `Ollama Enhanced: Download/Install Model` - Pull a model from Ollama library
* `Ollama Enhanced: Switch Mode` - Change between system, embedded, or auto modes
* `Ollama Enhanced: Explain Selected Code` - Get code explanation
* `Ollama Enhanced: Improve Selected Code` - Receive code improvement suggestions
* `Ollama Enhanced: Generate Documentation` - Create documentation for code
* `Ollama Enhanced: Add Selection as Reference` - Use selected code as context
* `Ollama Enhanced: Check Installation` - Verify Ollama setup

## Settings

### Core Settings

* `ollamaEnhanced.mode` - Operation mode: "system", "embedded", or "auto" (default)
* `ollamaEnhanced.defaultModel` - Model to use by default when not specified

### System Ollama Settings

* `ollamaEnhanced.apiUrl` - System Ollama API URL (default: http://localhost:11434)
* `ollamaEnhanced.temperature` - Temperature for generation (0.0-2.0, default: 0.7)
* `ollamaEnhanced.maxResponseTokens` - Max tokens in responses (default: 4096)
* `ollamaEnhanced.requestTimeout` - Timeout for requests in seconds (default: 300, max: 1200)

### Embedded Ollama Settings

* `ollamaEnhanced.embeddedPort` - Port for embedded Ollama (default: 9527)
* `ollamaEnhanced.embeddedModelsAutoUpdate` - Auto-update embedded models

### Project Context Settings

* `ollamaEnhanced.includeProjectContext` - Include project context in prompts
* `ollamaEnhanced.filePatterns` - File patterns to include in context
* `ollamaEnhanced.excludePatterns` - File patterns to exclude from context

## Troubleshooting

For common issues and solutions, please refer to our detailed [TROUBLESHOOTING.md](TROUBLESHOOTING.md) guide.

Common troubleshooting tasks:
- Switching between operation modes
- Checking server status
- Resolving port conflicts
- Resolving model installation issues

## Examples and Use Cases

### 1. Generate Utility Functions
```
Write a utility function to parse CSV files in JavaScript with proper error handling
```

### 2. Explain Complex Code
Select a complex piece of code and use "Explain Selected Code" to get a detailed breakdown of what it does.

### 3. Improve Performance
Select code that runs slowly and use "Improve Selected Code" to get optimization suggestions.

### 4. Generate Documentation
Select a class or function and use "Generate Documentation" to create comprehensive documentation.

### 5. Create Boilerplate Code
```
Create a React component for a responsive navigation menu with dark mode support
```

### 6. Fix Bugs
Share code that has a bug and ask:
```
This code isn't working correctly. It should [expected behavior] but instead it [actual behavior]. What's the issue?
```

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for all updates and changes.

### 1.3.0 - Performance Update (April 2025)

- **NEW:** Automatic language detection for smart model selection
- **NEW:** Support for extended response generation (up to 20 minutes)
- **NEW:** Dynamic token allocation for improved context handling
- **IMPROVED:** 50% faster streaming response performance
- **IMPROVED:** Enhanced syntax highlighting for 12+ languages
- **IMPROVED:** Better memory management for large codebases
- **IMPROVED:** More robust error handling and recovery
- **FIXED:** HTML token artifacts in copied code
- **FIXED:** Various stability and performance issues

### 1.0.0 - Stable Release (April 2025)

- **STABLE:** First official stable release
- **NEW:** Embedded Ollama with zero installation
- **NEW:** DeepSeek Coder V2 as the default model for superior coding assistance
- **NEW:** Small bundled models (Phi-3 Mini, TinyLlama)
- **NEW:** Save generated code as files with smart directory detection
- **NEW:** Automatic mode switching between system and embedded Ollama
- Enhanced configuration options for all modes
- Improved UX with a clean, distraction-free interface
- Better error handling and recovery
- Comprehensive documentation and troubleshooting guides

## License

[MIT](LICENSE)