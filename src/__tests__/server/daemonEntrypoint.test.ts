import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing listener address');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}

describe('bundled daemon entrypoint', () => {
  it('serves an empty profile without running the imported interactive CLI', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'TokenDash daemon 用户 ')));
    let child: ChildProcess | undefined;
    let closed: Promise<void> | undefined;
    let output = '';
    try {
      const dist = join(root, 'dist');
      const home = join(root, 'empty-profile');
      await mkdir(join(dist, 'client'), { recursive: true });
      await mkdir(home);
      await writeFile(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
      await writeFile(join(dist, 'client', 'index.html'), '<html><body>Empty profile dashboard</body></html>');
      // Reproduce the production CommonJS bundle: imports share the entry's
      // import.meta.url, which previously triggered index.ts's CLI main too.
      await build({
        entryPoints: [resolve('src/server/daemon.ts')],
        outfile: join(dist, 'daemon.cjs'),
        bundle: true, platform: 'node', format: 'cjs', packages: 'external',
        banner: { js: 'var __esbuild_import_meta_url = require("url").pathToFileURL(__filename).href;' },
        define: {
          'import.meta.url': '__esbuild_import_meta_url',
          '__TOKENDASH_DAEMON_BUNDLE__': 'true',
        },
      });
      child = spawn(process.execPath, [join(dist, 'daemon.cjs'), '--port', String(await freePort())], {
        env: {
          ...process.env,
          HOME: home, USERPROFILE: home,
          CODEX_HOME: join(home, '.codex'), TOKENDASH_CODEX_HOME: '', TOKENDASH_CODEX_HOMES: '',
          NODE_PATH: resolve('node_modules'),
          TOKENDASH_SETTINGS_FILE: join(home, '.tokendash', 'settings.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      closed = new Promise<void>(done => child!.once('close', () => done()));
      child.on('error', error => { output += String(error); });
      child.stderr?.on('data', data => { output += String(data); });
      child.stdout?.on('data', data => { output += String(data); });
      const deadline = Date.now() + 10_000;
      let port: number | undefined;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Daemon exited ${child.exitCode}: ${output}`);
        try { port = Number(await readFile(join(home, '.tokendash', 'daemon.port'), 'utf8')); } catch { /* Not ready yet. */ }
        if (port) break;
        await new Promise(done => setTimeout(done, 50));
      }
      expect(port, output).toBeGreaterThan(0);
      const info = await fetch(`http://127.0.0.1:${port}/api/app-info`);
      expect(await info.json()).toMatchObject({ packageName: '@zhangferry-dev/tokendash', version: '9.9.9' });
      const dashboard = await fetch(`http://127.0.0.1:${port}/`);
      expect(await dashboard.text()).toContain('Empty profile dashboard');
      await new Promise(done => setTimeout(done, 200));
      expect(child.exitCode, output).toBeNull();
      expect(output).not.toContain('No AI coding assistant data found');
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      if (closed) await closed;
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
