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
 *   - dist/index.html (GitHub Pages landing page and CDN directory)
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

function renderHtml(assetPrefix = '.') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>JayDB Cloud Frontend SDK — Official Distribution</title>
  <meta name="description" content="Zero-dependency frontend SDK for JayDB Cloud. Serverless document storage, optimistic concurrency (CAS), and OIDC PKCE authentication.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --bg-card: #111827;
      --bg-card-hover: #162033;
      --border: #1e293b;
      --border-focus: #3b82f6;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #10b981;
      --code-bg: #030712;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem 1rem;
      min-height: 100vh;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
    }
    header {
      text-align: center;
      padding: 3rem 1rem 2.5rem;
    }
    .badge-row {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgba(59, 130, 246, 0.1);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.25);
    }
    .badge--success {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.25);
    }
    h1 {
      font-size: clamp(2rem, 4vw, 3rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      margin-bottom: 1rem;
      background: linear-gradient(135deg, #ffffff 30%, #94a3b8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.lede {
      font-size: 1.15rem;
      color: var(--text-muted);
      max-width: 680px;
      margin: 0 auto 2rem;
    }
    .cta-row {
      display: flex;
      justify-content: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    .btn--primary {
      background: var(--primary);
      color: #fff;
    }
    .btn--primary:hover {
      background: var(--primary-hover);
      transform: translateY(-1px);
    }
    .btn--secondary {
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn--secondary:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-focus);
      transform: translateY(-1px);
    }
    section {
      margin-top: 3rem;
    }
    h2 {
      font-size: 1.4rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 1.5rem;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.9rem;
    }
    th, td {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: rgba(0,0,0,0.2);
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
    }
    tr:last-child td {
      border-bottom: none;
    }
    .file-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: #60a5fa;
      text-decoration: none;
      font-weight: 500;
    }
    .file-name:hover {
      text-decoration: underline;
    }
    .pill {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      background: rgba(255,255,255,0.08);
    }
    .pill--rec {
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
    }
    pre {
      background: var(--code-bg);
      padding: 1.25rem;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      overflow-x: auto;
      color: #e2e8f0;
      border: 1px solid var(--border);
    }
    .code-comment { color: #64748b; }
    .code-keyword { color: #f43f5e; }
    .code-string { color: #34d399; }
    .code-fn { color: #60a5fa; }
    .live-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.25rem;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 8px;
      font-size: 0.9rem;
      color: #34d399;
      margin-top: 1rem;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
    footer {
      text-align: center;
      margin-top: 4rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--text-muted); text-decoration: none; }
    footer a:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="badge-row">
        <span class="badge badge--success">v0.1.0 Released</span>
        <span class="badge">Zero Dependencies</span>
        <span class="badge">~12 KB Minified</span>
        <span class="badge">TypeScript Ready</span>
      </div>
      <h1>JayDB Cloud Frontend SDK</h1>
      <p class="lede">
        The official browser client for JayDB Cloud. Build collaborative, multi-user web apps with
        <strong>zero backend servers</strong> — powered by OIDC PKCE authentication and optimistic concurrency control (CAS).
      </p>
      <div class="cta-row">
        <a class="btn btn--primary" href="https://github.com/jaydb-cloud/jaydb-cloud-sdk">View on GitHub</a>
        <a class="btn btn--secondary" href="https://jaydb-cloud.github.io/jaydb-kanban-demo/">Try Live Kanban Demo</a>
      </div>
    </header>

    <section>
      <h2>📦 Distribution Bundles</h2>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bundle</th>
                <th>Format</th>
                <th>Size</th>
                <th>Target &amp; Usage</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a class="file-name" href="\${assetPrefix}/jaydb-cloud.esm.min.js">jaydb-cloud.esm.min.js</a>
                  <span class="pill pill--rec">Recommended</span>
                </td>
                <td>ESM</td>
                <td>~12.4 KB</td>
                <td>Modern browser <code>&lt;script type="module"&gt;</code> &amp; native importmaps</td>
              </tr>
              <tr>
                <td>
                  <a class="file-name" href="\${assetPrefix}/jaydb-cloud.min.js">jaydb-cloud.min.js</a>
                </td>
                <td>IIFE / UMD</td>
                <td>~12.8 KB</td>
                <td>Classic script tags (exposes <code>window.JayDBCloud</code>)</td>
              </tr>
              <tr>
                <td>
                  <a class="file-name" href="\${assetPrefix}/jaydb-cloud.esm.js">jaydb-cloud.esm.js</a>
                </td>
                <td>ESM</td>
                <td>27.6 KB</td>
                <td>Unminified ESM bundle with sourcemaps for debugging</td>
              </tr>
              <tr>
                <td>
                  <a class="file-name" href="\${assetPrefix}/index.d.ts">index.d.ts</a>
                </td>
                <td>Types</td>
                <td>5.3 KB</td>
                <td>TypeScript type declarations and interface definitions</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section>
      <h2>🚀 Zero-Build Browser Adoption (Importmap)</h2>
      <p style="color: var(--text-muted); margin-bottom: 0.75rem;">
        No Node.js, bundlers, or build tools required. Add this importmap to your HTML:
      </p>
      <pre><code><span class="code-comment">&lt;!-- 1. Define standard module importmap --&gt;</span>
&lt;<span class="code-keyword">script</span> <span class="code-fn">type</span>=<span class="code-string">"importmap"</span>&gt;
{
  <span class="code-string">"imports"</span>: {
    <span class="code-string">"@jaydb/cloud"</span>: <span class="code-string">"https://jaydb-cloud.github.io/jaydb-cloud-sdk/dist/jaydb-cloud.esm.min.js"</span>
  }
}
&lt;/<span class="code-keyword">script</span>&gt;

<span class="code-comment">&lt;!-- 2. Use pure ES modules --&gt;</span>
&lt;<span class="code-keyword">script</span> <span class="code-fn">type</span>=<span class="code-string">"module"</span>&gt;
  <span class="code-keyword">import</span> { <span class="code-fn">JayDB</span>, <span class="code-fn">Auth</span> } <span class="code-keyword">from</span> <span class="code-string">'@jaydb/cloud'</span>;

  <span class="code-keyword">const</span> auth = <span class="code-keyword">new</span> <span class="code-fn">Auth</span>({
    issuer: <span class="code-string">'https://acme.jaydb.com'</span>,
    clientId: <span class="code-string">'my-app'</span>
  });

  <span class="code-keyword">const</span> db = <span class="code-keyword">new</span> <span class="code-fn">JayDB</span>({
    baseUrl: <span class="code-string">'https://acme.jaydb.com'</span>,
    namespace: <span class="code-string">'production'</span>,
    auth
  });

  <span class="code-comment">// Read document with optimistic concurrency control (CAS)</span>
  <span class="code-keyword">const</span> doc = <span class="code-keyword">await</span> db.<span class="code-fn">get</span>(<span class="code-string">'boards/main'</span>);
  console.<span class="code-fn">log</span>(<span class="code-string">'Loaded board:'</span>, doc?.data);
&lt;/<span class="code-keyword">script</span>&gt;</code></pre>

      <div class="live-status" id="live-check">
        <div class="pulse-dot"></div>
        <span id="live-text">Verifying live SDK load from bundle...</span>
      </div>
    </section>

    <footer>
      <p>
        &copy; 2026 <a href="https://jaydb.com">JayDB Cloud</a>. Released under the MIT License.
        &bull; <a href="https://github.com/jaydb-cloud/jaydb-cloud-sdk">GitHub</a>
        &bull; <a href="https://jaydb.com">Documentation</a>
      </p>
    </footer>
  </div>

  <script type="module">
    try {
      const { JayDB, Auth, TreeACL } = await import('\${assetPrefix}/jaydb-cloud.esm.min.js');
      if (JayDB && Auth && TreeACL) {
        document.getElementById('live-text').textContent = '✓ Live SDK Loaded: jaydb-cloud.esm.min.js ready (JayDB, Auth, TreeACL available)';
      }
    } catch (e) {
      document.getElementById('live-text').textContent = 'Loaded static docs.';
    }
  </script>
</body>
</html>
`;
}

// Generate in dist/ (where assets are in same folder)
fs.writeFileSync(path.join(distDir, 'index.html'), renderHtml('.'), 'utf8');
fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');

// Generate at root (where assets are in ./dist)
fs.writeFileSync(path.join(rootDir, 'index.html'), renderHtml('./dist'), 'utf8');
fs.writeFileSync(path.join(rootDir, '.nojekyll'), '', 'utf8');

console.log('Build completed successfully!');
console.log('Generated in dist/:');
const files = fs.readdirSync(distDir);
for (const file of files) {
  const stats = fs.statSync(path.join(distDir, file));
  console.log(`  - ${file.padEnd(26)} ${(stats.size / 1024).toFixed(2)} KB`);
}
