# Changelog

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