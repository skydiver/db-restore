# db-restore

Database backup & restore for local development.

Dumps all table data to JSON before an ORM migration reset, then restores it after. Works directly at the database level — ORM-agnostic, framework-agnostic.

## Why

ORM migration resets (`prisma migrate reset`, `drizzle-kit push --force-reset`, etc.) wipe all data — dropping tables, re-running migrations, and re-seeding. This destroys development data that may be hard to recreate.

**db-restore** saves your data before the reset and merges it back after, preserving both your development data and any new seed data from migrations.

## Supported Databases

| Database   | Driver          |
| ---------- | --------------- |
| PostgreSQL | `pg`            |
| MySQL      | `mysql2`        |
| SQLite     | `better-sqlite3`|

## Quick Start

```bash
# Install
pnpm add -g db-restore

# Create a profile (one-time)
db-restore setup myproject

# Before migration reset: dump your data
db-restore dump myproject

# Run your ORM reset
prisma migrate reset   # or drizzle-kit push --force-reset, etc.

# After migration reset: restore your data
db-restore restore myproject
```

## Commands

```
db-restore setup <name>              Create a new database profile interactively
db-restore dump <name> [--out <dir>] Dump all tables to JSON
db-restore restore <name> [--in <dir>] Restore tables from JSON dump
db-restore profiles                  List all saved profiles
db-restore remove <name>             Delete a profile
```

### `setup`

Interactive profile creation. Prompts for connection details, tests the connection, and saves the profile. Passwords are never stored — they're prompted before each dump/restore.

```
$ db-restore setup myproject

? Provider: postgres
? Host: localhost
? Port: 5432
? Database: myproject_dev
? User: postgres
? Password: ********

Testing connection... Connected.
Profile "myproject" saved.
```

### `dump`

Connects to the database, discovers all tables (excluding ORM migration tables), and writes each table's data to a JSON file.

```
$ db-restore dump myproject

┌──────────┬──────┐
│ Table    │ Rows │
├──────────┼──────┤
│ users    │   42 │
│ posts    │  128 │
│ comments │  301 │
├──────────┼──────┤
│ Total    │  471 │
└──────────┴──────┘

Dump saved to ~/.config/db-restore/dumps/myproject (3 files)
```

If a previous dump exists, you'll be asked to archive it (`.tar.gz`), discard it, or cancel.

### `restore`

Reads the dump files and writes data back using UPSERT — your development data is merged with any new seed data from migrations.

```
$ db-restore restore myproject

┌──────────┬──────┬──────────┐
│ Table    │ Rows │ Strategy │
├──────────┼──────┼──────────┤
│ users    │   42 │ upsert   │
│ posts    │  128 │ upsert   │
│ comments │  301 │ upsert   │
├──────────┼──────┼──────────┤
│ Total    │  471 │          │
└──────────┴──────┴──────────┘

Restore complete (471 rows across 3 tables)
```

### `profiles`

Lists all saved profiles in a table.

### `remove`

Deletes a saved profile.

## How It Works

### Dump Process

1. Connect to the database
2. Discover tables (auto-excludes ORM migration tables)
3. For each table: read columns, primary keys, and all rows
4. Encode special types (bytes, bigint, decimal, datetime, json) as JSON-safe wrappers
5. Write one JSON file per table + a `_metadata.json`

### Restore Process

1. Connect to the database
2. Disable foreign key checks
3. For each table in the dump:
   - Detect schema drift (added/removed columns) and warn
   - Decode type wrappers back to native values
   - **Tables with primary keys**: UPSERT (insert or update on conflict)
   - **Tables without primary keys**: TRUNCATE + INSERT
4. Reset auto-increment sequences (PostgreSQL)
5. Re-enable foreign key checks

### UPSERT Strategy

UPSERT preserves new seed data from migrations while restoring your dump data:

- **Rows in dump matching DB primary key** — updated with dump values
- **Rows in dump with no match** — inserted (your dev data)
- **Rows in DB with no match in dump** — kept (new seed data)

### Schema Drift

If the database schema changed between dump and restore:

- **Column in both dump and DB** — included in restore
- **Column in dump but not in DB** — skipped with warning
- **Column in DB but not in dump** — uses DB default with warning
- **Table in dump but not in DB** — skipped with warning

### Type Encoding

Special database types are encoded as JSON wrappers to prevent data loss:

| Type     | JSON Representation                        |
| -------- | ------------------------------------------ |
| bytes    | `{ "__type": "bytes", "value": "..." }`    |
| bigint   | `{ "__type": "bigint", "value": "..." }`   |
| decimal  | `{ "__type": "decimal", "value": "..." }`  |
| datetime | `{ "__type": "datetime", "value": "..." }` |
| json     | `{ "__type": "json", "value": ... }`       |

Primitive types (int, float, string, boolean, null) are stored as-is.

### Excluded Tables

ORM migration tables are automatically excluded from dumps:

| Table                  | ORM             |
| ---------------------- | --------------- |
| `_prisma_migrations`   | Prisma          |
| `__drizzle_migrations` | Drizzle         |
| `knex_migrations`      | Knex            |
| `knex_migrations_lock` | Knex            |
| `typeorm_migrations`   | TypeORM         |
| `SequelizeMeta`        | Sequelize       |
| `SequelizeData`        | Sequelize       |
| `mikro_orm_migrations` | MikroORM        |
| `objection_migrations` | Objection       |
| `_cf_KV`               | D1 (Cloudflare) |

## Dump Format

```
~/.config/db-restore/
  profiles/
    myproject.json
  dumps/
    myproject/
      _metadata.json     # provider, timestamp, table list, format version
      users.json         # one file per table
      posts.json
      comments.json
```

Each table file contains column metadata and all rows:

```json
{
  "table": "users",
  "primaryKeys": ["id"],
  "columns": [
    { "name": "id", "type": "integer" },
    { "name": "email", "type": "character varying" },
    { "name": "created_at", "type": "timestamp without time zone" }
  ],
  "rows": [
    {
      "id": 1,
      "email": "dev@example.com",
      "created_at": { "__type": "datetime", "value": "2026-01-15T10:30:00.000Z" }
    }
  ]
}
```

## Profiles

Connection profiles are stored in `~/.config/db-restore/profiles/`. Passwords are never persisted.

```json
{
  "name": "myproject",
  "provider": "postgres",
  "host": "localhost",
  "port": 5432,
  "database": "myproject_dev",
  "user": "postgres"
}
```

SQLite profiles store the file path instead of connection details:

```json
{
  "name": "myproject",
  "provider": "sqlite",
  "path": "./data/dev.db"
}
```

## Development

```bash
pnpm install
pnpm dev          # Watch mode with tsx
pnpm test         # Run tests with Vitest
pnpm typecheck    # Type check with tsc
pnpm lint         # Lint with Biome
pnpm build        # Bundle with tsup
```

## License

[MIT](./LICENSE)
