#!/usr/bin/env node
/**
 * bundle-zod-types — make the published declarations self-contained.
 *
 * The context entry bundles `zod` at runtime, so the package has no runtime dependency on it, but its
 * declarations (`dist/context.d.ts` / `.d.cts`) still reference zod's types. Without this step a
 * consumer that has not installed zod would see unresolved types. This copies zod's own
 * declaration files (MIT licensed; the license travels with them) into `dist/vendor/zod/` and points
 * the declarations at that copy. Runs after `tsup` as part of `npm run build`.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const require = createRequire(import.meta.url);
const ZOD = dirname(require.resolve('zod/package.json'));
const OUT = join(DIST, 'vendor', 'zod');

/** Copy every declaration file under `from` into `to`, preserving the layout. */
function copyDeclarations(from, to) {
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    if (statSync(src).isDirectory()) copyDeclarations(src, join(to, name));
    else if (name.endsWith('.d.ts') || name.endsWith('.d.cts')) {
      mkdirSync(to, { recursive: true });
      cpSync(src, join(to, name));
    }
  }
}

mkdirSync(OUT, { recursive: true });
for (const f of ['index.d.ts', 'index.d.cts']) cpSync(join(ZOD, f), join(OUT, f));
copyDeclarations(join(ZOD, 'v3'), join(OUT, 'v3'));
cpSync(join(ZOD, 'LICENSE'), join(OUT, 'LICENSE'));
const version = JSON.parse(readFileSync(join(ZOD, 'package.json'), 'utf8')).version;
writeFileSync(
  join(OUT, 'README.md'),
  `# zod ${version} type declarations\n\nThe type declarations of [zod](https://github.com/colinhacks/zod) ${version}, MIT licensed (see LICENSE), copied here so the \`@ultrarouter/sdk/context\` declarations resolve without installing zod. zod itself is bundled into the context entry at runtime.\n`,
);

let rewritten = 0;
for (const name of readdirSync(DIST)) {
  if (!/\.d\.c?ts$/.test(name)) continue;
  const file = join(DIST, name);
  const text = readFileSync(file, 'utf8');
  if (!/from ['"]zod['"]/.test(text)) continue;
  const target = `./${relative(DIST, OUT).split('\\').join('/')}/index.${name.endsWith('.d.cts') ? 'cjs' : 'js'}`;
  writeFileSync(file, text.replace(/from (['"])zod\1/g, `from '${target}'`));
  rewritten += 1;
}

const leftovers = readdirSync(DIST).filter(
  (n) => /\.d\.c?ts$/.test(n) && /from ['"]zod['"]/.test(readFileSync(join(DIST, n), 'utf8')),
);
if (leftovers.length > 0 || !existsSync(join(OUT, 'v3', 'external.d.ts'))) {
  console.error(`bundle-zod-types: FAILED (${leftovers.join(', ') || 'zod declarations missing'})`);
  process.exit(1);
}
console.log(
  `bundle-zod-types: zod ${version} declarations in dist/vendor/zod; ${String(rewritten)} declaration file(s) repointed`,
);
