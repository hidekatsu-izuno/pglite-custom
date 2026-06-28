# Filesystems

PGlite has a virtual file system layer that allows it to run in environments that don't traditionally have filesystem access.

PGlite VFSs are under active development, and we plan to extend the range of options in future, as well as make it easy for users to create their own filesystems.

## In-memory FS

The in-memory FS is the default when starting PGlite, and it is available on all platforms. All files are kept in memory and there is no persistence, other than calling [`pg.dumpDataDir()`](./api.md#dumpdatadir) and then using the [`loadDataDir`](./api.md#options) option at start.

To use the in-memory FS you can use one of these methods:

- Don't provide a `dataDir` option
  ```ts
  const pg = new PGlite()
  ```
- Set the `dataDir` to `memory://`
  ```ts
  const pg = new PGlite('memory://')
  ```
- Import and pass the FS explicitly
  ```ts
  import { MemoryFS } from '@electric-sql/pglite'
  const pg = new PGlite({
    fs: new MemoryFS(),
  })
  ```

### Platform Support

| Node | Bun | Deno | Chrome | Safari | Firefox |
| ---- | --- | ---- | ------ | ------ | ------- |
| ✓    | ✓   | ✓    | ✓      | ✓      | ✓       |

## Node FS

The Node FS uses the Node.js file system API to implement a VFS for PGLite. It is available in both Node and Bun.

To use the Node FS you can use one of these methods:

- Set the `dataDir` to a directory on your filesystem
  ```ts
  const pg = new PGlite('./path/to/datadir/')
  ```
- Import and pass the FS explicitly
  ```ts
  import { NodeFS } from '@electric-sql/pglite'
  const pg = new PGlite({
    fs: new NodeFS('./path/to/datadir/'),
  })
  ```

#### Platform Support

| Node | Bun | Deno | Chrome | Safari | Firefox |
| ---- | --- | ---- | ------ | ------ | ------- |
| ✓    | ✓   | ✓    |        |        |         |
