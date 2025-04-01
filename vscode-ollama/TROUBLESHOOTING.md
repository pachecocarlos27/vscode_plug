# Troubleshooting Ollama for VS Code

If you're experiencing issues with the Ollama extension for VS Code, this guide will help you diagnose and solve common problems.

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

### Command-Line Diagnostics

You can run these commands in a terminal to diagnose issues:

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
ollama pull phi3:mini
```

## Enabling Debug Logging

For advanced troubleshooting, you can enable detailed logging:

1. Open VS Code settings (File → Preferences → Settings)
2. Search for "Ollama"
3. Enable the "Force Recheck" option
4. Enable the "Status Bar Polling" option
5. Restart VS Code

After restarting, check the Output panel for detailed logs.

## Reinstalling the Extension

If all else fails, you can try reinstalling the extension:

1. Uninstall the extension from VS Code
2. Close VS Code
3. Delete the extension directory:
   - Windows: `%USERPROFILE%\.vscode\extensions\ollamaextension.vscode-ollama-*`
   - macOS/Linux: `~/.vscode/extensions/ollamaextension.vscode-ollama-*`
4. Restart VS Code and reinstall the extension

## Contacting Support

If you're still experiencing issues, please submit a GitHub issue with:

1. Your OS and version
2. VS Code version
3. Ollama version
4. Extension logs from the Output panel
5. Steps to reproduce the problem
6. Any error messages you've encountered

Submit issues at: [GitHub Issues](https://github.com/yourusername/vscode-ollama/issues)