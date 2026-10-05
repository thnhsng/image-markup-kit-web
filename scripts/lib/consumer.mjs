import { run } from './util.mjs';

const NPM_FLAGS = ['--no-audit', '--no-fund', '--no-package-lock', '--registry=https://registry.npmjs.org/'];

/**
 * Installs a consumer app's own dependencies (without a lockfile, like an app that keeps none), then the packed
 * library from its tarball, without saving it to the app's package.json.
 */
export function installConsumer(dir, tarball) {
  run('npm', ['install', ...NPM_FLAGS, '--loglevel=error'], { cwd: dir });
  run('npm', ['install', ...NPM_FLAGS, '--loglevel=error', '--no-save', tarball], { cwd: dir });
}
