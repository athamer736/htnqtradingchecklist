import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.env.HTNQ_F00_ISOLATED !== '1') throw new Error('Use the F00 isolated runner');
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(root, '.f00-evidence/web');
if (!output.startsWith(resolve(root, '.f00-evidence') + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Unexpected isolated output path');
const { build } = await import('vite');
await build({ configFile: resolve(root, 'vite.web.config.ts'), envDir: false, mode: 'test', build: { outDir: output, emptyOutDir: true } });
