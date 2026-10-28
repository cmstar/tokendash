import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function runNode(script, args, options = {}) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${basename(script)} ${args[0] ?? ''} failed (${result.signal ?? result.status})`);
  }
  return result.stdout?.trim();
}

function install() {
  const npmCli = process.env.npm_execpath;
  if (!npmCli || !existsSync(npmCli)) {
    throw new Error('Run this installer with npm run install:global [-- <git-url>].');
  }
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && !args[0].startsWith('git+'))) {
    throw new Error('Usage: npm run install:global [-- git+https://github.com/cmstar/tokendash.git#main]');
  }
  const source = args[0];
  const npmMajor = Number(runNode(npmCli, ['--version'], { capture: true }).split('.')[0]);
  // npm 12's pack command does not classify its argument as a root dependency,
  // so packing needs allow-git=all. Older commits may have a mirror URL in their
  // lockfile; normalize that host without rewriting GitHub URLs.
  const gitOptions = source && npmMajor >= 12 ? [
    '--allow-git=all', '--registry=https://registry.npmjs.org',
    '--replace-registry-host=registry.npmmirror.com',
  ] : [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  // Lifecycle scripts also invoke `npm` and `node` by name. Keep those on the
  // same toolchain, even when WSL's PATH includes a Windows npm installation.
  const installEnv = { ...process.env };
  const pathKey = Object.keys(installEnv).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  installEnv[pathKey] = [dirname(process.execPath), installEnv[pathKey]]
    .filter(Boolean).join(delimiter);
  // npm run exports its global prefix. Keep it for installation, but do not let
  // it redirect dependency preparation away from the source checkout.
  const localEnv = Object.fromEntries(Object.entries(installEnv).filter(([key]) =>
    !['npm_config_global', 'npm_config_prefix'].includes(key.toLowerCase())));
  const tempParent = realpathSync(tmpdir());
  const staging = mkdtempSync(join(tempParent, 'tokendash-install-'));

  try {
    if (!source) {
      console.log('Installing source dependencies and building TokenDash...');
      runNode(npmCli, ['ci', '--global=false', '--include=dev'], { env: localEnv });
    }
    console.log(`Packing ${source ?? 'the current checkout'}...`);
    const packResult = JSON.parse(runNode(npmCli, [
      'pack', '--global=false', '--foreground-scripts=false', '--json',
      ...gitOptions, '--pack-destination', staging, source ?? '.',
    ], { capture: true, env: localEnv }));
    // npm <= 11 returns an array; npm 12 keys the result by package name.
    const packed = Array.isArray(packResult) ? packResult
      : packResult && typeof packResult === 'object' ? Object.values(packResult) : [];
    const item = packed[0];
    if (packed.length !== 1 || item?.name !== pkg.name
      || typeof item.filename !== 'string' || basename(item.filename) !== item.filename) {
      throw new Error('npm pack did not return a single TokenDash tarball.');
    }
    for (const required of ['bin/tokendash.js', 'dist/server/index.js', 'dist/server/codexResponseWorker.js', 'dist/client/index.html']) {
      if (!item.files?.some(file => file.path === required)) {
        throw new Error(`The package is missing ${required}. Allow prepare scripts when installing from source.`);
      }
    }
    runNode(npmCli, ['install', '--global', join(staging, item.filename)], { env: installEnv });
    const globalRoot = runNode(npmCli, ['root', '--global'], { capture: true, env: installEnv });
    const version = runNode(join(globalRoot, item.name, 'bin', 'tokendash.js'), ['--version'], { capture: true, env: installEnv });
    if (version !== item.version) throw new Error(`Installed version ${version} does not match ${item.version}.`);
    console.log(`Installed TokenDash ${version} globally. Run: tokendash`);
  } finally {
    if (dirname(resolve(staging)) !== tempParent || !basename(staging).startsWith('tokendash-install-')) {
      throw new Error('Unexpected installer staging directory; refusing cleanup.');
    }
    rmSync(staging, { recursive: true, force: true });
  }
}

try {
  install();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
