## 0.2.0 - 2025-11-17

### Added
- **Batch Insert Vectors** operation: Efficiently insert multiple vectors in batches (up to 1000 per batch)
  - Configurable batch size (default 500)
  - Support for metadata fields extraction from input items
  - Automatic handling of JSON array and native array formats
  - 10-15x performance improvement over individual inserts
- **Vector Search** operation: Simplified KNN similarity search interface
  - Support for multiple distance metrics (cosine, L2, inner product)
  - Optional pre-filtering with additional WHERE conditions
  - Customizable result fields
  - Query vector from input data or JSON array
- Performance optimization documentation with PRAGMA settings
- New usage examples for batch insert and semantic search workflows

### Improved
- Documentation with vector operation best practices
- CLAUDE.md with detailed implementation notes for vector operations

## 0.1.0 - 2025-10-13

- Initial release of the SQLite Manager community node.
- Supports listing, creating, deleting, and querying local SQLite databases.
- Bundles sqlite-vec integration for vector search workflows.
- Provides Docker build instructions and lint/build tooling via `@n8n/node-cli`.
