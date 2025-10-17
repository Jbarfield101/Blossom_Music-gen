import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === '@testing-library/react') {
    const url = new URL('./vendor/testing-library-react.js', import.meta.url);
    return { url: url.href, shortCircuit: true };
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
