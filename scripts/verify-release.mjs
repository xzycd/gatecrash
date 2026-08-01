import {readFile} from 'node:fs/promises';

function stop(message) {
  process.stderr.write(`release check failed: ${message}\n`);
  process.exitCode = 1;
}

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const versionSource = await readFile(new URL('../src/version.ts', import.meta.url), 'utf8');
const sourceVersion = /export const VERSION = '([^']+)';/.exec(versionSource)?.[1];
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (sourceVersion !== packageJson.version) {
  stop(`package.json is ${packageJson.version}, but src/version.ts is ${sourceVersion ?? 'missing'}`);
}
if (tag !== undefined && tag !== `v${packageJson.version}`) {
  stop(`tag ${tag} does not match package version v${packageJson.version}`);
}
if (packageJson.repository?.url !== 'git+https://github.com/xzycd/gatecrash.git') {
  stop('package repository must be git+https://github.com/xzycd/gatecrash.git');
}
if (packageJson.bin?.gatecrash !== 'dist/cli.js') {
  stop('the gatecrash executable must point to dist/cli.js');
}
if (
  packageJson.publishConfig?.access !== 'public' ||
  packageJson.publishConfig?.registry !== 'https://registry.npmjs.org/' ||
  packageJson.publishConfig?.provenance !== true
) {
  stop('publishConfig must require public npm provenance on the official registry');
}

const installHooks = ['preinstall', 'install', 'postinstall'];
for (const hook of installHooks) {
  if (packageJson.scripts?.[hook] !== undefined) {
    stop(`package must not define the install-time ${hook} hook`);
  }
}

if (process.exitCode === undefined) {
  process.stdout.write(`release check passed for @xzycd/gatecrash@${packageJson.version}\n`);
}
