#!/usr/bin/env node
// Keeps `VERSION` in src/version.ts equal to package.json. Runs in the `version` lifecycle of `npm version`.
import { readFileSync, writeFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const file = new URL('../src/version.ts', import.meta.url);
const source = readFileSync(file, 'utf8');
const declaration = /export const VERSION = '[^']*';/;
if (!declaration.test(source)) throw new Error('src/version.ts: VERSION declaration not found');
writeFileSync(file, source.replace(declaration, `export const VERSION = '${version}';`));
console.log(`src/version.ts: VERSION = '${version}'`);
