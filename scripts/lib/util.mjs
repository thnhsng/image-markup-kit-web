import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** Runs a command with inherited output; throws when it fails. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: repoRoot, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
  }
}

/** Runs a command and returns its standard output; throws when it fails. */
export function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}: ${result.stderr}`);
  }
  return result.stdout;
}

export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Builds the library when needed and packs it the way `npm publish` would; returns the tarball path. */
export function packLibrary({ build = !existsSync(join(repoRoot, 'dist', 'index.js')) } = {}) {
  if (build) run('npm', ['run', 'build', '--silent']);
  const destination = join(repoRoot, '.cache', 'pack');
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const output = capture('npm', ['pack', '--json', '--pack-destination', destination]);
  const [info] = JSON.parse(output);
  return { tarball: join(destination, info.filename), files: info.files.map((file) => file.path) };
}
