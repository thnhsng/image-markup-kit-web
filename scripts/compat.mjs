#!/usr/bin/env node
/**
 * Installs the packed library into small consumer apps that mirror common toolchains, then type-checks, builds and
 * tests them:
 *   cra5          Create React App 5 (webpack 5, Babel, Jest 27/jsdom), TypeScript 4.9, React 18; CI=true, so any
 *                 build warning fails
 *   ts49          TypeScript 4.9 with moduleResolution "node" and skipLibCheck off (same as `npm run check:dts49`)
 *   vite-react19  Vite + React 19, TypeScript with moduleResolution "bundler"
 * Usage: node scripts/compat.mjs [cra5] [ts49] [vite-react19]   (all when none is given)
 */
import { join } from 'node:path';
import { installConsumer } from './lib/consumer.mjs';
import { packLibrary, repoRoot, run } from './lib/util.mjs';

const all = ['cra5', 'ts49', 'vite-react19'];
const selected = process.argv.slice(2).filter((name) => !name.startsWith('-'));
const apps = selected.length > 0 ? selected : all;
for (const app of apps) if (!all.includes(app)) throw new Error(`unknown consumer app: ${app}`);

const { tarball } = packLibrary();
const env = { ...process.env, CI: 'true', BROWSERSLIST_IGNORE_OLD_DATA: '1' };

for (const app of apps) {
  const dir = join(repoRoot, 'compat', app);
  const bin = (name) => join(dir, 'node_modules', '.bin', name);
  console.log(`\n== ${app}`);
  installConsumer(dir, tarball);
  run(bin('tsc'), ['--noEmit', '-p', '.'], { cwd: dir, env });
  if (app === 'cra5') {
    run(bin('react-scripts'), ['build'], { cwd: dir, env });
    run(bin('react-scripts'), ['test', '--watchAll=false'], { cwd: dir, env });
  } else if (app === 'vite-react19') {
    run(bin('vite'), ['build', '--logLevel', 'warn'], { cwd: dir, env });
  }
}
console.log(`\ncompat: ok (${apps.join(', ')})`);
