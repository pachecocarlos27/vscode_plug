# Ollama Enhanced for VS Code v1.3.0 - Performance Update

## Release Information

- **Version:** 1.3.0
- **Release Date:** 2025-04-04
- **SHA256 Checksum:** 9f1bf02c4ec5c4bc9225921e1304e613c7494b70ca4db7eb25648afea6f68442

## Overview

Version 1.3.0 is a major performance update focused on improving response time, language support, and robustness. This release enhances the streaming response capabilities with up to 50% faster performance, adds automatic language detection for model selection, and significantly improves timeout handling for longer responses.

## What's New

### New Features
- **Automatic language detection** - Extension now intelligently selects the best model based on your current programming language
- **Dynamic token allocation** - Smarter context management that prioritizes relevant code
- **Extended response support** - Increased maximum generation time from 45s to 20 minutes for comprehensive answers
- **Warning notifications** - New proactive notifications when approaching timeout limits

### Performance Improvements
- **50% faster streaming** - Significantly improved response time for streaming text generation
- **Enhanced syntax highlighting** - Support for 12+ programming languages with improved token handling
- **Better memory management** - More efficient handling of large codebases and project files
- **Smarter context handling** - Optimized token usage for including more relevant project context

### Fixes and Stability
- **Fixed HTML token artifacts** - Cleaner code blocks with improved HTML sanitization
- **Improved error recovery** - Better handling of network timeouts and connection issues
- **Reset timeout handling** - Extended inactivity timeout from 30s to 60s for slower models
- **Increased default timeout** - Default timeout setting increased from 90s to 300s (5 minutes)

## Installation

### VS Code Marketplace
1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Ollama Enhanced"
4. Click Install

### Manual Installation
```
code --install-extension vscode-ollama-enhanced-1.3.0.vsix
```

## Verification
Verify the integrity of the downloaded VSIX package using the SHA256 checksum:
```
9f1bf02c4ec5c4bc9225921e1304e613c7494b70ca4db7eb25648afea6f68442
```

## Documentation
For more details, refer to:
- [README.md](README.md) - General information and usage instructions
- [CHANGELOG.md](CHANGELOG.md) - Detailed changelog of all versions
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Help with common issues

## Support
If you encounter any issues, please:
1. Check the [Troubleshooting Guide](TROUBLESHOOTING.md)
2. Report issues on GitHub: https://github.com/CarlosPacheco/vscode-ollama/issues