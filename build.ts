/**
 * Build: bundle each entry with Bun, prepend its userscript metadata block.
 *
 *   bun run build          one-shot
 *   bun run build --watch  rebuild on change
 */
declare const Bun: any;

import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dir;

interface Target {
  entry: string;
  meta: string;
  out: string;
}

const targets: Target[] = [
  { entry: 'src/main.ts', meta: 'src/meta/main.meta.txt', out: 'dist/tradecat-idr.user.js' },
  { entry: 'src/rate-updater.ts', meta: 'src/meta/rate-updater.meta.txt', out: 'dist/tradecat-rate-updater.user.js' },
];

async function buildAll(): Promise<void> {
  for (const target of targets) {
    const result = await Bun.build({
      entrypoints: [join(root, target.entry)],
      target: 'browser',
      format: 'iife',
      minify: false,
      sourcemap: 'none',
    });

    if (!result.success) {
      console.error(`build failed: ${target.entry}`);
      for (const message of result.logs) console.error(message);
      process.exitCode = 1;
      continue;
    }

    const code = await result.outputs[0].text();
    const meta = readFileSync(join(root, target.meta), 'utf8').trimEnd();
    const output = join(root, target.out);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(output, `${meta}\n\n${code}\n`);
    console.log(`built ${target.out} (${(code.length / 1024).toFixed(1)} kB)`);
  }
}

await buildAll();

if (process.argv.includes('--watch')) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const rebuild = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void buildAll();
    }, 120);
  };

  watch(join(root, 'src'), { recursive: true }, rebuild);
  console.log('watching src/ for changes…');
}
