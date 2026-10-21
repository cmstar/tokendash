import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || destination === resolve(root)) throw new Error('Provide a separate server staging directory');
mkdirSync(destination, { recursive: true });
cpSync(join(root, 'dist'), join(destination, 'dist'), { recursive: true });
for (const name of ['package.json', 'package-lock.json']) cpSync(join(root, name), join(destination, name));
// Use the committed dependency graph on every OS instead of resolving fresh ranges.
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--registry=https://registry.npmjs.org'], {
  cwd: destination, stdio: 'inherit', shell: process.platform === 'win32',
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Runtime dependency installation failed (${result.status})`);
console.log(`Staged TokenDash ${JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8')).version} in ${destination}`);
