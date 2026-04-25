const path = require('node:path');
const { ModuleFederationPlugin } = require('webpack').container;

/** @type {import('webpack').Configuration} */
module.exports = {
  mode: 'production',
  target: 'web',
  devtool: false,
  entry: path.resolve(__dirname, './src/index.js'),
  output: {
    clean: true,
    filename: 'assets/[name].js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'http://localhost:4195/',
    uniqueName: 'webpackCompatRemote',
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'webpackCompatRemote',
      library: { type: 'system' },
      filename: 'remoteEntry.js',
      exposes: {
        './message': './src/message.js',
      },
    }),
  ],
};
