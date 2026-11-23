// One-command release: bump the version, commit, tag, push.
//   npm run release            -> patch bump (1.0.0 -> 1.0.1)
//   npm run release -- minor   -> 1.0.0 -> 1.1.0
//   npm run release -- major   -> 1.0.0 -> 2.0.0
//   npm run release -- 1.4.2   -> exactly that version
//   npm run release -- current -> tag the version already in package.json (first release)
// Pushing the tag starts .github/workflows/release.yml, which builds and publishes the release.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`\nRelease aborted: ${msg}\n`);
  process.exit(1);
};

const bump = process.argv[2] ?? 'patch';
if (!/^(patch|minor|major|current|\d+\.\d+\.\d+)$/.test(bump)) fail(`"${bump}" is not patch, minor, major, current or a version like 1.2.3.`);
if (out('git status --porcelain')) fail('you have uncommitted changes. Commit or stash them first.');

const branch = out('git rev-parse --abbrev-ref HEAD');
if (bump === 'current') {
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  run(`git tag -a v${version} -m "Release v${version}"`);
} else {
  // Updates package.json and package-lock.json, commits, and creates the tag v<version>.
  run(`npm version ${bump} -m "Release v%s"`);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

run(`git push origin ${branch}`);
run(`git push origin v${version}`);
console.log(`\nPushed v${version}. GitHub Actions is now building the release:`);
console.log('  https://github.com/NoVanity99/BusinessSim/actions/workflows/release.yml');
console.log('When it finishes, the downloads appear at:');
console.log(`  https://github.com/NoVanity99/BusinessSim/releases/tag/v${version}\n`);
