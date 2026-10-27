import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Release tooling is dependency-free JavaScript, outside the TS build.
import { artifactNames, createManifest, verifyManifest } from '../../../scripts/release-artifacts.mjs';

const version = '1.10.0';
const commit = 'a'.repeat(40);
const dirs: string[] = [];
async function staged() {
  const dir = await mkdtemp(join(tmpdir(), 'tokendash-release-'));
  dirs.push(dir);
  const names = artifactNames(version);
  for (const name of names.slice(0, 4)) await writeFile(join(dir, name), 'installer');
  const appcast = `<rss><channel><item><sparkle:shortVersionString>${version}</sparkle:shortVersionString><enclosure url="https://github.com/zhangferry/tokendash/releases/download/v${version}/${names[0]}" length="9" sparkle:edSignature="${'A'.repeat(86)}==" /></item></channel></rss>`;
  await writeFile(join(dir, 'appcast.xml'), appcast);
  for (const [platform, arch] of [['linux', 'amd64'], ['windows', 'x64']]) {
    await writeFile(join(dir, `${platform}-build.json`), JSON.stringify({ commit, version, platform, arch }));
  }
  return { dir, version, commit };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('complete multi-platform release gate', () => {
  it('creates and verifies a complete release with deterministic hashes', async () => {
    const opts = await staged();
    const manifest = await createManifest(opts);
    expect(manifest.artifacts).toHaveLength(7);
    expect(await verifyManifest(opts)).toEqual(manifest);
    expect(await readFile(join(opts.dir, 'SHA256SUMS'), 'utf8')).toContain(`  TokenDash-${version}-windows-x64-setup.exe\n`);
  });
  it('refuses a missing platform installer', async () => {
    const opts = await staged();
    await rm(join(opts.dir, artifactNames(version)[3]));
    await expect(createManifest(opts)).rejects.toThrow();
  });
  it('rejects builds produced from another commit', async () => {
    const opts = await staged();
    await writeFile(join(opts.dir, 'windows-build.json'), JSON.stringify({ commit: 'b'.repeat(40), version, platform: 'windows', arch: 'x64' }));
    await expect(createManifest(opts)).rejects.toThrow('provenance');
  });
  it('rejects an empty installer', async () => {
    const opts = await staged();
    await writeFile(join(opts.dir, artifactNames(version)[1]), '');
    await expect(createManifest(opts)).rejects.toThrow('empty regular release file');
  });
  it('rejects the wrong expected version or source commit', async () => {
    const opts = await staged();
    await createManifest(opts);
    await expect(verifyManifest({ ...opts, version: '1.10.1' })).rejects.toThrow('manifest');
    await expect(verifyManifest({ ...opts, commit: 'b'.repeat(40) })).rejects.toThrow('manifest');
  });
  it('rejects installer tampering even when the size is unchanged', async () => {
    const opts = await staged();
    await createManifest(opts);
    await writeFile(join(opts.dir, artifactNames(version)[3]), 'malicious');
    await expect(verifyManifest(opts)).rejects.toThrow('digest');
  });
  it('rejects modified checksum lists', async () => {
    const opts = await staged();
    await createManifest(opts);
    await writeFile(join(opts.dir, 'SHA256SUMS'), 'invalid');
    await expect(verifyManifest(opts)).rejects.toThrow('SHA256SUMS');
  });
  it('rejects appcasts pointing at a fork', async () => {
    const opts = await staged();
    const path = join(opts.dir, 'appcast.xml');
    await writeFile(path, (await readFile(path, 'utf8')).replace('zhangferry/tokendash', 'contributor/tokendash'));
    await expect(createManifest(opts)).rejects.toThrow('wrong release');
  });
  it('requires appcast version, size and signature', async () => {
    for (const [from, to] of [[`>${version}<`, '>0.1.0<'], ['length="9"', 'length="8"'], ['sparkle:edSignature', 'unsigned']] as const) {
      const opts = await staged();
      const path = join(opts.dir, 'appcast.xml');
      await writeFile(path, (await readFile(path, 'utf8')).replace(from, to));
      await expect(createManifest(opts)).rejects.toThrow('Appcast');
    }
  });
});
