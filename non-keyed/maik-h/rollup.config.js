'use strict';

import * as path from 'path';
import babel from 'rollup-plugin-babel';
import resolve from 'rollup-plugin-node-resolve';
import uglify from 'rollup-plugin-uglify';
import { minify } from 'uglify-es';
import cdn from 'rollup-plugin-cdn';

export default {
  input: 'src/index.js',
  output: {
    file: 'dist/index.min.js',
    format: 'iife',
    name: 'app',
    sourcemap: true,
  },
  plugins: [
    cdn(),
    resolve({
      module: true,
      jsnext: true,
      browser: true,
    }),
    babel({
      exclude: 'node_modules/**',
      presets: [
        [ "es2016" ]
      ],
      plugins: [
        "external-helpers"
      ],
      runtimeHelpers: true,
      babelrc: false,
    }),
    uglify({}, minify),
  ],
}
