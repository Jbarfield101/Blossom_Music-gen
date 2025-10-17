import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const grayMatterUrl = new URL('../src/lib/vendor/gray-matter.js', import.meta.url);

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'gray-matter') {
    return {
      url: grayMatterUrl.href,
      shortCircuit: true,
    };
  }
  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.css')) {
    return {
      format: 'module',
      source: 'export default {};',
      shortCircuit: true,
    };
  }
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
