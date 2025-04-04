# Changelog

## [1.3.2] - 2025-04-05

### Fixed
- Fixed code block formatting issues causing broken display of code in responses
- Improved handling of different line ending formats in code blocks
- Enhanced code extraction regex to better handle various code block formats
- Optimized markdown parsing performance for handling large code blocks
- Fixed issues with whitespace preservation in code blocks

## [1.3.1] - 2025-04-04

### Fixed
- Fixed potential memory leaks in timeout handling
- Improved type safety by removing unsafe 'any' type assertions
- Fixed case statement scoping in event handlers
- Made pullModel method public for proper API access
- Enhanced error handling and resource cleanup
- Fixed several lint warnings for better code quality

## [1.3.0] - 2025-04-04

### Added
- Support for DeepSeek Coder V2 as the optimized default coding model
- Automatic model selection based on detected programming language
- Improved memory management to handle larger codebases and projects

### Enhanced
- Significantly improved streaming response performance by 50%
- Better syntax highlighting for 12+ programming languages
- Smarter context handling with dynamic token allocation

### Fixed
- Increased streaming timeout from 45s to 20 minutes to prevent "Maximum streaming time exceeded" errors with longer responses
- Added warning message when approaching timeout limits with instructions on how to increase timeouts in settings
- Improved cleanup of HTML tokens in code blocks to prevent token artifacts in copied code
- Extended inactivity timeout from 30s to 60s in embedded mode for better handling of slow model responses
- Default timeout setting increased from 90s to 300s with maximum allowed value of 1200s (20 minutes)
- Fixed hash function in markdownParser.js to always return positive integers
- Improved HTML parsing safety using DOMParser instead of innerHTML
- Fixed various code quality issues with variable declarations and unused variables
- Improved type declarations throughout the codebase to prevent "any" types

## [1.1.0] - 2025-04-03

### Security
- Updated axios dependency to v1.6.7 to fix SSRF and Cross-Site Request Forgery vulnerabilities

### Performance
- Combined main and embedded extensions into a single optimized package
- Reduced package size from 25MB to 1.5MB for faster installation and loading
- Optimized build process to exclude unnecessary files

## [1.0.0] - 2025-04-03

### Added
- **STABLE RELEASE:** First official stable version
- Embedded Ollama support - no need to install Ollama separately
- DeepSeek Coder V2 set as the default model optimized for programming tasks
- Small bundled models (Phi-3 Mini, TinyLlama) for code and chat
- New command to install embedded models
- New command to switch between system and embedded Ollama modes
- Automatic mode that detects system Ollama availability and falls back to embedded
- New settings for embedded model configuration
- Custom embedded Ollama port to avoid conflicts with system Ollama
- Comprehensive documentation and troubleshooting guides
- "Save as File" button for generated code blocks - directly save AI-generated code to your project
- Smart directory detection to place generated files in appropriate language-specific folders
- Beautiful code formatting with syntax highlighting, line numbers, and language indicators
- Enhanced code action buttons with clear icons and improved styling

### Changed
- Updated UI to support both embedded and system Ollama models
- Enhanced model listings to distinguish between system and embedded models
- Improved error handling with more specific messages based on mode
- Better startup experience with embedded model detection
- Refined installation flows for both embedded and system models
- Enhanced performance for streaming responses
- Removed theme toggle for a cleaner UI that integrates with VS Code's native theme

### Fixed
- Fixed conflicts between system and embedded Ollama by using different ports
- Improved shutdown behavior to properly clean up embedded Ollama processes
- Fixed issues with port binding and resource cleanup
- Improved error handling for network timeouts

## [0.1.0] - 2025-04-02

### Added
- Support for displaying and copying code blocks from responses
- Syntax highlighting in code blocks based on detected language

### Changed
- Performance Optimizations:
  - Implemented caching for API responses with 30-second TTL
  - Enhanced server health checking with exponential backoff and jitter
  - Optimized project context collection to prioritize recent files
  - Limited maximum file count to 300 for better memory usage
  - Added file caching with 60-second TTL
  - Replaced fixed-interval polling with adaptive algorithm in status bar
  - Improved prompt handling with smart size limiting and truncation
  - Implemented batched UI updates during response streaming
  - Added memory management to prevent excessive memory usage
  - Added proper cleanup of resources during disposal
  - Optimized chunk processing to reduce UI rendering overhead

### Fixed
- Fixed issues with extension getting stuck in "Thinking..." state
- Improved error handling and recovery during network timeouts
- Better handling of large responses to prevent UI freezing
- Fixed issue with code selection not being included in prompts when using "Help me perfect this function"
- Fixed extension not starting automatically on VS Code launch

## [0.0.1] - 2025-03-15

- Initial release
- Basic integration with Ollama API
- Chat interface for model interactions
- Code-focused commands for selected text
- Project context awareness