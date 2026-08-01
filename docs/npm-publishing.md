# Publishing Gatecrash through npm

Gatecrash is distributed as the scoped public package `@xzycd/gatecrash`.
Consumers install from npm with:

```bash
npm install --global @xzycd/gatecrash
```

The unscoped `gatecrash` name was previously owned and unpublished by someone
else. Do not build installation instructions around it.

## One-time registry bootstrap

npm cannot stage a brand-new package or attach a trusted publisher before the
package exists. Bootstrap the package once from the existing GitHub v0.5.0
release using an npm account named `xzycd` with two-factor authentication:

```bash
gh release download v0.5.0 --repo xzycd/gatecrash --pattern '*.tgz' --pattern SHA256SUMS
sha256sum --check SHA256SUMS
npm login
npm publish xzycd-gatecrash-0.5.0.tgz --access public
```

On macOS, use `shasum -a 256 -c SHA256SUMS` if `sha256sum` is unavailable.
Do not create a long-lived automation token for this bootstrap.

## Trusted publisher

After 0.5.0 exists on npm, configure the package's trusted publisher with these
exact values:

- Provider: GitHub Actions
- Repository: `xzycd/gatecrash`
- Workflow: `release.yml`
- Environment: `npm`
- Allowed action: `npm stage publish` only

With npm 11.15 or newer, the equivalent authenticated command is:

```bash
npm trust github @xzycd/gatecrash \
  --repo xzycd/gatecrash \
  --file release.yml \
  --env npm \
  --allow-stage-publish
```

In the npm package settings, select **Require two-factor authentication and
disallow tokens**. In the GitHub repository, protect the `npm` environment and
release tags.

## Normal release

1. Update `package.json`, `npm-shrinkwrap.json`, `src/version.ts`, and the
   changelog.
2. Run `npm run release:verify -- vX.Y.Z` and `npm run check`.
3. Push the reviewed `vX.Y.Z` tag.
4. The release workflow creates a **draft** GitHub release and stages the same
   source through npm using a short-lived OIDC credential with provenance.
5. Inspect the staged package on npmjs.com, then approve it with 2FA.
6. Confirm the npm version installs correctly, then publish the draft GitHub
   release. Only published GitHub releases are visible to `gatecrash update`.

The package remains unavailable until that final human approval. The workflow
has no npm token and its trusted identity cannot directly publish a live
version. Keeping GitHub as a draft until npm is live also prevents the updater
from selecting a version that the registry cannot install yet.
