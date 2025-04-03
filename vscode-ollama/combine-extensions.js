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

// Function to ensure axios is updated to secure version in both projects
function ensureAxiosSecureVersions() {
  console.log('Ensuring Axios is updated to secure version in both projects...');
  
  // Update package.json files to use the newest Axios version
  const mainPackageJsonPath = path.join(mainExtDir, 'package.json');
  const embeddedPackageJsonPath = path.join(embeddedExtDir, 'package.json');
  
  try {
    // Update main package.json
    let mainPackageJson = JSON.parse(fs.readFileSync(mainPackageJsonPath, 'utf-8'));
    if (mainPackageJson.dependencies && mainPackageJson.dependencies.axios) {
      mainPackageJson.dependencies.axios = '^1.6.7';
      fs.writeFileSync(mainPackageJsonPath, JSON.stringify(mainPackageJson, null, 2), 'utf-8');
      console.log('Updated axios in main package.json to ^1.6.7');
    }
    
    // Update embedded package.json
    let embeddedPackageJson = JSON.parse(fs.readFileSync(embeddedPackageJsonPath, 'utf-8'));
    if (embeddedPackageJson.dependencies && embeddedPackageJson.dependencies.axios) {
      embeddedPackageJson.dependencies.axios = '^1.6.7';
      fs.writeFileSync(embeddedPackageJsonPath, JSON.stringify(embeddedPackageJson, null, 2), 'utf-8');
      console.log('Updated axios in embedded package.json to ^1.6.7');
    }
    
    console.log('Axios versions updated successfully');
  } catch (error) {
    console.error('Error updating Axios versions:', error);
  }
}

// Run the combination process
combineExtensions();
ensureAxiosSecureVersions();