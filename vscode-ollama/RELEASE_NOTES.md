# Ollama Enhanced for VS Code v1.1.0 - Production Release

## Release Information

- **Version:** 1.1.0
- **Release Date:** 2025-04-03
- **SHA256 Checksum:** d6a5f68d9233c8c5763d3748970e7ac14cd7b06c296f552df02213cf1987a1bd

## Overview

This release focuses on security improvements and package optimization, combining the main and embedded extensions into a single streamlined package while addressing important security vulnerabilities.

## What's New

### Security Enhancements
- Fixed SSRF (Server-Side Request Forgery) vulnerabilities in Axios dependencies
- Fixed Cross-Site Request Forgery vulnerabilities in Axios dependencies
- Updated all Axios dependencies to secure version 1.6.7

### Performance Optimizations
- Combined main and embedded extensions into a single optimized package
- Reduced package size from 25MB to 1.5MB (94% reduction) for faster installation and loading
- Streamlined build process to exclude unnecessary files
- Improved overall package structure for better maintainability

## Installation

### VS Code Marketplace
1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Ollama Enhanced"
4. Click Install

### Manual Installation
```
code --install-extension vscode-ollama-enhanced-1.1.0.vsix
```

## Verification
Verify the integrity of the downloaded VSIX package using the SHA256 checksum:
```
d6a5f68d9233c8c5763d3748970e7ac14cd7b06c296f552df02213cf1987a1bd
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