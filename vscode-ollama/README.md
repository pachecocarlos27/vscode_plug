# Ollama for VS Code

Run [Ollama](https://ollama.ai) models directly from VS Code for AI-powered code editing, analysis, and chat.

## Features

* Chat with Ollama models directly in VS Code
* Use local models for better privacy and performance
* Get code explanations, improvements, and documentation
* Context-aware AI assistance that understands your project
* Compatible with all Ollama models (Llama, Mistral, Phi, Gemma, etc.)

## Requirements

* [Ollama](https://ollama.ai) must be installed and running on your system
* At least one model must be installed with Ollama
* VS Code 1.60.0 or higher

## Getting Started

1. Install [Ollama](https://ollama.ai) if you haven't already
2. Install at least one model using `ollama pull modelname` (e.g., `ollama pull llama3:8b` or `ollama pull codellama:7b`)
3. Make sure the Ollama service is running (it should start automatically)
4. Install this extension from the VS Code marketplace
5. Run the "Ollama: Run Model" command to start chatting

## Commands

* `Ollama: Run Model` - Start chatting with an Ollama model
* `Ollama: List Models` - Show installed Ollama models
* `Ollama: Download/Install Model` - Pull a new model from Ollama library
* `Ollama: Explain Selected Code` - Explain the currently selected code
* `Ollama: Improve Selected Code` - Get suggestions to improve selected code
* `Ollama: Generate Documentation` - Generate documentation for selected code

## Settings

* `ollama.apiUrl` - URL of the Ollama API server (default: http://localhost:11434)
* `ollama.defaultModel` - Model to use by default when not specified
* `ollama.includeProjectContext` - Whether to include project context in prompts
* `ollama.maxResponseTokens` - Maximum number of tokens in model responses
* `ollama.temperature` - Temperature setting for model generation (0.0-2.0)

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for all updates and changes.

### 0.1.0

- Performance optimizations for faster response times
- Better handling of large files and project context
- Improved code selection handling
- Fixed automatic activation on startup
- Better error recovery and timeout handling

## License

[MIT](LICENSE)