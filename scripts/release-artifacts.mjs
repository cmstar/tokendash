#!/usr/bin/env node
// Release assets are normalized before this gate; no platform may be omitted.
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_REPO = 'zhangferry/tokendash';

function options(input) {
  const { dir, version, commit, repo = DEFAULT_REPO } = input;
  if (!dir) throw new Error('Release directory is required');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error('Invalid release version');
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Commit must be a full lowercase Git SHA');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid GitHub repository');
  return { dir: resolve(dir), version, commit, repo };
}

export function artifactNames(version) {
  return [
    `TokenDash-${version}-arm64.dmg`,
    `TokenDash-${version}-linux-amd64.deb`,
    `TokenDash-${version}-linux-amd64.AppImage`,
    `TokenDash-${version}-windows-x64-setup.exe`,
    'appcast.xml',
    'linux-build.json',
    'windows-build.json',
  ];
}

async function regularFile(dir, name) {
  const path = join(dir, name);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or empty regular release file: ${name}`);
  return readFile(path);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
}

async function inspect(input) {
  const { dir, version, repo, commit } = input;
  for (const [platform, arch] of [['linux', 'amd64'], ['windows', 'x64']]) {
    const metadata = JSON.parse((await regularFile(dir, `${platform}-build.json`)).toString('utf8'));
    if (metadata.version !== version || metadata.commit !== commit || metadata.platform !== platform || metadata.arch !== arch) {
      throw new Error(`${platform} build provenance version, commit, platform or architecture mismatch`);
    }
  }
  const artifacts = [];
  for (const name of artifactNames(version)) {
    const bytes = await regularFile(dir, name);
    artifacts.push({ name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const xml = (await regularFile(dir, 'appcast.xml')).toString('utf8');
  const enclosures = xml.match(/<enclosure\b[^>]*>/g) ?? [];
  if (enclosures.length !== 1) throw new Error('Appcast must contain exactly one enclosure');
  const enclosure = enclosures[0];
  const expectedURL = `https://github.com/${repo}/releases/download/v${version}/${artifacts[0].name}`;
  if (attribute(enclosure, 'url') !== expectedURL) throw new Error('Appcast enclosure targets the wrong release or DMG');
  if (!/^[A-Za-z0-9+/]{86}==$/.test(attribute(enclosure, 'sparkle:edSignature') ?? '')) {
    throw new Error('Appcast must contain a Sparkle EdDSA signature');
  }
  if (attribute(enclosure, 'length') !== String(artifacts[0].size)) throw new Error('Appcast DMG length mismatch');
  const shortVersion = xml.match(/<sparkle:shortVersionString>\s*([^<]+?)\s*<\/sparkle:shortVersionString>/)?.[1]
    ?? attribute(enclosure, 'sparkle:shortVersionString');
  if (shortVersion !== version) throw new Error('Appcast version mismatch');
  return artifacts;
}

function checksums(artifacts) {
  return artifacts.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join('');
}

export async function createManifest(input) {
  const opts = options(input);
  const artifacts = await inspect(opts);
  const manifest = { schemaVersion: 1, version: opts.version, commit: opts.commit, repo: opts.repo, artifacts };
  await writeFile(join(opts.dir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(opts.dir, 'SHA256SUMS'), checksums(artifacts));
  return manifest;
}

export async function verifyManifest(input) {
  const opts = options(input);
  const manifest = JSON.parse((await regularFile(opts.dir, 'release-manifest.json')).toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.version !== opts.version || manifest.commit !== opts.commit || manifest.repo !== opts.repo) {
    throw new Error('Release manifest version, commit, repository or schema mismatch');
  }
  const artifacts = await inspect(opts);
  if (JSON.stringify(manifest.artifacts) !== JSON.stringify(artifacts)) throw new Error('Release artifact digest, size or inventory mismatch');
  if ((await regularFile(opts.dir, 'SHA256SUMS')).toString('utf8') !== checksums(artifacts)) throw new Error('SHA256SUMS mismatch');
  return manifest;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['create', 'verify'].includes(command)) throw new Error('Usage: release-artifacts.mjs create|verify --dir DIR --version VERSION --commit SHA [--repo OWNER/REPO]');
  const input = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!['dir', 'version', 'commit', 'repo'].includes(key) || !args[i].startsWith('--') || !args[i + 1] || Object.hasOwn(input, key)) throw new Error(`Invalid argument: ${args[i]}`);
    input[key] = args[i + 1];
  }
  const manifest = await (command === 'create' ? createManifest(input) : verifyManifest(input));
  console.log(`Release ${command} passed: v${manifest.version} (${manifest.commit}), ${manifest.artifacts.length} artifacts`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
