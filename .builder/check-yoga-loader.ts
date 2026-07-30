import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const ROOT = 'node_modules/yoga-layout';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { version: string };
console.log(`yoga-layout version: ${pkg.version}`);

const scripts = walk(ROOT).filter((f) => /\.(js|mjs|cjs)$/.test(f));
const dynamic = scripts.filter((f) => /createRequire|require\.resolve/.test(readFileSync(f, 'utf-8')));
const inlined = scripts.filter((f) => /base64|fromCharCode|Uint8Array\.from\(atob/.test(readFileSync(f, 'utf-8')));

console.log(`scanned ${scripts.length} script files`);
console.log(`files with an inlined WASM payload: ${inlined.length}`);

if (dynamic.length > 0) {
  console.error('FAIL: yoga-layout resolves its WASM dynamically — bun build --compile cannot see it:');
  for (const f of dynamic) console.error(`  ${f}`);
  process.exit(1);
}

if (inlined.length === 0) {
  console.error('FAIL: no inlined WASM payload found either — inspect the loader by hand before compiling.');
  process.exit(1);
}

console.log('OK: yoga-layout loads its WASM statically, the compiled binary is safe');