const fs = require('fs');
const path = require('path');

// Paths to main and embedded extension
const mainExtDir = __dirname;
const embeddedExtDir = path.join(__dirname, 'vscode-ollama-enhanced');

// Function to combine necessary files from embedded extension to main extension
function combineExtensions() {
  console.log('Combining extensions...');
  
  // Copy embedded extension source files to main extension
  const embeddedSrcDir = path.join(embeddedExtDir, 'src');
  const mainSrcDir = path.join(mainExtDir, 'src');
  
  // Create embedded directory in main src
  const embeddedTargetDir = path.join(mainSrcDir, 'embedded');
  if (!fs.existsSync(embeddedTargetDir)) {
    fs.mkdirSync(embeddedTargetDir, { recursive: true });
  }
  
  // Copy all embedded src files to main/src/embedded
  console.log('Copying embedded source files...');
  copyFilesRecursively(embeddedSrcDir, embeddedTargetDir);
  
  // Update webpack config to include embedded files
  console.log('Updating webpack configuration...');
  updateWebpackConfig();
  
  // Update main extension.ts to import and use the embedded extension
  console.log('Updating main extension.ts...');
  updateMainExtension();
  
  console.log('Extensions combined successfully!');
}

// Helper function to copy files recursively
function copyFilesRecursively(source, target) {
  // Create target directory if it doesn't exist
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  
  // Get all files in source directory
  const files = fs.readdirSync(source);
  
  // Copy each file to target directory
  for (const file of files) {
    const sourcePath = path.join(source, file);
    const targetPath = path.join(target, file);
    
    const stats = fs.statSync(sourcePath);
    
    if (stats.isDirectory()) {
      // Recursively copy subdirectories
      copyFilesRecursively(sourcePath, targetPath);
    } else {
      // Copy file
      fs.copyFileSync(sourcePath, targetPath);
      console.log(`Copied ${sourcePath} to ${targetPath}`);
    }
  }
}

// Function to update webpack config to include embedded files
function updateWebpackConfig() {
  const webpackConfigPath = path.join(mainExtDir, 'webpack.config.js');
  let webpackConfig = fs.readFileSync(webpackConfigPath, 'utf-8');
  
  // Check if the webpack config already includes embedded files
  if (webpackConfig.includes('embedded')) {
    console.log('Webpack config already includes embedded files, skipping...');
    return;
  }
  
  // Add embedded extension to externals
  const externalsPattern = /externals: {/;
  const embeddedExternals = `externals: {
    // Added for embedded extension
    'fs': 'commonjs fs',
    'path': 'commonjs path',`;
  
  webpackConfig = webpackConfig.replace(externalsPattern, embeddedExternals);
  
  // Write updated webpack config
  fs.writeFileSync(webpackConfigPath, webpackConfig);
  console.log('Updated webpack config');
}

// Function to update main extension.ts to import and use the embedded extension
function updateMainExtension() {
  const mainExtensionPath = path.join(mainExtDir, 'src', 'extension.ts');
  let mainExtension = fs.readFileSync(mainExtensionPath, 'utf-8');
  
  // Check if the main extension already imports embedded extension
  if (mainExtension.includes('embedded')) {
    console.log('Main extension already imports embedded extension, skipping...');
    return;
  }
  
  // Add import for embedded extension
  const importPattern = /import \* as vscode from 'vscode';/;
  const embeddedImport = `import * as vscode from 'vscode';
// Import embedded extension
import * as embeddedExtension from './embedded/extension';`;
  
  mainExtension = mainExtension.replace(importPattern, embeddedImport);
  
  // Write updated main extension
  fs.writeFileSync(mainExtensionPath, mainExtension);
  console.log('Updated main extension');
}

// Run the combination process
combineExtensions();