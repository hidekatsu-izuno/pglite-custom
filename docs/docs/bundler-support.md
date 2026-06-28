# Bundler Support

Some bundlers require additional configuration to work with PGlite.

:::tip

If you come across any issues with PGlite and a specific bundler, please [open an issue](https://github.com/electric-sql/pglite/issues/new), we'd also love any contributions to this bundler documentation if you're able to help out.

:::

## Vite

When using [Vite](https://vitejs.dev/), make sure to exclude `pglite` from dependency optimization using the `optimizeDeps` option inside `vite.config.js`:

```js
import { defineConfig } from 'vite'

export default defineConfig({
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
})
```

## esbuild

[esbuild](https://esbuild.github.io/) does not support `new URL('./file', import.meta.url)` pattern that PGlite uses to locate its WebAssembly and data files. This means the automatic file resolution won't work out of the box.

### Workaround: manually provide `pgliteWasmModule`, `initdbWasmModule` and `fsBundle`

1. Copy `pglite.wasm`, `initdb.wasm` and `pglite.data` from `node_modules/@electric-sql/pglite/dist/` to your public/build directory so your web server can serve them.

2. Pass them manually when creating a PGlite instance:

```ts
import { PGlite } from '@electric-sql/pglite'

const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
  WebAssembly.compileStreaming(fetch('/pglite.wasm')),
  WebAssembly.compileStreaming(fetch('/initdb.wasm')),
  fetch('/pglite.data').then((response) => response.blob()),
])

const db = await PGlite.create({
  pgliteWasmModule,
  initdbWasmModule,
  fsBundle,
})
```

Alternatively, you can use an esbuild plugin like [`@chialab/esbuild-plugin-meta-url`](https://chialab.github.io/rna/guide/esbuild-plugin-meta-url) to handle `new URL()` imports automatically.

## Next.js

When using [Next.js](https://nextjs.org/), make sure to add `@electric-sql/pglite` to the `transpilePackages` array in `next.config.js`:

```js
const nextConfig = {
  swcMinify: false,
  transpilePackages: ['@electric-sql/pglite'],
}

export default nextConfig
```
