# SQLite Manager (n8n community node)

Manage local SQLite databases – including vector search with [`sqlite-vec`](https://github.com/asg017/sqlite-vec) – directly from your n8n workflows.

This package bundles a single node (`sqliteManager`) that can:

- discover and manage SQLite database files stored on the n8n host
- create or delete databases with optional bootstrap SQL
- execute arbitrary SQL (including vector KNN queries via `sqlite-vec`)
- return query results as structured JSON for downstream nodes

> **Use case examples**
>
> - Maintain lightweight knowledge bases for AI agents hosted in n8n
> - Share local cache tables between workflows without an external DB
> - Run ad‑hoc data migrations or maintenace scripts inside a workflow

---

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Node operations](#node-operations)
- [Usage examples](#usage-examples)
- [Development](#development)
- [Support](#support)
- [Version history](#version-history)

## Requirements

| Component            | Version / notes                                    |
| -------------------- | -------------------------------------------------- |
| **n8n**              | 1.114.4 or newer (tested in Docker & desktop)      |
| **Node.js**          | 22.x (matches upstream n8n release)                |
| **SQLite CLI**       | ≥ 3.49 with JSON output support (`sqlite3 -json`)  |
| **sqlite-vec**       | Bundled automatically during Docker build          |
| **File system**      | Write access to the directory storing databases    |

The node does not require external credentials or APIs. All operations happen on the local file system of the n8n host/container.

## Installation

### From the n8n UI (recommended)

1. Open *Settings → Community Nodes → Install*.
2. Enter the package name: `n8n-nodes-rckflr-sqlitemanager`.
3. Acknowledge the community-node warning banner and confirm the install.
4. Reload the editor if the new icon does not appear immediately.

### From the command line

```bash
cd ~/.n8n
pnpm install n8n-nodes-rckflr-sqlitemanager
pnpm build
```

Restart the n8n instance afterwards.

### Docker / self-hosted images

Add the package to the `N8N_COMMUNITY_NODES_INSTALL` environment variable:

```env
N8N_COMMUNITY_NODES_INSTALL=n8n-nodes-rckflr-sqlitemanager
```

The included Dockerfile in this repository demonstrates how we compile `sqlite-vec` at build time and mount persistent volumes for SQLite data and user-installed Python packages.

## Configuration

The node looks up its working directory from the following environment variables:

| Variable                | Default                   | Purpose                                   |
| ----------------------- | ------------------------- | ----------------------------------------- |
| `SQLITE_BASE_DIR`       | `/opt/sqlite-db`          | Root directory where database files live. |
| `SQLITE_VEC_LIBRARY`    | `/usr/local/lib/sqlite-extensions/vec0.so` | Location of the compiled sqlite-vec shared object. |
| `SQLITE_VEC_ENTRYPOINT` | `sqlite3_vec_init`        | Entry point name inside the sqlite-vec module.      |

Ensure that the directory referenced by `SQLITE_BASE_DIR` is writable by the user running n8n (inside Docker, usually the `node` user).

## Node operations

| Operation        | Parameters                                                                                      | Notes                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **List Databases** | _None_                                                                                         | Returns one item per file (name, absolute path, `sizeBytes`, `updatedAt`).                        |
| **Create Database** | `databaseName`, `overwrite` (boolean), `initialSql` (multiline string)                         | Creates or truncates a file. `initialSql` is executed immediately after creation.                 |
| **Delete Database** | `databaseName`, `ignoreMissing` (boolean)                                                      | Deletes the file. When `ignoreMissing=true` the node emits a result but does not raise an error.   |
| **Execute Query**   | `databaseName`, `sql`, `returnData` (boolean), `failOnEmpty` (boolean)                         | Runs SQL via the SQLite CLI. When `returnData=true`, results are parsed from the `-json` output.   |

Vector queries work out of the box. For example:

```sql
SELECT headline, distance
FROM vec_articles
WHERE headline_embedding MATCH lembed('n8n automation')
  AND k = 5;
```

The node will automatically preload the `sqlite-vec` library before executing the statement.

## Usage examples

### 1. Building a lightweight embeddings store

1. Use *Create Database* with an `initialSql` that defines a `vec0` virtual table.
2. Insert embeddings generated elsewhere (or from an HTTP node).
3. Run *Execute Query* with a `MATCH` clause to retrieve similar content.

### 2. ETL on local CSV drops

1. Start the workflow when a new file arrives (e.g. via SFTP or HTTP).
2. Load the data into a temporary SQLite database with staging tables.
3. Run transformation SQL, then export the result to the next node.
4. Clean up the temporary database with *Delete Database*.

### 3. Operational maintenance

Schedule the node (using Cron plus Execute Query) to vacuum or analyze databases, and funnel results into Slack/email notifications if anomalies are detected.

## Development

```bash
pnpm install
pnpm lint
pnpm build
pnpm dev   # launches a local n8n instance with hot-reload for the node
```

We rely on the official [`@n8n/node-cli`](https://docs.n8n.io/integrations/creating-nodes/cli/) for builds, linting, and publishing. Make sure you run `pnpm build` before committing to keep the transpiled artifacts in sync.

### Automated tests

Run the end-to-end regression suite (requires `sqlite3` and a compiled `sqlite-vec` library):

```bash
SQLITE_VEC_LIBRARY=/usr/local/lib/sqlite-extensions/vec0 \
SQLITE_VEC_ENTRYPOINT=sqlite3_vec_init \
pnpm test
```

The test script spins up a temporary database, creates a `vec0` virtual table, inserts fixture vectors, and asserts that the nearest-neighbour query returns the expected record.

### Project structure

```
nodes/
  SqliteManager/
    SqliteManager.node.ts    # Source TypeScript implementation
    SqliteManager.node.json  # Metadata consumed by n8n
    sqliteManager.svg        # Icon (light theme)
    sqliteManager.dark.svg   # Icon (dark theme)
dist/                        # Build output generated by `pnpm build`
```

### Verification checklist for n8n

- [x] Package name starts with `n8n-nodes-`.
- [x] README includes installation, usage, compatibility, and support information.
- [x] MIT license file present.
- [x] `n8n` field in `package.json` declares provided nodes.
- [x] `npm run lint` and `npm run build` succeed.
- [x] No bundled secrets or credentials.

## Support

Please open an issue on GitHub for bug reports or feature requests:  
<https://github.com/MauricioPerera/n8n-nodes-rckflr-sqlitemanager/issues>

For consultancy or commercial support, reach out to **Mauricio Perera** at <mauricioperera@gmail.com>.

## Version history

See [CHANGELOG.md](CHANGELOG.md) for a detailed release log.

- **0.1.0** – Initial public release submitted for n8n community verification.

## License

Released under the [MIT License](LICENSE).
