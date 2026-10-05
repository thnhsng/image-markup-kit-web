#!/usr/bin/env node
/**
 * Privacy scan: makes sure nothing private reaches the repository, its history or the npm package.
 *
 * Modes (combine freely):
 *   --tree                tracked and untracked (not ignored) files in the working tree
 *   --history             every commit on every ref: added lines, messages, identities, ref names, file names, images
 *   --pack                the tarball `npm pack` produces: file allowlist and contents
 *   --registry <version>  a published version: `npm view` metadata and the tarball downloaded from the registry
 * Options:
 *   --require-terms       fail when no private terms are loaded (used before publishing)
 *   --verbose             print what matched (local use only; never in CI, whose logs can be public)
 *
 * Private terms are never stored in this repository. They come from the PRIVACY_TERMS environment variable (one term
 * per line, e.g. a CI secret) or from the file named by PRIVACY_TERMS_FILE (default:
 * ~/.config/image-markup-kit/privacy-terms.txt). Each line is compared case-insensitively after NFKC normalization:
 *   term    plain ASCII: whole word (no letter or digit directly before or after it)
 *   *term   anywhere; also tried against the text with "-", "_", "." and spaces removed
 * Non-ASCII terms always match anywhere. Lines starting with "#" are comments.
 * Findings identify a term by its number only.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';
import { capture, makeTempDir, packLibrary, removeDir, repoRoot } from './lib/util.mjs';

const args = process.argv.slice(2);
const registryIndex = args.indexOf('--registry');
const modes = {
  tree: args.includes('--tree'),
  history: args.includes('--history'),
  pack: args.includes('--pack'),
  registry: registryIndex >= 0 ? args[registryIndex + 1] : null,
};
const requireTerms = args.includes('--require-terms');
const verbose = args.includes('--verbose');
if (!modes.tree && !modes.history && !modes.pack && !modes.registry) {
  console.error('usage: privacy-scan.mjs [--tree] [--history] [--pack] [--registry <version>] [--require-terms]');
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------------------------
// Allowlists: public information only.

const ALLOWED_IDENTITIES = new Set(['thnhsng <t.sang848@gmail.com>', 'GitHub <noreply@github.com>']);
const ALLOWED_EMAILS = new Set(['t.sang848@gmail.com', 'noreply@anthropic.com', 'noreply@github.com']);
const ALLOWED_EMAIL_SUFFIXES = ['@users.noreply.github.com'];
const ALLOWED_HOSTS = [
  'github.com',
  'githubusercontent.com',
  'npmjs.org',
  'npmjs.com',
  'unsplash.com',
  'keepachangelog.com',
  'semver.org',
  'w3.org',
  'developer.mozilla.org',
  'unicode.org',
  'lucide.dev',
  'playwright.dev',
  'vitest.dev',
  'react.dev',
  'opensource.org',
  'nodejs.org',
  'example.com',
  'example.org',
  'localhost',
  '127.0.0.1',
];
const PACKAGE_FILES =
  /^package\/(package\.json|README\.md|LICENSE|CHANGELOG\.md|THIRD_PARTY_NOTICES\.md|dist\/index\.(js|mjs|d\.ts|d\.mts))$/;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const BINARY_EXTENSIONS = new Set(['.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip', '.gz', '.tgz']);

// Assembled from pieces so that this file does not match its own patterns.
const LOCAL_PATH_PATTERNS = [
  new RegExp('/' + 'Users/[^/\\s]+'),
  new RegExp('/' + 'home/[a-z_][\\w.-]*/'),
  new RegExp('[A-Za-z]:\\\\' + 'Users\\\\', 'i'),
  new RegExp('/' + 'private/var/'),
  new RegExp('/' + 'var/folders/'),
  new RegExp('file' + ':/' + '/', 'i'),
];
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_PATTERN = /\bhttps?:\/\/([^\s"'<>()[\]{}\\`,;|]+)/gi;

// ---------------------------------------------------------------------------------------------------------------
// Private terms.

function loadTerms() {
  let text = process.env.PRIVACY_TERMS;
  if (!text) {
    const file = process.env.PRIVACY_TERMS_FILE || join(homedir(), '.config', 'image-markup-kit', 'privacy-terms.txt');
    if (existsSync(file)) text = readFileSync(file, 'utf8');
  }
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line, index) => compileTerm(line, index + 1));
}

function compileTerm(line, number) {
  const anywhere = line.startsWith('*');
  const term = (anywhere ? line.slice(1) : line).normalize('NFKC').toLowerCase();
  const isASCII = /^[\x20-\x7e]*$/.test(term);
  if (anywhere || !isASCII) {
    const squeezed = term.replace(/[-_.\s]/g, '');
    return {
      number,
      term,
      matches: (normalized, squeezedLine) =>
        normalized.includes(term) || (squeezed.length > 0 && squeezedLine.includes(squeezed)),
    };
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
  return { number, term, matches: (normalized) => pattern.test(normalized) };
}

const terms = loadTerms();

// ---------------------------------------------------------------------------------------------------------------
// Checks.

const findings = [];

function report(where, what, detail) {
  findings.push(verbose && detail ? `${where}: ${what} (${detail})` : `${where}: ${what}`);
}

function emailAllowed(email) {
  const lower = email.toLowerCase();
  return ALLOWED_EMAILS.has(lower) || ALLOWED_EMAIL_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function hostAllowed(authority) {
  const host = authority
    .replace(/^[^@/]*@/, '')
    .replace(/[:/?#].*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function checkLine(line, where, { lockfile = false } = {}) {
  if (lockfile && line.includes('"integrity":')) return;
  const normalized = line.normalize('NFKC').toLowerCase();
  const squeezed = normalized.replace(/[-_.\s]/g, '');
  for (const term of terms) {
    if (term.matches(normalized, squeezed)) report(where, `private term #${term.number}`, term.term);
  }
  for (const pattern of LOCAL_PATH_PATTERNS) {
    const match = pattern.exec(line);
    if (match) report(where, 'local file path', match[0]);
  }
  for (const match of line.matchAll(EMAIL_PATTERN)) {
    if (!emailAllowed(match[0])) report(where, 'email address not on the allowlist', match[0]);
  }
  if (lockfile) {
    // The lockfile repeats public dependency metadata (e.g. funding links); only where packages come from matters.
    if (line.includes('"resolved":') && !line.includes('"https://registry.npmjs.org/')) {
      report(where, 'lockfile entry resolved outside registry.npmjs.org');
    }
    return;
  }
  for (const match of line.matchAll(URL_PATTERN)) {
    if (!hostAllowed(match[1])) report(where, 'URL host not on the allowlist', match[1]);
  }
}

function scanText(text, where, options) {
  text.split(/\r\n|\r|\n/).forEach((line, index) => checkLine(line, `${where}:${index + 1}`, options));
}

function checkFileName(path, where) {
  const name = basename(path);
  if (/^\.env/i.test(name)) report(where, 'environment file');
  if (/\.(pem|key|p12|pfx|cer|mobileprovision)$/i.test(name)) report(where, 'key or certificate file');
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(name)) report(where, 'SSH key');
  if (name === 'CLAUDE.md' || name === 'AGENTS.md' || path.split('/').includes('.claude')) {
    report(where, 'agent notes file');
  }
  if (name === '.DS_Store' || name.endsWith('.xcuserstate')) report(where, 'editor or OS metadata file');
}

function scanBuffer(buffer, path, where) {
  checkFileName(path, where);
  const extension = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    for (const problem of imageMetadataProblems(buffer)) report(where, problem);
    return;
  }
  if (BINARY_EXTENSIONS.has(extension) || buffer.includes(0)) {
    report(where, 'binary file type not expected');
    return;
  }
  const text = buffer.toString('utf8');
  if (basename(path) === '.npmrc' && /_auth|_password/i.test(text)) report(where, 'npm credentials');
  scanText(text, where, { lockfile: basename(path) === 'package-lock.json' });
}

// ---------------------------------------------------------------------------------------------------------------
// Image metadata: only the EXIF orientation (and harmless resolution tags) may be present.

const ALLOWED_EXIF_TAGS = new Set([0x0112, 0x011a, 0x011b, 0x0128, 0x0213]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageMetadataProblems(bytes) {
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegProblems(bytes);
    if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return pngProblems(bytes);
    if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
      return webpProblems(bytes);
    }
    return ['image format not recognized'];
  } catch {
    return ['malformed image'];
  }
}

function jpegProblems(bytes) {
  const problems = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return [...problems, 'malformed JPEG'];
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break; // metadata precedes the scan data
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const segment = bytes.subarray(offset + 4, offset + 2 + length);
    const signature = segment.toString('latin1', 0, 12);
    if (marker === 0xe1) {
      if (signature.startsWith('Exif\0\0')) problems.push(...exifProblems(segment.subarray(6)));
      else problems.push('XMP or other APP1 metadata');
    } else if (marker === 0xe2) {
      if (!signature.startsWith('ICC_PROFILE')) problems.push('APP2 metadata other than an ICC profile');
    } else if (marker === 0xed) {
      problems.push('IPTC metadata');
    } else if (marker === 0xfe) {
      problems.push('JPEG comment');
    } else if (marker >= 0xe3 && marker <= 0xef && !(marker === 0xee && signature.startsWith('Adobe'))) {
      problems.push(`APP${marker - 0xe0} metadata`);
    }
    offset += 2 + length;
  }
  return problems;
}

function exifProblems(tiff) {
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (at) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const problems = [];
  const ifd0 = u32(4);
  const count = u16(ifd0);
  for (let index = 0; index < count; index += 1) {
    const tag = u16(ifd0 + 2 + index * 12);
    if (!ALLOWED_EXIF_TAGS.has(tag)) problems.push(`EXIF tag 0x${tag.toString(16).padStart(4, '0')}`);
  }
  if (u32(ifd0 + 2 + count * 12) !== 0) problems.push('EXIF thumbnail');
  return problems;
}

function pngProblems(bytes) {
  const problems = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    if (['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'].includes(type)) problems.push(`PNG ${type} chunk`);
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  return problems;
}

function webpProblems(bytes) {
  const problems = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (type === 'EXIF' || type === 'XMP ') problems.push(`WebP ${type.trim()} chunk`);
    offset += 8 + size + (size % 2);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Sources.

function gitBuffer(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function scanTree() {
  const paths = capture('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean);
  let count = 0;
  for (const path of paths) {
    const absolute = join(repoRoot, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
    scanBuffer(readFileSync(absolute), path, path);
    count += 1;
  }
  return `tree: ${count} files`;
}

function scanHistory() {
  const commitCount = Number(capture('git', ['rev-list', '--all', '--count']).trim() || '0');
  if (commitCount === 0) return 'history: no commits';

  for (const line of capture('git', ['log', '--all', '--format=%an <%ae>%x09%cn <%ce>']).split('\n')) {
    if (!line) continue;
    for (const identity of line.split('\t')) {
      if (!ALLOWED_IDENTITIES.has(identity)) report('history', 'commit identity not on the allowlist', identity);
    }
  }

  for (const record of capture('git', ['log', '--all', '--format=%x1e%H%x1f%B']).split('\x1e')) {
    if (!record) continue;
    const [hash, message = ''] = record.split('\x1f');
    scanText(message, `commit ${hash.slice(0, 7)} message`);
  }

  for (const record of capture('git', ['for-each-ref', '--format=%(refname)%x1f%(contents)%x1e']).split('\x1e')) {
    const [name = '', contents = ''] = record.replace(/^\n/, '').split('\x1f');
    if (name) scanText(`${name}\n${contents}`, 'ref');
  }

  const patch = capture('git', [
    'log',
    '--all',
    '-p',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--format=%x1ecommit %H',
  ]);
  let commit = '';
  let file = '';
  for (const line of patch.split('\n')) {
    if (line.startsWith('\x1ecommit ')) {
      commit = line.slice(8, 15);
    } else if (line.startsWith('diff --git ')) {
      file = line.replace(/^diff --git a\/(.*) b\/.*$/, '$1');
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      checkLine(line.slice(1), `commit ${commit} ${file}`, { lockfile: file.endsWith('package-lock.json') });
    }
  }

  const seen = new Set();
  for (const line of capture('git', ['rev-list', '--all', '--objects']).split('\n')) {
    const [sha, ...rest] = line.split(' ');
    const path = rest.join(' ');
    if (!sha || !path || seen.has(`${sha} ${path}`)) continue;
    seen.add(`${sha} ${path}`);
    checkFileName(path, `history ${path}`);
    if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
      for (const problem of imageMetadataProblems(gitBuffer(['cat-file', 'blob', sha]))) {
        report(`history ${path}`, problem);
      }
    }
  }
  return `history: ${commitCount} commits`;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function scanTarball(tarball, label) {
  const dir = makeTempDir('privacy-scan');
  try {
    const result = spawnSync('tar', ['-xzf', tarball, '-C', dir]);
    if (result.status !== 0) throw new Error(`could not extract ${label}`);
    const files = walk(dir);
    for (const file of files) {
      const path = relative(dir, file).split('\\').join('/');
      const where = `${label} ${path}`;
      if (!PACKAGE_FILES.test(path)) report(where, 'file not on the package allowlist');
      const buffer = readFileSync(file);
      if (buffer.includes('sourceMappingURL')) report(where, 'source map reference');
      scanBuffer(buffer, path, where);
    }
    return files.length;
  } finally {
    removeDir(dir);
  }
}

function scanPack() {
  const { tarball } = packLibrary();
  return `pack: ${scanTarball(tarball, 'package')} files`;
}

function scanRegistry(version) {
  const name = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).name;
  scanText(capture('npm', ['view', `${name}@${version}`, '--json']), `registry ${version} metadata`);
  const dir = makeTempDir('privacy-registry');
  try {
    const [info] = JSON.parse(capture('npm', ['pack', `${name}@${version}`, '--json', '--pack-destination', dir]));
    return `registry ${version}: ${scanTarball(join(dir, info.filename), `registry ${version}`)} files`;
  } finally {
    removeDir(dir);
  }
}

// ---------------------------------------------------------------------------------------------------------------

const summary = [];
if (modes.tree) summary.push(scanTree());
if (modes.history) summary.push(scanHistory());
if (modes.pack) summary.push(scanPack());
if (modes.registry) summary.push(scanRegistry(modes.registry));

if (terms.length === 0) {
  console.error('privacy scan: no private terms loaded; only the generic checks ran.');
  if (requireTerms) process.exit(1);
}
if (findings.length > 0) {
  console.error(`privacy scan: ${findings.length} finding(s)`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(`privacy scan: clean (${summary.join(', ')}; ${terms.length} private terms)`);
