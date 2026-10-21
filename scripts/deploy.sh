#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
elif [ "$#" -gt 0 ]; then
    echo "Usage: $0 [--dry-run]" >&2
    exit 1
fi
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"
COMMIT=$(git rev-parse HEAD)
ARCH=$(uname -m)
REPO="${GITHUB_REPO:-zhangferry/tokendash}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
REGISTRY="https://registry.npmjs.org"
DMG="release/TokenDash-$VERSION-arm64.dmg"
APPCAST="release/appcast.xml"

fail() { echo "Error: $*" >&2; exit 1; }
step() { echo "==> $*"; }
for executable in npm gh git node hdiutil codesign; do
    command -v "$executable" >/dev/null || fail "$executable is required"
done
[ "$ARCH" = "arm64" ] || fail "The macOS release build currently requires an Apple Silicon host"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Expected a stable package version"
[ "$(node -p "require('./package-lock.json').version")" = "$VERSION" ] || fail "Package/lock version mismatch"
[ -z "$(git status --porcelain)" ] || fail "Release checks require a clean committed candidate"
gh auth status >/dev/null

if [ -z "${SPARKLE_PRIVATE_KEY_FILE:-}" ] && [ -s "$HOME/.tokendash/eddsa_priv.key" ]; then
    export SPARKLE_PRIVATE_KEY_FILE="$HOME/.tokendash/eddsa_priv.key"
fi
if [ -z "${SPARKLE_EDDSA_PUB:-}" ] && [ -s "$HOME/.tokendash/eddsa_pub.key" ]; then
    export SPARKLE_EDDSA_PUB
    SPARKLE_EDDSA_PUB=$(cat "$HOME/.tokendash/eddsa_pub.key")
fi
[ -n "${SPARKLE_EDDSA_PUB:-}" ] || fail "Sparkle public key is required"
if [ -n "${SPARKLE_PRIVATE_KEY_FILE:-}" ]; then
    [ -s "$SPARKLE_PRIVATE_KEY_FILE" ] || fail "Sparkle private key file is unreadable"
fi

step "Checking release version and immutable destination"
"$REPO_ROOT/scripts/assert-release-version-advances.sh" "$VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1 || git ls-remote --exit-code --tags "$GIT_REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
    fail "Tag $TAG already exists; resume its release-npm.yml run rather than moving or deleting the tag"
fi
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
    fail "Release $TAG already exists; inspect/resume its existing draft instead of overwriting assets"
fi
if ! $DRY_RUN; then
    [ "$(git branch --show-current)" = "main" ] || fail "deploy must run from main"
    git fetch "$GIT_REMOTE" main --quiet
    [ "$COMMIT" = "$(git rev-parse "$GIT_REMOTE/main")" ] || fail "main must exactly match the remote"
fi

step "Selecting the complete desktop CI build for $COMMIT"
RUNS_FILE=$(mktemp)
NOTES_FILE=$(mktemp)
trap 'rm -f "$RUNS_FILE" "$NOTES_FILE"' EXIT
# CI checks out the exact head SHA even for PR validation. A real publication
# additionally requires the trusted push/main build of the merged commit.
gh run list --repo "$REPO" --workflow test.yml --commit "$COMMIT" --limit 20 \
    --json databaseId,headSha,headBranch,event,status,conclusion > "$RUNS_FILE"
CI_RUN_ID=$(node --input-type=module - "$RUNS_FILE" "$COMMIT" "$DRY_RUN" <<'NODE'
import fs from 'node:fs';
const [file, commit, dry] = process.argv.slice(2);
const run = JSON.parse(fs.readFileSync(file, 'utf8')).find(run => run.headSha === commit
  && (dry === 'true' || (run.event === 'push' && run.headBranch === 'main'))
  && (run.conclusion === 'success' || run.status !== 'completed'));
if (!run) throw new Error('No successful or running exact-commit desktop CI build; push the candidate first');
console.log(run.databaseId);
NODE
)
gh run watch "$CI_RUN_ID" --repo "$REPO" --interval 30 --exit-status
for platform in linux windows; do
    rm -rf "release/ci-$platform"
    gh run download "$CI_RUN_ID" --repo "$REPO" --name "tokendash-$platform" --dir "release/ci-$platform"
done

step "Verifying and building the local macOS release"
npm test
npm run typecheck
CI=true npm run test:e2e
rm -f "$APPCAST"
SPARKLE_BUILD_STRICT=1 npm run build:dmg
[ -s "$DMG" ] || fail "Missing macOS DMG"
./scripts/sparkle-appcast.sh release/
codesign --verify --deep --strict release/TokenDash.app
hdiutil verify "$DMG" >/dev/null
plutil -lint release/TokenDash.app/Contents/Info.plist >/dev/null
APP_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' release/TokenDash.app/Contents/Info.plist)
[ "$APP_VERSION" = "$VERSION" ] || fail "macOS bundle version mismatch"
for platform in linux windows; do
    cp release/ci-"$platform"/* release/
done
node scripts/release-artifacts.mjs create --dir release --version "$VERSION" --commit "$COMMIT" --repo "$REPO"
node scripts/release-artifacts.mjs verify --dir release --version "$VERSION" --commit "$COMMIT" --repo "$REPO"
[ -z "$(git status --porcelain)" ] || fail "Build modified tracked release sources"

if $DRY_RUN; then
    step "All-platform deploy check passed for $TAG ($COMMIT), CI run $CI_RUN_ID"
    echo "Validated macOS DMG/Sparkle, Linux deb/AppImage, Windows NSIS and SHA256 manifest. Nothing published."
    exit 0
fi
awk -v version="$VERSION" '
    $0 == "### v" version { capture=1; next }
    capture && /^### v/ { exit }
    capture { print }
' CHANGELOG.md > "$NOTES_FILE"
[ -s "$NOTES_FILE" ] || fail "Missing release notes for $TAG"

step "Staging the complete release before npm publication"
gh release create "$TAG" --repo "$REPO" --target "$COMMIT" --title "TokenDash $TAG" --notes-file "$NOTES_FILE" --draft
ASSETS=(
    "$DMG" "$APPCAST"
    "release/TokenDash-$VERSION-linux-amd64.deb"
    "release/TokenDash-$VERSION-linux-amd64.AppImage"
    "release/TokenDash-$VERSION-windows-x64-setup.exe"
    release/linux-build.json release/windows-build.json
    release/release-manifest.json release/SHA256SUMS
)
# Failures retain the draft for inspection. Never delete a tag or a potentially
# published npm version in an attempted rollback.
gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO"

if git ls-remote --exit-code --tags "$GIT_REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
    fail "Tag appeared before the gated publisher was started; retain draft and inspect its source"
fi

step "Starting the gated npm OIDC publisher"
git tag -a "$TAG" -m "Release $TAG"
git push "$GIT_REMOTE" "$TAG"
PUBLISH_RUN_ID=""
for attempt in $(seq 1 24); do
    PUBLISH_RUN_ID=$(gh run list --repo "$REPO" --workflow release-npm.yml --commit "$COMMIT" --event push --limit 10 --json databaseId,headBranch --jq ".[] | select(.headBranch == \"$TAG\") | .databaseId" | head -1)
    [ -n "$PUBLISH_RUN_ID" ] && break
    sleep 5
done
[ -n "$PUBLISH_RUN_ID" ] || fail "Publisher did not start; retain draft/tag and inspect Actions"
gh run watch "$PUBLISH_RUN_ID" --repo "$REPO" --interval 30 --exit-status
[ "$(npm view "@zhangferry-dev/tokendash@$VERSION" version --registry "$REGISTRY")" = "$VERSION" ] || fail "npm version was not published"
[ "$(gh release view "$TAG" --repo "$REPO" --json isDraft --jq .isDraft)" = "false" ] || fail "Release is still draft"
step "Published $TAG with every desktop platform and npm"
echo "https://github.com/$REPO/releases/tag/$TAG"
