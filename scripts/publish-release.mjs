#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org';

function runNpm(args) {
  const result = spawnSync('npm', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function registryVersion(packageName, version, run) {
  const result = run(['view', `${packageName}@${version}`, 'version', 'dist.integrity', '--json', '--registry', registry]);
  if (result.status !== 0) {
    // npm's structured code is the only missing-version signal. Network/auth
    // failures must never be mistaken for permission to publish a new version.
    const error = parseJson(result.stdout)?.error ?? parseJson(result.stderr)?.error;
    if (error?.code === 'E404') return null;
    throw new Error(`Cannot inspect npm version: ${result.stderr || result.stdout}`);
  }
  const metadata = parseJson(result.stdout);
  if (!metadata || metadata.version !== version || typeof metadata['dist.integrity'] !== 'string') {
    throw new Error('npm returned incomplete or unexpected version metadata');
  }
  return metadata;
}

/** Publish exactly the packed bytes, or resume only an identical publication. */
export async function publishRelease({ tarball, packageName, version }, {
  run = runNpm,
  read = readFileSync,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
} = {}) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  const integrity = `sha512-${createHash('sha512').update(read(tarball)).digest('base64')}`;
  const existing = registryVersion(packageName, version, run);
  if (existing) {
    if (existing['dist.integrity'] !== integrity) {
      throw new Error(`npm ${packageName}@${version} already exists with different package bytes; refusing release`);
    }
    return { integrity, published: false };
  }

  const published = run(['publish', tarball, '--access', 'public', '--provenance', '--registry', registry]);
  if (published.status !== 0) {
    throw new Error(`npm publish failed; keep the draft release and tag for retry: ${published.stderr || published.stdout}`);
  }
  // npm scans accepted uploads before exposing them; availability commonly
  // takes five minutes and can exceed fifteen minutes during busy periods.
  log(`${packageName}@${version} accepted by npm; waiting up to 20 minutes for registry availability`);
  for (let attempt = 0; attempt <= 40; attempt += 1) {
    const metadata = registryVersion(packageName, version, run);
    if (metadata) {
      if (metadata['dist.integrity'] !== integrity) throw new Error('Published npm package integrity does not match the packed tarball');
      return { integrity, published: true };
    }
    if (attempt < 40) {
      log(`Waiting for npm scanning/availability (${attempt + 1}/40; next check in 30s)`);
      await wait(30_000);
    }
  }
  throw new Error('Published npm version is not visible yet; keep the draft release and tag for retry');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    const tarball = args[args.indexOf('--tarball') + 1];
    const version = args[args.indexOf('--version') + 1];
    if (!args.includes('--tarball') || !args.includes('--version') || !tarball || !version) {
      throw new Error('Usage: node scripts/publish-release.mjs --tarball <file.tgz> --version <x.y.z>');
    }
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    if (pkg.version !== version) throw new Error('package.json version does not match the release version');
    const result = await publishRelease({ tarball, packageName: pkg.name, version });
    console.log(`${result.published ? 'Published' : 'Verified existing'} ${pkg.name}@${version}: ${result.integrity}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
