# Installation Guide for Ollama Enhanced v1.3.0

This guide provides instructions for installing Ollama Enhanced for VS Code v1.3.0.

## Installation Methods

### Method 1: VS Code Marketplace (Recommended)

1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X or Cmd+Shift+X on macOS)
3. Search for "Ollama Enhanced"
4. Click Install
5. Reload VS Code when prompted

### Method 2: Manual Installation

If you prefer to install the extension manually:

1. Download the VSIX file from:
   - [GitHub Releases](https://github.com/CarlosPacheco/vscode-ollama/releases/tag/v1.3.0)
   - Direct download: [vscode-ollama-enhanced-1.3.0.vsix](https://github.com/CarlosPacheco/vscode-ollama/releases/download/v1.3.0/vscode-ollama-enhanced-1.3.0.vsix)

2. Verify the SHA256 checksum:
   ```
   9f1bf02c4ec5c4bc9225921e1304e613c7494b70ca4db7eb25648afea6f68442  vscode-ollama-enhanced-1.3.0.vsix
   ```

3. Install from VS Code:
   - Open VS Code
   - Go to Extensions view
   - Click the "..." menu in the top-right corner
   - Select "Install from VSIX..."
   - Navigate to the downloaded VSIX file and select it

4. Alternatively, install from the command line:
   ```
   code --install-extension vscode-ollama-enhanced-1.3.0.vsix
   ```

## Post-Installation Setup

After installing Ollama Enhanced:

1. Restart VS Code to ensure the extension is properly activated
2. Click the Ollama icon in the sidebar or run "Ollama Enhanced: Run Model" command
3. Choose between:
   - **Embedded Mode**: Use the built-in Ollama (recommended for beginners)
   - **System Mode**: Use your existing Ollama installation
   - **Auto Mode**: Let the extension decide the best option (default)

## Embedded Mode Setup

If using Embedded Mode:

1. Run "Ollama Enhanced: Install Embedded Model" command
2. Select a model:
   - DeepSeek Coder V2 (recommended for coding tasks)
   - Phi-3 Mini (smaller, faster model)
3. Wait for the model to download (will take a few minutes)
4. Start using Ollama Enhanced!

## System Mode Setup

If using System Mode:

1. Ensure you have [Ollama](https://ollama.ai) installed on your system
2. Make sure Ollama is running (`ollama serve` command)
3. Check that you have at least one model installed (`ollama list` command)
4. If needed, install a model: `ollama pull deepseek-coder-v2`

## Troubleshooting

If you encounter issues:

1. Check the [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Verify your VS Code version is 1.60.0 or higher
3. Try restarting VS Code
4. Check extension output channels for detailed logs:
   - View > Output > Ollama Service
   - View > Output > Ollama API

## Verifying Installation

To verify your installation:

1. Run the "Ollama Enhanced: Check Installation" command
2. This will validate your Ollama setup and report any issues

## System Requirements

- VS Code 1.60.0 or higher
- 4GB RAM minimum (8GB+ recommended)
- 2GB free disk space for embedded models
- Internet connection for initial setup (not required for ongoing use)

## Updates

When new versions are released:

1. VS Code will automatically prompt you to update
2. Or manually check for updates via Extensions view

For detailed release notes, see [CHANGELOG.md](CHANGELOG.md).