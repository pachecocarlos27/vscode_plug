//@ts-check
'use strict';

const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // vscode extensions run in Node.js context
  mode: 'none', // will be set based on environment

  entry: './src/extension.ts', // the entry point of this extension
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]',
    clean: true // Clean the output directory before emit
  },
  devtool: 'nosources-source-map',
  externals: {
    // Added for embedded extension
    'fs': 'commonjs fs',
    'path': 'commonjs path',
    vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded
    // Add other native node modules that shouldn't be bundled to reduce bundle size
    'fs': 'commonjs fs',
    'path': 'commonjs path',
    'os': 'commonjs os',
    'child_process': 'commonjs child_process',
    'crypto': 'commonjs crypto',
    'stream': 'commonjs stream',
    'http': 'commonjs http',
    'https': 'commonjs https',
    'url': 'commonjs url',
    'util': 'commonjs util',
    'zlib': 'commonjs zlib',
    'assert': 'commonjs assert',
    'net': 'commonjs net',
    'tls': 'commonjs tls',
    'events': 'commonjs events'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    mainFields: ['main', 'module'], // Remove 'browser' to prevent browser modules from being used
    // Cache modules for faster rebuild
    cache: true
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                "module": "es6" // override "module" in tsconfig.json for webpack
              },
              // Enable faster build with transpileOnly mode
              transpileOnly: true,
              experimentalWatchApi: true
            }
          }
        ]
      }
    ]
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          keep_classnames: true,
          keep_fnames: true,
          ecma: 2020,
          // More aggressive minification
          compress: {
            drop_console: false, // Keep console for debugging
            drop_debugger: true,
            pure_funcs: ['console.debug']
          },
          format: {
            comments: false
          }
        },
        extractComments: false,
        parallel: true // Use multi-process parallel running
      })
    ]
  },
  plugins: [
    // Define environment variables
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
    }),
    
    // Ignore optional dependencies of some packages
    new webpack.IgnorePlugin({
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    }),
    
    // Copy JavaScript files and icons to the dist folder
    new CopyPlugin({
      patterns: [
        { 
          from: 'src/markdownParser.js', 
          to: 'markdownParser.js',
          // Minify JavaScript files during copy to improve performance
          transform(content) {
            if (process.env.NODE_ENV === 'production') {
              // Simple minification for .js files
              return content.toString()
                .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // Remove comments
                .replace(/\s{2,}/g, ' ')                  // Remove extra spaces
                .replace(/\n\s*/g, '');                   // Remove newlines and trailing spaces
            }
            return content;
          }
        },
        { 
          from: 'src/ollamaClient.js', 
          to: 'ollamaClient.js',
          transform(content) {
            if (process.env.NODE_ENV === 'production') {
              // Simple minification for .js files
              return content.toString()
                .replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '') // Remove comments
                .replace(/\s{2,}/g, ' ')                  // Remove extra spaces
                .replace(/\n\s*/g, '');                   // Remove newlines and trailing spaces
            }
            return content;
          } 
        },
        { from: 'icons', to: '../icons' },
        { from: 'logo.png', to: '../logo.png' }
      ]
    })
  ],
  performance: {
    hints: false
  },
  // Add caching for faster builds
  cache: {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename]
    }
  },
  infrastructureLogging: {
    level: 'error', // Only show errors to reduce noise
  },
  stats: {
    errorDetails: true
  }
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  if (isProduction) {
    // Production-specific settings
    process.env.NODE_ENV = 'production';
    config.mode = 'production';
    config.devtool = 'source-map';
    
    // Add more aggressive optimizations for production
    config.optimization = {
      ...config.optimization,
      minimize: true,
      concatenateModules: true,
      usedExports: true,
      sideEffects: true,
      moduleIds: 'deterministic'
    };
  } else {
    // Development-specific settings
    process.env.NODE_ENV = 'development';
    config.mode = 'development';
    config.devtool = 'source-map';
    
    // More detailed stats output for development
    config.stats = {
      modules: false,
      children: false,
      chunks: false,
      assets: false,
    };
  }
  
  return config;
};