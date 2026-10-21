import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
// Release tooling is executable JavaScript shared with GitHub Actions.
// @ts-expect-error Standalone release script does not ship TypeScript declarations.
import { publishRelease } from '../../../scripts/publish-release.mjs';

const bytes = Buffer.from('one immutable npm tarball');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const options = { tarball: 'package.tgz', packageName: '@example/package', version: '2.0.0' };
const success = (value: unknown) => ({ status: 0, stdout: JSON.stringify(value), stderr: '' });
const missing = { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: '' };
const metadata = (hash = integrity) => ({ version: options.version, 'dist.integrity': hash });

function dependencies(results: unknown[]) {
  const run = vi.fn(() => {
    if (!results.length) throw new Error('Unexpected command');
    return results.shift();
  });
  return { run, read: () => bytes, wait: vi.fn(async () => {}) };
}

describe('immutable npm release publication', () => {
  it('publishes the exact tarball and waits for matching registry integrity', async () => {
    const deps = dependencies([missing, success({}), missing, success(metadata())]);
    await expect(publishRelease(options, deps)).resolves.toEqual({ integrity, published: true });
    expect(deps.run.mock.calls.map((call) => call[0])).toEqual([
      ['view', '@example/package@2.0.0', 'version', 'dist.integrity', '--json', '--registry', 'https://registry.npmjs.org'],
      ['publish', 'package.tgz', '--access', 'public', '--provenance', '--registry', 'https://registry.npmjs.org'],
      ['view', '@example/package@2.0.0', 'version', 'dist.integrity', '--json', '--registry', 'https://registry.npmjs.org'],
      ['view', '@example/package@2.0.0', 'version', 'dist.integrity', '--json', '--registry', 'https://registry.npmjs.org'],
    ]);
    expect(deps.wait).toHaveBeenCalledOnce();
  });

  it('resumes an identical version without attempting another publish', async () => {
    const deps = dependencies([success(metadata())]);
    await expect(publishRelease(options, deps)).resolves.toEqual({ integrity, published: false });
    expect(deps.run).toHaveBeenCalledOnce();
  });

  it('rejects a pre-existing version with different tarball bytes', async () => {
    const deps = dependencies([success(metadata('sha512-different'))]);
    await expect(publishRelease(options, deps)).rejects.toThrow('different package bytes');
    expect(deps.run).toHaveBeenCalledOnce();
  });

  it.each(['E401', 'E503', 'ECONNRESET'])('fails closed on registry %s errors', async (code) => {
    const deps = dependencies([{ status: 1, stdout: JSON.stringify({ error: { code } }), stderr: 'registry unavailable' }]);
    await expect(publishRelease(options, deps)).rejects.toThrow('Cannot inspect npm version');
    expect(deps.run).toHaveBeenCalledOnce();
  });

  it('does not interpret a plain-text 404 as a missing version', async () => {
    const deps = dependencies([{ status: 1, stdout: '', stderr: 'Proxy 404 upstream unavailable' }]);
    await expect(publishRelease(options, deps)).rejects.toThrow('Cannot inspect npm version');
    expect(deps.run).toHaveBeenCalledOnce();
  });

  it('keeps a failed publish recoverable and does not finalize anything', async () => {
    const deps = dependencies([missing, { status: 1, stdout: '', stderr: 'connection lost' }]);
    await expect(publishRelease(options, deps)).rejects.toThrow('keep the draft release and tag');
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it('rejects mismatched registry bytes even after a successful publish', async () => {
    const deps = dependencies([missing, success({}), success(metadata('sha512-different'))]);
    await expect(publishRelease(options, deps)).rejects.toThrow('does not match');
  });

  it('rejects metadata for a different version', async () => {
    const deps = dependencies([success({ version: '1.0.0', 'dist.integrity': integrity })]);
    await expect(publishRelease(options, deps)).rejects.toThrow('unexpected version metadata');
  });

  it('stops after bounded registry visibility retries', async () => {
    const deps = dependencies([missing, success({}), missing, missing, missing, missing, missing]);
    await expect(publishRelease(options, deps)).rejects.toThrow('not visible yet');
    expect(deps.wait).toHaveBeenCalledTimes(4);
  });
});
