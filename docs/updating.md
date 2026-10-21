# Auto-updates (Sparkle)

TokenDash uses [Sparkle 2](https://sparkle-project.org) for in-app auto-updates.
Sparkle handles the whole flow: check → download → EdDSA signature verify →
install in place → relaunch. No manual DMG drag-install.

This document covers the **one-time setup** and the **per-release** steps.

## One-time setup

### 1. Build once to resolve the Sparkle dependency

```bash
cd TokenDashSwift && swift build
```

This downloads Sparkle to `.build/checkouts/Sparkle/` and makes its CLI tools
(`generate_keys`, `generate_appcast`) available.

### 2. Generate EdDSA keys

```bash
./scripts/sparkle-keys.sh
```

This:
- Generates an EdDSA keypair.
- Stores the **private key** in your login Keychain (keep it safe — anyone with
  it can ship updates your installed copies accept).
- Writes the **public key** to `~/.tokendash/eddsa_pub.key`.

`scripts/package-app.sh` reads that public key and bakes it into `Info.plist`
as `SUPublicEDKey`, so every packaged build trusts updates signed by your
private key.

### 3. Use GitHub Releases as the appcast feed

The default `SUFeedURL` is:

```text
https://github.com/zhangferry/tokendash/releases/latest/download/appcast.xml
```

Each GitHub Release must contain both its versioned DMG and `appcast.xml`.
GitHub's `latest/download` redirect gives installed apps a stable feed URL
without requiring a separate GitHub Pages site. Override the URL at package
time with:

```bash
SPARKLE_FEED_URL="https://your-host.example/appcast.xml" npm run build:app
```

## Per-release workflow

Version the release in `package.json`, `package-lock.json`, and `CHANGELOG.md`,
then commit the complete release candidate to `main`.

Run the non-publishing verification first:

```bash
npm run deploy:check
```

This checks the exact committed candidate against its successful CI run, downloads
Linux amd64 deb/AppImage and the Windows x64 NSIS installer, runs local tests,
builds the macOS arm64 app/DMG, and generates its signed Sparkle appcast. Every
artifact is checked for version/source consistency and hashed into
`release-manifest.json` and `SHA256SUMS`. It publishes nothing.

After merging and pushing the verified release candidate to `main`, wait for
its **push/main** CI build, then use the single publishing entry point:

```bash
npm run deploy
```

The deploy command:

1. Requires clean local `main` equal to remote `main`, with an unpublished version.
2. Validates CI builds for that exact commit and every desktop artifact.
3. Builds/verifies macOS locally using the existing Sparkle key.
4. Creates a draft Release containing the DMG, appcast, Linux deb/AppImage,
   Windows setup.exe, per-platform source records, manifest, and checksums.
5. Pushes the immutable tag using the maintainer's Git credentials.
6. Waits for `release-npm.yml` to download and verify the actual uploaded bytes,
   pack once, and publish that exact tarball using npm Trusted Publishing/OIDC.
7. Verifies npm integrity before making the complete GitHub Release public/latest.

Do not publish npm or create Releases manually. The workflow filename
`release-npm.yml` is part of the configured npm trusted-publisher identity.
No local npm token or OTP is required. Local `deploy.sh` needs authenticated git
and gh access; the publisher needs GitHub-hosted Node 24/npm 11.6.2 and OIDC.

If publishing fails, retain the draft and tag for inspection. Fix a transient
failure by rerunning the existing release workflow; never delete or move a tag.
If the npm version already exists, resumption is permitted only when its
`dist.integrity` exactly matches the packed tarball. Windows is currently
unsigned; its NSIS installer provisions WebView2 but requires Node 20.10+.
Linux/Windows do not yet have the macOS Sparkle automatic update mechanism.

Local releases use the Sparkle private key in the login Keychain. CI can inject
the same key without importing it by setting `SPARKLE_PRIVATE_KEY_FILE` to a
file containing the base64-encoded EdDSA seed and `SPARKLE_EDDSA_PUB` to the
matching public key.

## Notes

- `CFBundleVersion` must be an incrementing integer. Packaging starts from
  `BUILD_NUMBER` or `git rev-list --count HEAD`, then raises it above the
  highest `sparkle:version` found in the latest and recent published appcasts.
  The deploy flow runs this check in strict mode so a release cannot ship when
  prior appcasts cannot be inspected.
- `package.json`'s semver must also move forward. `deploy.sh` refuses versions
  that are less than or equal to the latest published npm package, GitHub
  Release, or remote release tag.
- If `SUPublicEDKey` is empty (keys not generated), `package-app.sh` warns and
  the build runs but installed copies will **reject** updates until a key is set.
- The distributed macOS app is ad-hoc signed and is not notarized. First-time
  installs must remove its quarantine attribute as documented in `README.md`.
- In development (`swift build` + running the bare binary), Sparkle has no app
  bundle / `SUFeedURL`, so it no-ops and logs. Auto-update only matters for the
  packaged `.app`.
