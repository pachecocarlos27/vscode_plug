# Changelog

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