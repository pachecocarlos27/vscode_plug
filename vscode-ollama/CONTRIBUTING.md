# Contributing to Ollama for VS Code

Thank you for your interest in contributing to the Ollama for VS Code extension! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md) to foster an open and welcoming environment.

## How Can I Contribute?

### Reporting Bugs

Bugs are tracked as [GitHub issues](https://github.com/CarlosPacheco/vscode-ollama/issues). When creating a bug report, please include as much detail as possible:

1. **Use a clear and descriptive title** for the issue.
2. **Provide detailed steps to reproduce the problem**:
   - Be specific!
   - Include screenshots or GIFs if possible.
3. **Describe the behavior you observed and what you expected to see**.
4. **Include the extension version, VS Code version, and your OS**.
5. **Include logs** from the VS Code Developer Console:
   - Open the Developer Tools (`Help > Toggle Developer Tools` or `Ctrl+Shift+I`/`Cmd+Option+I`).
   - Look for logs relevant to the Ollama extension.

### Feature Requests

Feature requests are welcome! When submitting a feature request:

1. **Use a clear and descriptive title**.
2. **Provide a detailed description of the proposed feature**.
3. **Explain why this feature would be useful to most users**.
4. **If possible, include mockups or examples** of how the feature might work.

### Pull Requests

1. **Fork the repository** and create a new branch from `main`.
2. **Make your changes** in the new branch.
3. **Add or update tests** as necessary.
4. **Update the documentation** to reflect any changes.
5. **Submit a pull request** to the `main` branch.
6. **Wait for review**. The maintainers will review your PR as soon as possible.

## Development Workflow

### Setting Up Your Development Environment

1. **Clone the repository**:
   ```bash
   git clone https://github.com/CarlosPacheco/vscode-ollama.git
   cd vscode-ollama
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build the extension**:
   ```bash
   npm run compile
   ```

4. **Run the extension in development mode**:
   - Press `F5` in VS Code to launch a new window with the extension loaded.

### Coding Guidelines

#### TypeScript

- Follow the [TypeScript coding guidelines](https://github.com/Microsoft/TypeScript/wiki/Coding-guidelines).
- Use strongly typed variables and function return types.
- Use async/await for asynchronous operations.
- Document your code with JSDoc comments.

#### VS Code API

- Follow the [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines).
- Use the VS Code API consistently and as recommended.
- Handle disposables properly to avoid memory leaks.

### Commit Messages

- Use the present tense ("Add feature" not "Added feature").
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...").
- Limit the first line to 72 characters or less.
- Reference issues and pull requests after the first line.

### Testing

- Write tests for new features or bug fixes.
- Run tests before submitting a PR:
  ```bash
  npm test
  ```

### Documentation

- Update the README.md file with any necessary changes.
- Document new features or changes to existing features.
- Include code examples where appropriate.

## Building and Packaging

1. **Build the extension**:
   ```bash
   npm run compile
   ```

2. **Package the extension**:
   ```bash
   npm run package
   ```

3. **Install the packaged extension**:
   ```bash
   code --install-extension vscode-ollama-enhanced-1.0.0.vsix
   ```

## Contact

If you have questions or need help, you can:

- Create an issue on [GitHub](https://github.com/CarlosPacheco/vscode-ollama/issues).
- Contact the maintainers directly through the contact information in the README.

## Attribution

This Contributing guide is adapted from the [Atom Contributing guide](https://github.com/atom/atom/blob/master/CONTRIBUTING.md).

Thank you for contributing to Ollama for VS Code!