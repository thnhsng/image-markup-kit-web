#!/usr/bin/env node
// Type-checks the packed declarations the way a TypeScript 4.9 consumer with `moduleResolution: "node"` sees them,
// with skipLibCheck off (stricter than most consumers): compat/ts49/consumer.tsx uses every export.
import { join } from 'node:path';
import { packLibrary, repoRoot, run } from './lib/util.mjs';
import { installConsumer } from './lib/consumer.mjs';

const { tarball } = packLibrary();
const dir = join(repoRoot, 'compat', 'ts49');
installConsumer(dir, tarball);
run(join(dir, 'node_modules', '.bin', 'tsc'), ['-p', '.'], { cwd: dir });
console.log('dts49: ok (TypeScript 4.9, moduleResolution node, skipLibCheck false)');
