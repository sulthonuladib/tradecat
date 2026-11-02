/**
 * Version bump: keeps both userscript metadata blocks and package.json in sync,
 * then rebuilds dist/.
 *
 *   bun run bump 0.2.1
 *
 * ScriptCat only offers an update when the remote @version changes, and it
 * compares the version in the *remote* file's metadata block, so dist/ must be
 * rebuilt (and pushed) after bumping.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('usage: bun run bump <major.minor.patch>');
  process.exit(1);
}

const metaFiles = ['src/meta/main.meta.txt', 'src/meta/rate-updater.meta.txt'];
for (const file of metaFiles) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/^\/\/ @version\s+\S+$/m, `// @version      ${next}`);
  if (after === before) {
    console.error(`no @version line found in ${file}`);
    process.exit(1);
  }
  writeFileSync(path, after);
}

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`version -> ${next} (${metaFiles.length} metadata blocks + package.json)`);

await import('../build.ts');
