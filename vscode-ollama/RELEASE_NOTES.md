# Ollama Enhanced for VS Code v1.3.2 - Code Formatting Fix

## Release Information

- **Version:** 1.3.2
- **Release Date:** 2025-04-05
- **SHA256 Checksum:** 426d1675a3f7898a69bfaf616c2159ebad21680b1431f8ad1ce7e2697d2b1a45

## Overview

Version 1.3.2 is a targeted bugfix update that addresses critical code formatting issues in the extension. Users were experiencing problems with broken code displays in the Ollama chat responses, particularly with multi-line code blocks and different line ending formats. This release provides comprehensive improvements to code handling, ensuring that code blocks are properly formatted regardless of the source.

## What's New in v1.3.2

### Bug Fixes
- **Fixed code formatting** - Resolved issues causing broken code displays in responses
- **Improved line ending handling** - Better support for different line ending formats (CRLF, CR, LF)
- **Enhanced code extraction** - More robust regex patterns to handle various code block formats
- **Optimized parsing performance** - Faster and more memory-efficient processing of large code blocks
- **Better whitespace handling** - Fixed issues with preservation of indentation and formatting in code

### Technical Improvements
- **Optimized parsing algorithms** - Replaced multiple string replacements with more efficient regex patterns
- **Enhanced error handling** - Better recovery from malformed code blocks
- **Improved code documentation** - Added detailed JSDoc comments for better maintainability
- **Normalized line endings** - Consistent handling of line breaks across different platforms

These improvements build upon the performance enhancements introduced in v1.3.0, which included:

- 50% faster streaming response times
- Automatic language detection for model selection
- Extended timeout support (up to 20 minutes)
- Enhanced syntax highlighting for 12+ programming languages

## Installation

### VS Code Marketplace
1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Search for "Ollama Enhanced"
4. Click Install

### Manual Installation
```
code --install-extension vscode-ollama-enhanced-1.3.2.vsix
```

## Verification
Verify the integrity of the downloaded VSIX package using the SHA256 checksum:
```
426d1675a3f7898a69bfaf616c2159ebad21680b1431f8ad1ce7e2697d2b1a45
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