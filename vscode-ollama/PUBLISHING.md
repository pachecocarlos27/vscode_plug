# Publishing Guide for Ollama Enhanced

This document provides instructions for publishing new versions of the Ollama Enhanced for VS Code extension.

## Automated GitHub Release

Whenever you push a tag prefixed with 'v' (e.g., v1.3.0), the GitHub Actions workflow will automatically:

1. Build the extension
2. Package it as a VSIX file
3. Generate checksums
4. Create a GitHub release with the VSIX file and checksums

## Manual Publishing to VS Code Marketplace

### Prerequisites

1. [Node.js](https://nodejs.org/) installed
2. Visual Studio Code Extension Manager (`vsce`) installed:
   ```
   npm install -g @vscode/vsce
   ```
3. Azure DevOps Personal Access Token (PAT) with Marketplace publishing permissions

### Creating a Personal Access Token (PAT)

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Sign in with your Microsoft account
3. Click on your profile icon in the top-right corner
4. Select "Personal access tokens"
5. Click "New Token"
6. Fill in the form:
   - Name: VS Code Marketplace Publishing
   - Organization: All accessible organizations
   - Expiration: Choose an appropriate timeframe (1 year recommended)
   - Scopes: Custom defined
     - Select "Marketplace" and choose "Manage" permissions
7. Click "Create" and save the token securely

### Publishing Steps

1. Update version in package.json
2. Update CHANGELOG.md with the new version changes
3. Update README.md if necessary
4. Commit changes
5. Create a tag:
   ```
   git tag -a v1.x.x -m "Version 1.x.x release"
   ```
6. Push changes and tag:
   ```
   git push && git push --tags
   ```
7. Publish to VS Code Marketplace:
   ```
   vsce publish -p <your-pat>
   ```

### Alternative Publishing Methods

If you can't publish directly to the marketplace, you can:

1. Package the extension:
   ```
   vsce package
   ```
2. Share the VSIX file for manual installation:
   ```
   code --install-extension vscode-ollama-enhanced-1.x.x.vsix
   ```

## Publishing to Open VSX Registry

The Open VSX Registry is an alternative marketplace for VS Code extensions.

1. Install the Open VSX Publishing tool:
   ```
   npm install -g ovsx
   ```
2. Create a PAT for Open VSX at https://open-vsx.org/
3. Publish:
   ```
   ovsx publish -p <your-open-vsx-pat>
   ```

## Setting Up GitHub Actions Secrets

To enable automated marketplace publishing:

1. Go to your GitHub repository
2. Navigate to Settings > Secrets and variables > Actions
3. Add the following secrets:
   - `VSCE_PAT`: Your VS Code Marketplace PAT
   - `OVSX_PAT`: Your Open VSX Registry PAT
4. Uncomment the marketplace job in `.github/workflows/release.yml`

## Verification

After publishing:
1. Visit the [VS Code Marketplace](https://marketplace.visualstudio.com/vscode) to confirm your extension is available
2. Install from the marketplace to verify it works correctly
3. Check that all features operate as expected

## Troubleshooting

- If you encounter errors about missing PATs, ensure you're using the correct token
- If version conflicts occur, make sure your version bump in package.json is correct
- For release workflow failures, check the GitHub Actions logs