#!/bin/bash
# Fail a release when package.json's semver does not advance past already
# published npm/GitHub/tag versions. Sparkle needs both the human version and
# CFBundleVersion to move forward; build-number monotonicity alone is not
# enough.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-$(node -p "require('$REPO_ROOT/package.json').version")}"
PACKAGE_NAME="${PACKAGE_NAME:-@zhangferry-dev/tokendash}"
REGISTRY="${REGISTRY:-https://registry.npmjs.org}"
REPO="${GITHUB_REPO:-zhangferry/tokendash}"
NPM_BIN="${NPM_BIN:-npm}"
GH_BIN="${GH_BIN:-gh}"
GIT_BIN="${GIT_BIN:-git}"

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: release version must be semver x.y.z, got: $VERSION" >&2
    exit 1
fi

REFERENCES="${RELEASE_VERSION_REFERENCES:-}"

if [ -z "$REFERENCES" ]; then
    if npm_version="$("$NPM_BIN" view "$PACKAGE_NAME" version --registry "$REGISTRY" 2>/dev/null)"; then
        REFERENCES+="${npm_version}"$'\n'
    else
        echo "Warning: unable to inspect latest npm version for $PACKAGE_NAME" >&2
    fi

    if gh_version="$("$GH_BIN" release view --repo "$REPO" --json tagName --jq '.tagName' 2>/dev/null)"; then
        REFERENCES+="${gh_version}"$'\n'
    else
        echo "Warning: unable to inspect latest GitHub Release for $REPO" >&2
    fi

    if tag_versions="$("$GIT_BIN" ls-remote --tags origin 'refs/tags/v[0-9]*' 2>/dev/null | sed -E 's#.*refs/tags/v?([^{}]+)(\\^\\{\\})?$#\\1#')"; then
        REFERENCES+="${tag_versions}"$'\n'
    else
        echo "Warning: unable to inspect remote release tags" >&2
    fi
fi

REFERENCES="$REFERENCES" node - "$VERSION" <<'NODE'
const current = parse(process.argv[2]);
const refs = (process.env.REFERENCES || '')
  .split(/\s+/)
  .map((value) => value.replace(/^v/, ''))
  .map(parse)
  .filter(Boolean);

if (!current) {
  console.error(`Error: release version must be semver x.y.z, got: ${process.argv[2]}`);
  process.exit(1);
}

if (refs.length === 0) {
  console.error('Error: no published release versions could be inspected; refusing release.');
  process.exit(1);
}

const latest = refs.reduce((max, version) => compare(version, max) > 0 ? version : max, refs[0]);
if (compare(current, latest) <= 0) {
  console.error(`Error: release version ${format(current)} must be greater than latest published ${format(latest)}.`);
  process.exit(1);
}

function parse(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function format(version) {
  return version.join('.');
}
NODE
