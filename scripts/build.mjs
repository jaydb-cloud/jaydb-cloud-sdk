/**
 * build.mjs — Build & Minification script for JayDB Cloud SDK.
 *
 * Generates:
 *   - dist/index.mjs (ESM entrypoint)
 *   - dist/index.cjs (CommonJS entrypoint)
 *   - dist/index.d.ts (TypeScript declarations)
 *   - dist/jaydb-cloud.esm.js (Unminified standalone ESM bundle)
 *   - dist/jaydb-cloud.esm.min.js (Minified standalone ESM bundle)
 *   - dist/jaydb-cloud.js (Unminified UMD/IIFE bundle)
 *   - dist/jaydb-cloud.min.js (Minified UMD/IIFE bundle)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');
const srcDir = path.resolve(rootDir, 'src');

fs.mkdirSync(distDir, { recursive: true });

// Copy TypeScript declarations
const typesSrc = path.join(rootDir, 'types', 'index.d.ts');
if (fs.existsSync(typesSrc)) {
  fs.copyFileSync(typesSrc, path.join(distDir, 'index.d.ts'));
}

// Find esbuild (from local or sibling node_modules)
let esbuild;
try {
  esbuild = (await import('esbuild')).default || (await import('esbuild'));
} catch {
  const fallbackPaths = [
    path.resolve(rootDir, '../jaydb-cloud/web/node_modules/esbuild/lib/main.js'),
    path.resolve(rootDir, 'node_modules/esbuild/lib/main.js'),
  ];
  for (const fp of fallbackPaths) {
    if (fs.existsSync(fp)) {
      esbuild = (await import(fp)).default || (await import(fp));
      break;
    }
  }
}

if (!esbuild) {
  console.error('esbuild is required to build production distributions.');
  process.exit(1);
}

const entryPoint = path.join(srcDir, 'index.js');

// 1. Build ESM bundles
await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  outfile: path.join(distDir, 'jaydb-cloud.esm.js'),
  target: ['es2022'],
  sourcemap: true,
});

await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: path.join(distDir, 'jaydb-cloud.esm.min.js'),
  target: ['es2022'],
  sourcemap: true,
});

// Copy to index.mjs for package.json exports
fs.copyFileSync(path.join(distDir, 'jaydb-cloud.esm.js'), path.join(distDir, 'index.mjs'));

// 2. Build IIFE / UMD bundles (global window.JayDBCloud)
await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'iife',
  globalName: 'JayDBCloud',
  outfile: path.join(distDir, 'jaydb-cloud.js'),
  target: ['es2022'],
  sourcemap: true,
});

await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'iife',
  globalName: 'JayDBCloud',
  minify: true,
  outfile: path.join(distDir, 'jaydb-cloud.min.js'),
  target: ['es2022'],
  sourcemap: true,
});

// 3. Build CommonJS bundle
await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  format: 'cjs',
  outfile: path.join(distDir, 'index.cjs'),
  target: ['node18'],
  sourcemap: true,
});

console.log('Build completed successfully!');
console.log('Generated in dist/:');
const files = fs.readdirSync(distDir);
for (const file of files) {
  const stats = fs.statSync(path.join(distDir, file));
  console.log(`  - ${file.padEnd(26)} ${(stats.size / 1024).toFixed(2)} KB`);
}
