#!/usr/bin/env node
/**
 * Checks the package contract on the tarball `npm pack` produces:
 * - exactly the expected files (no sources, tests or sourcemaps);
 * - both bundles start with the "use client" directive and contain no sourcemap reference, `import.meta`,
 *   `process.env` or `react-dom` import (React is the only peer dependency);
 * - the declarations contain no enums (consumers may compile with `isolatedModules`);
 * - evaluating either bundle never touches browser globals, so importing it in Node, Jest/jsdom or SSR is safe;
 * - publint and Are The Types Wrong are clean.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packLibrary, repoRoot } from './lib/util.mjs';

const problems = [];
const { tarball, files } = packLibrary();

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const expected = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'dist/index.d.mts',
  'dist/index.d.ts',
  'dist/index.js',
  'dist/index.mjs',
  'package.json',
  ...(pkg.files.includes('THIRD_PARTY_NOTICES.md') ? ['THIRD_PARTY_NOTICES.md'] : []),
].sort();
const actual = [...files].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  problems.push(`package files differ.\n  expected: ${expected.join(', ')}\n  actual:   ${actual.join(', ')}`);
}

for (const bundle of ['dist/index.js', 'dist/index.mjs']) {
  const code = readFileSync(join(repoRoot, bundle), 'utf8');
  if (!code.startsWith('"use client";')) problems.push(`${bundle}: does not start with "use client"`);
  if (code.includes('sourceMappingURL')) problems.push(`${bundle}: contains a sourcemap reference`);
  if (code.includes('import.meta')) problems.push(`${bundle}: uses import.meta`);
  if (code.includes('process.env')) problems.push(`${bundle}: uses process.env`);
  if (/["']react-dom(\/[^"']*)?["']/.test(code)) problems.push(`${bundle}: imports react-dom`);
}

for (const declarations of ['dist/index.d.ts', 'dist/index.d.mts']) {
  const code = readFileSync(join(repoRoot, declarations), 'utf8');
  if (/\benum\s+\w+\s*\{/.test(code)) problems.push(`${declarations}: declares an enum`);
}

// Load React first (its own module code is not under test), then make every browser global throw on access and
// evaluate the bundle. Node 21+ has a global `navigator` and `crypto`; both must stay untouched at import time.
const trap = `
  const names = ['window', 'document', 'navigator', 'crypto', 'self', 'localStorage', 'sessionStorage', 'location',
    'HTMLElement', 'Image', 'createImageBitmap', 'OffscreenCanvas', 'matchMedia', 'requestAnimationFrame',
    'ResizeObserver', 'PointerEvent', 'FontFace', 'URL', 'Blob', 'fetch'];
  for (const name of names) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() { throw new Error('module evaluation touched ' + name); },
    });
  }
`;
const evaluations = [
  {
    name: 'CommonJS',
    args: ['-e', `require('react'); require('react/jsx-runtime'); ${trap} require('./dist/index.js');`],
  },
  {
    name: 'ES module',
    args: [
      '--input-type=module',
      '-e',
      `await import('react'); await import('react/jsx-runtime'); ${trap} await import('./dist/index.mjs');`,
    ],
  },
];
for (const { name, args } of evaluations) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    problems.push(`${name} bundle is not import-safe: ${result.stderr.split('\n').find(Boolean) ?? result.status}`);
  }
}

const tools = [
  ['publint', ['--strict']],
  ['attw', [tarball, '--format', 'table-flipped']],
];
for (const [tool, args] of tools) {
  const result = spawnSync(join(repoRoot, 'node_modules', '.bin', tool), args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) problems.push(`${tool}:\n${result.stdout}${result.stderr}`);
}

if (problems.length > 0) {
  console.error(`pack check: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}
console.log(`pack check: ok (${actual.length} files, import-safe in CommonJS and ES module form)`);
