# VSCode Plug 🔌

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/pachecocarlos27.vscode-plug)](https://marketplace.visualstudio.com/items?itemName=pachecocarlos27.vscode-plug)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/pachecocarlos27.vscode-plug)](https://marketplace.visualstudio.com/items?itemName=pachecocarlos27.vscode-plug)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/pachecocarlos27.vscode-plug)](https://marketplace.visualstudio.com/items?itemName=pachecocarlos27.vscode-plug)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A powerful VS Code extension that enhances your development workflow with intelligent code snippets, productivity tools, and seamless integrations.

## ✨ Features

### 🚀 Smart Code Snippets
- **Context-aware snippets**: Automatically suggests relevant code based on your current file and cursor position
- **Custom snippet creation**: Easy-to-use interface for creating your own snippets
- **Language support**: Works with JavaScript, TypeScript, Python, Java, and more

### 🔧 Productivity Tools
- **Quick file navigation**: Jump to any file with fuzzy search
- **Code formatting**: One-click formatting with customizable rules
- **Multi-cursor enhancements**: Advanced multi-cursor operations
- **Terminal integration**: Run commands directly from the editor

### 🎨 UI Enhancements
- **Custom themes**: Beautiful color themes optimized for long coding sessions
- **Status bar widgets**: Useful information at a glance
- **Sidebar panels**: Quick access to frequently used tools

## 📸 Screenshots

<div align="center">
  <img src="images/demo.gif" alt="VSCode Plug Demo" width="600"/>
  <p><em>VSCode Plug in action</em></p>
</div>

## 🚀 Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+P` / `Cmd+P` to open the Quick Open dialog
3. Type `ext install pachecocarlos27.vscode-plug`
4. Click Install

### From VSIX

1. Download the `.vsix` file from [Releases](https://github.com/pachecocarlos27/vscode_plug/releases)
2. Open VS Code
3. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
4. Type "Install from VSIX"
5. Select the downloaded file

## 🎯 Quick Start

After installation, you can access VSCode Plug features through:

1. **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`): Type "VSCode Plug" to see all commands
2. **Keyboard Shortcuts**: See [Keyboard Shortcuts](#keyboard-shortcuts) section
3. **Context Menu**: Right-click in the editor for quick actions
4. **Status Bar**: Click the plug icon in the status bar

## 📖 Usage

### Basic Commands

```
VSCode Plug: Insert Snippet       - Insert a code snippet
VSCode Plug: Format Document      - Format current document
VSCode Plug: Toggle Feature       - Enable/disable features
VSCode Plug: Open Settings        - Configure extension
```

### Creating Custom Snippets

1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "VSCode Plug: Create Snippet"
3. Follow the interactive prompt:

```typescript
// Example custom snippet
{
  "name": "React Component",
  "prefix": "rfc",
  "body": [
    "import React from 'react';",
    "",
    "const ${1:ComponentName} = () => {",
    "  return (",
    "    <div>",
    "      ${2:// Your code here}",
    "    </div>",
    "  );",
    "};",
    "",
    "export default ${1:ComponentName};"
  ],
  "description": "Create a React functional component"
}
```

### Configuration

Configure VSCode Plug in your `settings.json`:

```json
{
  // Enable/disable features
  "vscodePlug.enableSnippets": true,
  "vscodePlug.enableFormatting": true,
  "vscodePlug.enableTerminalIntegration": true,
  
  // Snippet settings
  "vscodePlug.snippetTriggerKey": "tab",
  "vscodePlug.customSnippetsPath": "./snippets",
  
  // Formatting options
  "vscodePlug.formatOnSave": true,
  "vscodePlug.formatOnType": false,
  
  // UI preferences
  "vscodePlug.showStatusBarIcon": true,
  "vscodePlug.theme": "dark"
}
```

## ⌨️ Keyboard Shortcuts

| Command | Windows/Linux | macOS |
|---------|---------------|-------|
| Insert Snippet | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| Format Document | `Shift+Alt+F` | `Shift+Opt+F` |
| Quick Open | `Ctrl+Alt+O` | `Cmd+Alt+O` |
| Toggle Terminal | `Ctrl+Alt+T` | `Cmd+Alt+T` |
| Command Palette | `Ctrl+Shift+P` | `Cmd+Shift+P` |

## 🔧 Development

### Prerequisites

- Node.js (>= 14.x)
- VS Code (>= 1.60.0)
- TypeScript (>= 4.0)

### Setup

```bash
# Clone the repository
git clone https://github.com/pachecocarlos27/vscode_plug.git
cd vscode_plug

# Install dependencies
npm install

# Build the extension
npm run build

# Run tests
npm test

# Package the extension
npm run package
```

### Project Structure

```
vscode_plug/
├── src/
│   ├── extension.ts      # Extension entry point
│   ├── commands/         # Command implementations
│   ├── providers/        # VS Code providers
│   ├── snippets/         # Built-in snippets
│   └── utils/            # Utility functions
├── resources/            # Icons and assets
├── syntaxes/            # Language grammars
├── themes/              # Color themes
├── test/                # Test files
└── package.json         # Extension manifest
```

### Running in Development

1. Open the project in VS Code
2. Press `F5` to open a new VS Code window with the extension loaded
3. Set breakpoints in your code
4. Debug your extension

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration

# Run with coverage
npm run test:coverage

# Lint code
npm run lint
```

## 📦 Publishing

```bash
# Package the extension
vsce package

# Publish to marketplace
vsce publish
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

### How to Contribute

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- VS Code team for the excellent extension API
- All contributors who have helped improve this extension
- The open-source community for inspiration and support

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/pachecocarlos27/vscode_plug/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/pachecocarlos27/vscode_plug/discussions)
- 📧 **Email**: carlos.pacheco@example.com
- 🌐 **Website**: [vscode-plug.dev](https://vscode-plug.dev)

## 📈 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes in each version.

---

<div align="center">
  <strong>VSCode Plug</strong> - Supercharge your VS Code experience
  <br>
  Made with ❤️ by <a href="https://github.com/pachecocarlos27">Carlos Pacheco</a>
</div>
