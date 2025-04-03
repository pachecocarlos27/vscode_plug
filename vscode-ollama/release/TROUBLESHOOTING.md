# Troubleshooting Ollama Enhanced for VS Code v1.0

Welcome to the troubleshooting guide for Ollama Enhanced v1.0. This document will help you resolve common issues and get the most out of the extension with DeepSeek Coder V2 and other embedded models.

## Quick Start Troubleshooting

If you're experiencing issues with the extension, try these quick fixes first:

1. **Restart VS Code** - This refreshes all extensions and often resolves temporary issues
2. **Switch Operation Modes** - Use "Ollama Enhanced: Switch Mode" to try a different operation mode
3. **Check Output Logs** - Open VS Code's Output panel and select "Ollama" to view detailed logs
4. **Reinstall Models** - Try reinstalling your embedded models or pulling system models again

## Operation Modes

Version 1.0 introduces a flexible operating mode system that adapts to your needs:

1. **System Mode**: Uses Ollama installed on your system
   - Best for: Users who already have Ollama installed or want to use larger models
   - Advantages: Access to all models in Ollama library, full customization options
   - Requirements: Ollama must be installed separately

2. **Embedded Mode**: Uses Ollama bundled with the extension
   - Best for: New users, restricted environments, or quick setup
   - Advantages: No installation required, works offline, simple setup
   - Limitations: Only supports bundled smaller models

3. **Auto Mode** (default): Intelligently selects the best available option
   - Best for: Most users
   - Behavior: Tries system Ollama first, automatically falls back to embedded if needed
   - Advantages: Seamless experience, adapts to environment changes

You can switch between modes at any time using the "Ollama Enhanced: Switch Mode" command.

## Common Issues and Solutions

### Status Bar is Not Showing Ollama Status

If the status bar icon is not appearing or not showing the correct Ollama status:

1. **Check the Output Logs**:
   - Open VS Code
   - Go to View → Output
   - Select "Ollama" or "Ollama Service" from the dropdown menu
   - Look for any error messages or connection issues

2. **Verify Ollama Installation**:
   - Open a terminal and run: `ollama --version`
   - If it's not found, [install Ollama](https://ollama.ai/download)

3. **Check if Ollama Server is Running**:
   - Open a terminal and run: `ollama ps`
   - If no models are listed, start the server with: `ollama serve`

4. **Check API URL Configuration**:
   - Go to Settings → Extensions → Ollama
   - Verify that the API URL is set correctly (default is http://localhost:11434)
   - Try setting it explicitly if it's using the default value

5. **Force a Status Recheck**:
   - Go to Settings → Extensions → Ollama
   - Enable the "Force Recheck" option temporarily
   - Run the command "Ollama: Check Installation"
   - Disable the option afterward

### Cannot Connect to Ollama Server

If you see connection errors in the logs:

1. **Verify Server is Running**:
   - Open a terminal and run: `curl http://localhost:11434/api/tags`
   - You should get a JSON response with model information
   - If not, the server may not be running or is inaccessible

2. **Start Ollama Manually**:
   - Open a terminal and run: `ollama serve`
   - Keep the terminal open and try using the extension again

3. **Check Firewall Settings**:
   - Ensure port 11434 is not blocked by your firewall

4. **Network Configuration Issues**:
   - If using a non-standard setup, ensure the correct API URL is specified in settings

### Models Not Showing Up

If you don't see your models in the extension:

1. **List Models in Terminal**:
   - Run: `ollama list`
   - If models appear here but not in the extension, there may be a communication issue

2. **Pull a Model Manually**:
   - Run: `ollama pull gemma:7b` (or another model)
   - Then try listing models in the extension again

3. **Check the Extension Logs**:
   - Look in the Output panel for any errors related to listing models

### Common Issues by Feature

### Code Formatting Issues

1. **Syntax Highlighting Not Working**:
   - Ensure code blocks have language indicators in markdown (e.g., ```javascript)
   - The extension automatically detects common languages but some may need explicit tags
   - If no language is specified, the code will still display with line numbers but without syntax highlighting

2. **Line Numbers Not Displaying**:
   - Ensure you're using the latest version of the extension
   - Check that the code is properly formatted within triple backtick markers
   - If the issue persists, try refreshing the chat panel (click the refresh icon in the panel header)

3. **Code Action Buttons Not Appearing**:
   - Verify the `ollamaEnhanced.codeActionsEnabled` setting is turned on in your VS Code settings
   - Ensure the code block is properly formatted with language indicators
   - The buttons should appear below properly formatted code blocks

### Save Code to File Issues

1. **Cannot Save File**:
   - Ensure you have write permissions for your project directory
   - Check if the target directory exists and is accessible
   - Verify that the filename is valid (no special characters like `/\:*?"<>|`)

2. **File Saved to Wrong Location**:
   - The extension tries to find the most appropriate folder based on the language
   - You can manually specify the location by editing the suggested path
   - Files will save to a "generated" folder in the project root if no suitable directory is found

3. **Language Not Detected**:
   - Ensure the code block has a language tag (e.g., ```javascript)
   - If no language is specified, the file will default to .txt extension
   - You can manually change the extension in the save dialog

### Embedded Mode Issues

1. **Embedded Models Not Installing**:
   - Check the Output panel for detailed error messages
   - Ensure you have sufficient disk space (models require ~600MB-2GB each)
   - Check your network connection if the model needs to be downloaded
   - Try restarting VS Code and attempting the installation again

2. **Port Conflicts**:
   - If you see errors about address already in use:
     - Check if another application is using port 9527 (default for embedded mode)
     - Change the embedded port in settings: `ollamaEnhanced.embeddedPort`
     - Restart VS Code after changing the port

3. **Embedded Models Not Loading**:
   - Try reinstalling the embedded model
   - Check the Output panel for detailed error messages
   - Verify the embedded-models directory exists in your extension path
   - If the issue persists, switch to auto mode to try system Ollama

## System Mode Diagnostics

You can run these commands in a terminal to diagnose system Ollama issues:

```bash
# Check Ollama version
ollama --version

# Check if Ollama is running
curl http://localhost:11434/api/tags

# List installed models
ollama list

# Check running models
ollama ps

# Start the Ollama server
ollama serve

# Pull a test model (if none installed)
ollama pull deepseek-coder-v2:latest
```

## Switching Between Modes

If you're having issues with one mode, try switching to another:

1. Open the command palette (Ctrl+Shift+P or Cmd+Shift+P)
2. Type "Ollama Enhanced: Switch Mode" and select it
3. Choose between System, Embedded, or Auto mode
4. Restart VS Code to ensure the change takes effect

Here's when to use each mode:
- **System Mode**: When you have Ollama installed and want to use larger models
- **Embedded Mode**: When you can't install Ollama or need a completely self-contained solution
- **Auto Mode**: When you want the extension to automatically pick the best option

## Enabling Debug Logging

For advanced troubleshooting, you can enable detailed logging:

1. Open VS Code settings (File → Preferences → Settings)
2. Search for "Ollama Enhanced"
3. Enable the "Force Recheck" option
4. Enable the "Status Bar Polling" option
5. Restart VS Code

After restarting, check the Output panel for detailed logs:
1. Go to View → Output
2. Select "Ollama", "Ollama Service", or "Ollama API" from the dropdown

## Troubleshooting "Save as File" Feature

If you're having trouble saving generated code:

1. **Check workspace access**:
   - VS Code needs a workspace folder open to save files
   - If you're using a single file, save it first to create a workspace

2. **Verify file extension**:
   - The extension automatically detects the language from code blocks
   - You can change the extension manually in the save dialog

3. **Directory structure issues**:
   - The extension tries to save files in appropriate directories
   - If no matching directory is found, files go to a "generated" folder
   - You can always modify the suggested path in the save dialog

## Reinstalling the Extension

If all else fails, you can try reinstalling the extension:

1. Uninstall the extension from VS Code
2. Close VS Code
3. Delete the extension directory:
   - Windows: `%USERPROFILE%\.vscode\extensions\CarlosPacheco.vscode-ollama-enhanced-*`
   - macOS/Linux: `~/.vscode/extensions/CarlosPacheco.vscode-ollama-enhanced-*`
4. Restart VS Code and reinstall the extension

This will give you a completely fresh installation, which often resolves persistent issues.

## Contacting Support

If you're still experiencing issues, please submit a GitHub issue with:

1. Your OS and version
2. VS Code version
3. Ollama version
4. Extension logs from the Output panel
5. Steps to reproduce the problem
6. Any error messages you've encountered

Submit issues at: [GitHub Issues](https://github.com/CarlosPacheco/vscode-ollama/issues)