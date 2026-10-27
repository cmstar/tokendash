import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const platform = process.argv[2];
if (!['linux', 'windows'].includes(platform)) throw new Error('Usage: node scripts/stage-desktop-artifacts.mjs linux|windows');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const arch = platform === 'linux' ? 'amd64' : 'x64';
const target = platform === 'linux' ? 'release' : 'x86_64-pc-windows-msvc/release';
const bundle = join(root, 'src-tauri/target', target, 'bundle');
const expected = platform === 'linux' ? [
  ['deb', `TokenDash_${version}_amd64.deb`, `TokenDash-${version}-linux-amd64.deb`],
  ['appimage', `TokenDash_${version}_amd64.AppImage`, `TokenDash-${version}-linux-amd64.AppImage`],
] : [['nsis', `TokenDash_${version}_x64-setup.exe`, `TokenDash-${version}-windows-x64-setup.exe`]];
// Refuse stale or wrongly versioned outputs rather than attaching any glob match.
for (const [directory, name] of expected) {
  if (!readdirSync(join(bundle, directory)).includes(name)) throw new Error(`Missing ${directory}/${name}`);
}
const output = resolve(root, 'release', `ci-${platform}`);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [directory, name, normalized] of expected) cpSync(join(bundle, directory, name), join(output, normalized));
writeFileSync(join(output, `${platform}-build.json`), JSON.stringify({
  version, commit, platform, arch, ciRunId: process.env.GITHUB_RUN_ID ?? null,
}, null, 2) + '\n');
console.log(output);
