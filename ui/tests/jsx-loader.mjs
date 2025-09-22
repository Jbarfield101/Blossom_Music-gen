import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.jsx')) {
    const source = await readFile(new URL(url), 'utf8');
    const { code } = await transform(source, {
      loader: 'jsx',
      format: 'esm',
      sourcemap: 'inline',
    });
    return {
      format: 'module',
      source: code,
      shortCircuit: true,
    };
  }
  return defaultLoad(url, context, defaultLoad);
}
