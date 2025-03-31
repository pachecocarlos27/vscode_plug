//@ts-check
'use strict';

const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

/**@type {import('webpack').Configuration}*/
const config = {
  target: 'node', // vscode extensions run in Node.js context
  mode: 'none', // use 'none' to avoid minification in development

  entry: './src/extension.ts', // the entry point of this extension
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'nosources-source-map',
  externals: {
    vscode: 'commonjs vscode', // the vscode-module is created on-the-fly and must be excluded
    // Add other native node modules that shouldn't be bundled
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
    'assert': 'commonjs assert'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    mainFields: ['browser', 'module', 'main']
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
              }
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
          keep_fnames: true
        }
      })
    ]
  },
  plugins: [
    // Ignore optional dependencies of some packages
    new webpack.IgnorePlugin({
      resourceRegExp: /^\.\/locale$/,
      contextRegExp: /moment$/,
    })
  ],
  performance: {
    hints: false
  },
  node: {
    __dirname: false // leave __dirname as is, it's needed for resolving paths
  }
};

module.exports = (env, argv) => {
  if (argv.mode === 'production') {
    // Production-specific settings
    config.mode = 'production';
    config.devtool = 'source-map';
    
    // Add more aggressive optimizations for production
    config.optimization = {
      ...config.optimization,
      minimize: true,
      concatenateModules: true,
      usedExports: true,
      sideEffects: true
    };
  } else {
    // Development-specific settings
    config.mode = 'development';
    config.devtool = 'source-map';
  }
  return config;
};