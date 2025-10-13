# n8n-nodes-sqlite-manager

Custom node for n8n that manages the SQLite workspace used on this server. It lets you create and delete database files under `/opt/sqlite-db`, run SQL statements directly from a workflow or from the Execute Command node, and ships with the [`sqlite-vec`](https://github.com/asg017/sqlite-vec) extension pre-installed for vector search.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

- [Installation](#installation)
- [Operations](#operations)
- [Credentials](#credentials)
- [Compatibility](#compatibility)
- [Usage](#usage)
- [Resources](#resources)
- [Version history](#version-history)

## Installation

This node is baked into the custom n8n image (`n8n-custom:1.114.4-python`). No additional steps are required when deploying through Dokploy. To make changes locally, run `pnpm install` followed by `pnpm build` in the project directory.

## Operations

| Operation | Description |
|-----------|-------------|
| **List Databases** | Enumerates `.db`, `.sqlite`, and `.sqlite3` files stored in `/opt/sqlite-db`, returning name, absolute path, size, and last modified timestamp. |
| **Create Database** | Creates a new SQLite file (or truncates an existing one if `Overwrite If Exists` is enabled) and optionally executes bootstrap SQL. |
| **Delete Database** | Removes a SQLite file, with an option to ignore missing files. |
| **Execute Query** | Runs arbitrary SQL using the system `sqlite3` binary, returning JSON rows when `Return Data` is enabled. |

## Credentials

No external credentials are required. The node operates on local files inside the container and respects the `SQLITE_BASE_DIR` environment variable if it is set (defaults to `/opt/sqlite-db`).

## Compatibility

Tested with n8n `1.114.4` on Node.js `22.19.0`. The implementation depends on the SQLite CLI shipped in the container (`sqlite3 >= 3.49`).

## Usage

1. Add the *SQLite Manager* node to your workflow.
2. Choose an operation. For queries, supply the database file (without or with extension) and the SQL to run.
3. Select **Return Data** to emit query results as items, or disable it for data manipulation statements.
4. Combine with the built-in *Execute Command* node if you need more complex scripting alongside Python tooling already present in the image.

Databases are stored on the named Docker volume mounted at `/opt/sqlite-db`, so they persist across container restarts.

The `sqlite-vec` library is stored at `/usr/local/lib/sqlite-extensions/vec0.so` (entrypoint `sqlite3_vec_init`) and the node automatically loads it before running query and initialization statements. You can also reference that path manually from the Execute Command node when working with the `sqlite3` CLI.

## Resources

- [n8n community node documentation](https://docs.n8n.io/integrations/community-nodes/)
- [SQLite CLI documentation](https://sqlite.org/cli.html)
- [`sqlite-vec` documentation](https://alexgarcia.xyz/sqlite-vec/)

## Version history

- **0.1.0** – Initial release of the SQLite Manager node with bundled sqlite-vec vector extension support.
