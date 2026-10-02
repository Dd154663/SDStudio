/**
 * Webpack config for production electron main process
 */

import path from 'path';
import webpack from 'webpack';
import { merge } from 'webpack-merge';
import TerserPlugin from 'terser-webpack-plugin';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import baseConfig from './webpack.config.base';
import webpackPaths from './webpack.paths';
import checkNodeEnv from '../scripts/check-node-env';
import deleteSourceMaps from '../scripts/delete-source-maps';
import { loadDotEnv } from './loadDotEnv';

checkNodeEnv('production');
deleteSourceMaps();
// 저장소 루트 .env(gitignore)의 빌드 설정을 읽는다. 이미 설정된 환경 변수(CI Secrets)가 우선.
loadDotEnv(path.join(webpackPaths.rootPath, '.env'));

const configuration: webpack.Configuration = {
  devtool: 'source-map',

  mode: 'production',

  target: 'electron-main',

  entry: {
    main: path.join(webpackPaths.srcMainPath, 'main.ts'),
    preload: path.join(webpackPaths.srcMainPath, 'preload.ts'),
  },

  output: {
    path: webpackPaths.distMainPath,
    filename: '[name].js',
    library: {
      type: 'umd',
    },
  },

  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
      }),
    ],
  },

  plugins: [
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE === 'true' ? 'server' : 'disabled',
      analyzerPort: 8888,
    }),

    /**
     * Create global constants which can be configured at compile time.
     *
     * Useful for allowing different behaviour between development builds and
     * release builds
     *
     * NODE_ENV should be production so that modules do not perform certain
     * development checks
     */
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production',
      DEBUG_PROD: false,
      START_MINIMIZED: false,
      // Google 드라이브 연동 OAuth 클라이언트(src/main/googleDrive/client.ts) — main 번들에만 주입.
      // 값이 없으면 빈 문자열로 빌드되고 앱은 「연동 설정 없음」으로 동작한다.
      SDSTUDIO_GOOGLE_CLIENT_ID: '',
      SDSTUDIO_GOOGLE_CLIENT_SECRET: '',
    }),

    new webpack.DefinePlugin({
      'process.type': '"browser"',
    }),
  ],

  /**
   * Disables webpack processing of __dirname and __filename.
   * If you run the bundle in node.js it falls back to these values of node.js.
   * https://github.com/webpack/webpack/issues/2010
   */
  node: {
    __dirname: false,
    __filename: false,
  },

  externals: {
    sharp: 'commonjs sharp',
    sdsnative: 'commonjs sdsnative',
    fsevents: 'commonjs fsevents',
    chokidar: 'commonjs chokidar',
    'exiftool-vendored': 'commonjs exiftool-vendored',
    'exiftool-vendored.pl': 'commonjs exiftool-vendored.pl',
    'exiftool-vendored.exe': 'commonjs exiftool-vendored.exe',
    'tar-fs': 'commonjs tar-fs',
    'tar-stream': 'commonjs tar-stream',
    'onnxruntime-node': 'commonjs onnxruntime-node',
  },
};

export default merge(baseConfig, configuration);
