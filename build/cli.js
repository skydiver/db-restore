#!/usr/bin/env node

// src/cli.ts
import { realpathSync } from "fs";
import { resolve as resolve2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import { Command } from "commander";
import ora2 from "ora";

// src/constants.ts
import { homedir } from "os";
import { join } from "path";

// src/utils/table-name.ts
var SAFE_CHAR = /^[A-Za-z0-9_.-]$/;
function percentEncodeChar(char) {
  const bytes = Buffer.from(char, "utf-8");
  return Array.from(bytes).map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
}
function toSafeFilename(table) {
  if (table.length === 0) {
    throw new Error("Table name must not be empty");
  }
  let encoded = "";
  for (const char of table) {
    encoded += SAFE_CHAR.test(char) ? char : percentEncodeChar(char);
  }
  if (encoded.startsWith("-")) {
    encoded = `%2D${encoded.slice(1)}`;
  }
  if (encoded === ".") {
    encoded = "%2E";
  } else if (encoded === "..") {
    encoded = "%2E%2E";
  }
  if (encoded.length === 0) {
    throw new Error("Table name produces an empty filename");
  }
  return encoded;
}
function assertSafeProfileName(name) {
  if (name.length === 0) {
    throw new Error("Profile name must not be empty.");
  }
  const encoded = toSafeFilename(name);
  if (encoded !== name) {
    throw new Error(
      `Invalid profile name "${name}": only letters, numbers, "_", "-", and "." are allowed, and the name must not be "." or "..".`
    );
  }
  return name;
}

// src/constants.ts
var EXCLUDED_TABLES = /* @__PURE__ */ new Set([
  "_prisma_migrations",
  "__drizzle_migrations",
  "knex_migrations",
  "knex_migrations_lock",
  "typeorm_migrations",
  "SequelizeMeta",
  "SequelizeData",
  "mikro_orm_migrations",
  "objection_migrations",
  "_cf_KV"
]);
var CONFIG_BASE_DIR = join(homedir(), ".config", "db-restore");
var DUMPS_DIR = join(CONFIG_BASE_DIR, "dumps");
var ARCHIVE_DIR = join(CONFIG_BASE_DIR, "archive");
function getDefaultDumpDir(profileName) {
  assertSafeProfileName(profileName);
  return join(DUMPS_DIR, profileName);
}
var METADATA_FILENAME = "_metadata.json";
var DUMP_FORMAT_VERSION = 1;
var PROVIDER_DEFAULTS = {
  postgres: { host: "localhost", port: 5432, user: "postgres" },
  mysql: { host: "localhost", port: 3306, user: "root" }
};
var BATCH_SIZE = 500;

// src/encoding/encode.ts
var MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
var MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
function encodeValue(value) {
  if (value === null || value === void 0) return value;
  if (typeof value === "bigint") {
    if (value >= MIN_SAFE_BIGINT && value <= MAX_SAFE_BIGINT) {
      return Number(value);
    }
    return { __type: "bigint", value: value.toString() };
  }
  if (value instanceof Date) {
    return { __type: "datetime", value: value.toISOString() };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return { __type: "bytes", value: buf.toString("base64") };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { __type: "json", value };
  }
  return value;
}
function encodeRow(row, jsonColumns) {
  const encoded = {};
  for (const [key, value] of Object.entries(row)) {
    if (jsonColumns?.has(key) && value !== null && value !== void 0) {
      encoded[key] = { __type: "json", value };
    } else {
      encoded[key] = encodeValue(value);
    }
  }
  return encoded;
}

// src/utils/files.ts
import { existsSync } from "fs";
import { chmod as chmod2, lstat, readdir, readFile, writeFile } from "fs/promises";
import { resolve, sep } from "path";

// src/utils/dir-mode.ts
import { chmod, mkdir } from "fs/promises";
async function ensureDir(dir, mode) {
  await mkdir(dir, { recursive: true, mode });
  try {
    await chmod(dir, mode);
  } catch (err) {
    const code = err.code;
    if (code !== "EPERM" && code !== "EACCES") throw err;
  }
}

// src/utils/files.ts
var DIR_MODE = 448;
var FILE_MODE = 384;
function resolveWithinDir(dir, filename) {
  const resolvedDir = resolve(dir);
  const filePath = resolve(resolvedDir, filename);
  if (filePath !== resolvedDir && !filePath.startsWith(resolvedDir + sep)) {
    throw new Error(`Resolved path "${filePath}" escapes directory "${resolvedDir}"`);
  }
  return filePath;
}
async function writeTableDump(dump, dir) {
  await ensureDir(dir, DIR_MODE);
  const filename = `${toSafeFilename(dump.table)}.json`;
  const filePath = resolveWithinDir(dir, filename);
  await writeFile(filePath, JSON.stringify(dump, null, 2), { encoding: "utf-8", mode: FILE_MODE });
  await chmod2(filePath, FILE_MODE);
}
async function assertRegularFile(filePath) {
  const stats = await lstat(filePath);
  if (!stats.isFile()) {
    throw new Error(`Refusing to read "${filePath}": not a regular file`);
  }
}
async function readTableDump(filename, dir) {
  const filePath = resolveWithinDir(dir, filename);
  await assertRegularFile(filePath);
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content);
}
async function writeMetadata(metadata, dir) {
  await ensureDir(dir, DIR_MODE);
  const filePath = resolveWithinDir(dir, METADATA_FILENAME);
  await writeFile(filePath, JSON.stringify(metadata, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE
  });
  await chmod2(filePath, FILE_MODE);
}
async function readMetadata(dir) {
  const filePath = resolveWithinDir(dir, METADATA_FILENAME);
  await assertRegularFile(filePath);
  const content = await readFile(filePath, "utf-8");
  return JSON.parse(content);
}
async function dumpExists(dir) {
  return existsSync(resolveWithinDir(dir, METADATA_FILENAME));
}
async function getTableFiles(dir) {
  const files = await readdir(dir);
  const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== METADATA_FILENAME);
  const entries = [];
  for (const file of jsonFiles) {
    const stats = await lstat(resolveWithinDir(dir, file));
    if (!stats.isFile()) continue;
    const dump = await readTableDump(file, dir);
    entries.push({ file, table: dump.table });
  }
  return entries;
}

// src/commands/dump.ts
async function executeDump(provider, providerName, outputDir) {
  const allTables = await provider.getTables();
  const tables = allTables.filter((t) => !EXCLUDED_TABLES.has(t));
  const result = { tables: [], totalRows: 0 };
  for (const table of tables) {
    const columns = await provider.getColumns(table);
    const primaryKeys = await provider.getPrimaryKeys(table);
    const rows = await provider.getRows(table);
    const jsonColumns = new Set(
      columns.filter((c) => c.type === "json" || c.type === "jsonb").map((c) => c.name)
    );
    const encodedRows = rows.map((row) => encodeRow(row, jsonColumns));
    const dump = {
      table,
      primaryKeys,
      columns,
      rows: encodedRows
    };
    await writeTableDump(dump, outputDir);
    result.tables.push({ table, rowCount: rows.length });
    result.totalRows += rows.length;
  }
  const metadata = {
    provider: providerName,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    tables,
    version: DUMP_FORMAT_VERSION
  };
  await writeMetadata(metadata, outputDir);
  return result;
}

// src/config/profiles.ts
import { existsSync as existsSync2 } from "fs";
import { chmod as chmod3, readdir as readdir2, readFile as readFile2, rm, writeFile as writeFile2 } from "fs/promises";
import { join as join2 } from "path";
var DIR_MODE2 = 448;
var FILE_MODE2 = 384;
function resolveDir(configDir) {
  if (configDir) return configDir;
  return join2(CONFIG_BASE_DIR, "profiles");
}
async function saveProfile(profile, configDir) {
  assertSafeProfileName(profile.name);
  const dir = resolveDir(configDir);
  await ensureDir(dir, DIR_MODE2);
  const filePath = join2(dir, `${profile.name}.json`);
  await writeFile2(filePath, JSON.stringify(profile, null, 2), {
    encoding: "utf-8",
    mode: FILE_MODE2
  });
  await chmod3(filePath, FILE_MODE2);
}
async function loadProfile(name, configDir) {
  assertSafeProfileName(name);
  const dir = resolveDir(configDir);
  const filePath = join2(dir, `${name}.json`);
  if (!existsSync2(filePath)) {
    throw new Error(`Profile "${name}" not found`);
  }
  const content = await readFile2(filePath, "utf-8");
  return JSON.parse(content);
}
async function listProfiles(configDir) {
  const dir = resolveDir(configDir);
  if (!existsSync2(dir)) return [];
  const files = await readdir2(dir);
  const profiles = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const content = await readFile2(join2(dir, file), "utf-8");
    profiles.push(JSON.parse(content));
  }
  return profiles;
}
async function deleteProfile(name, configDir) {
  assertSafeProfileName(name);
  const dir = resolveDir(configDir);
  const filePath = join2(dir, `${name}.json`);
  if (!existsSync2(filePath)) {
    throw new Error(`Profile "${name}" not found`);
  }
  await rm(filePath);
}
async function profileExists(name, configDir) {
  assertSafeProfileName(name);
  const dir = resolveDir(configDir);
  return existsSync2(join2(dir, `${name}.json`));
}

// src/ui/logger.ts
import chalk from "chalk";
var UNSAFE_CONTROL_CHARS = /[\x1b\x00-\x08\x0b\x0c\x0e-\x1f\x80-\x9f]/g;
function sanitize(s) {
  return s.replace(UNSAFE_CONTROL_CHARS, "");
}
function success(message) {
  console.log(chalk.green(`\u2713 ${sanitize(message)}`));
}
function warn(message) {
  console.log(chalk.yellow(`\u26A0 ${sanitize(message)}`));
}
function error(message, hint) {
  const [first, ...rest] = sanitize(message).split("\n");
  console.log(chalk.red(`\u2717 Error: ${first}`));
  if (rest.length > 0) {
    console.log(chalk.gray(rest.join("\n")));
  }
  if (hint) {
    console.log(chalk.gray(`  Hint: ${sanitize(hint)}`));
  }
}
function info(message) {
  console.log(chalk.cyan(`\u2139 ${sanitize(message)}`));
}

// src/ui/table.ts
import chalk2 from "chalk";
import Table from "cli-table3";
function printTable({ head, rows, totalRow }) {
  const table = new Table({
    head: head.map((h) => chalk2.bold(sanitize(h))),
    style: { head: [], border: [] }
  });
  for (const row of rows) {
    table.push(row.map((cell) => sanitize(String(cell))));
  }
  if (totalRow) {
    table.push(totalRow.map((cell) => chalk2.bold(sanitize(String(cell)))));
  }
  console.log(table.toString());
}

// src/commands/profiles.ts
function formatConnection(profile) {
  if (profile.provider === "sqlite") {
    return profile.path;
  }
  return `${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
}
async function profilesCommand() {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    info("No profiles configured. Run: db-restore setup <name>");
    return;
  }
  printTable({
    head: ["Profile", "Provider", "Connection"],
    rows: profiles.map((p) => [p.name, p.provider, formatConnection(p)])
  });
}
async function removeCommand(name) {
  await deleteProfile(name);
  success(`Profile "${name}" removed.`);
}

// src/encoding/decode.ts
function isTypeWrapper(value) {
  return typeof value === "object" && value !== null && "__type" in value && "value" in value;
}
function decodeValue(value) {
  if (!isTypeWrapper(value)) return value;
  switch (value.__type) {
    case "bytes":
      return Buffer.from(value.value, "base64");
    case "bigint":
      return BigInt(value.value);
    case "datetime":
      return new Date(value.value);
    case "decimal":
      return value.value;
    case "json":
      return value.value;
    default:
      return value.value;
  }
}
function decodeRow(row) {
  const decoded = {};
  for (const [key, value] of Object.entries(row)) {
    decoded[key] = decodeValue(value);
  }
  return decoded;
}

// src/utils/batch.ts
function chunk(array, size = BATCH_SIZE) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// src/commands/restore.ts
async function executeRestore(provider, inputDir) {
  const metadata = await readMetadata(inputDir);
  const activeProvider = provider.name;
  if (metadata.provider !== activeProvider) {
    throw new Error(
      `Dump was created with provider "${metadata.provider}" but the active profile uses "${activeProvider}". Restore aborted to avoid restoring incompatible data.`
    );
  }
  if (metadata.version !== DUMP_FORMAT_VERSION) {
    throw new Error(
      `Dump format version mismatch: dump was created with version ${metadata.version}, but this tool expects version ${DUMP_FORMAT_VERSION}. Restore aborted.`
    );
  }
  const tableFiles = await getTableFiles(inputDir);
  const result = { tables: [], totalRows: 0, warnings: [], errors: [] };
  await provider.disableForeignKeys();
  try {
    for (const { file, table: tableName } of tableFiles) {
      try {
        const dump = await readTableDump(file, inputDir);
        const currentTables = await provider.getTables();
        if (!currentTables.includes(tableName)) {
          result.warnings.push(
            `Table "${tableName}" from dump does not exist in database \u2014 skipped`
          );
          continue;
        }
        const currentColumns = await provider.getColumns(tableName);
        const currentColNames = new Set(currentColumns.map((c) => c.name));
        const dumpColNames = new Set(dump.columns.map((c) => c.name));
        for (const col of dump.columns) {
          if (!currentColNames.has(col.name)) {
            result.warnings.push(`Skipping removed column "${col.name}" in table "${tableName}"`);
          }
        }
        const matchingColumns = [];
        for (const col of currentColumns) {
          if (dumpColNames.has(col.name)) {
            matchingColumns.push(col);
          } else {
            result.warnings.push(
              `New column "${col.name}" in table "${tableName}" will use DB default`
            );
          }
        }
        const decodedRows = dump.rows.map((row) => {
          const decoded = decodeRow(row);
          const filtered = {};
          for (const col of matchingColumns) {
            filtered[col.name] = decoded[col.name] ?? null;
          }
          return filtered;
        });
        const currentPks = await provider.getPrimaryKeys(tableName);
        const hasPrimaryKey = currentPks.length > 0;
        if (hasPrimaryKey) {
          await provider.withTransaction(async () => {
            const batches = chunk(decodedRows);
            for (const batch of batches) {
              await provider.upsertRows(tableName, matchingColumns, currentPks, batch);
            }
          });
          result.tables.push({
            table: tableName,
            rowCount: decodedRows.length,
            strategy: "upsert"
          });
        } else {
          result.warnings.push(
            `Table "${tableName}" has no primary key \u2014 using TRUNCATE + INSERT instead of UPSERT`
          );
          await provider.withTransaction(async () => {
            await provider.truncateTable(tableName);
            const batches = chunk(decodedRows);
            for (const batch of batches) {
              await provider.upsertRows(tableName, matchingColumns, [], batch);
            }
          });
          result.tables.push({
            table: tableName,
            rowCount: decodedRows.length,
            strategy: "truncate"
          });
        }
        result.totalRows += decodedRows.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(message);
      }
    }
    for (const entry of result.tables) {
      await provider.resetSequences(entry.table);
    }
  } finally {
    await provider.enableForeignKeys();
  }
  return result;
}

// src/commands/setup.ts
import { input, password as passwordPrompt, select as select2 } from "@inquirer/prompts";
import ora from "ora";

// src/utils/prompt.ts
import { confirm, password, select } from "@inquirer/prompts";
async function askPassword() {
  return password({ message: "Password:" });
}
async function askArchiveChoice() {
  return select({
    message: "Previous dump found. What would you like to do?",
    choices: [
      { name: "Archive (.tar.gz)", value: "archive" },
      { name: "Discard", value: "discard" },
      { name: "Cancel", value: "cancel" }
    ]
  });
}
async function askPostRestoreChoice(hadErrors) {
  const choices = [
    { name: "Keep as-is", value: "keep" },
    { name: "Archive (.tar.gz)", value: "archive" },
    ...hadErrors ? [] : [{ name: "Delete dump files", value: "delete" }]
  ];
  return select({
    message: "What would you like to do with the dump files?",
    choices
  });
}
async function askOverwrite(name) {
  return confirm({
    message: `Profile "${name}" already exists. Overwrite?`,
    default: false
  });
}

// src/utils/provider-factory.ts
async function createProvider(provider) {
  switch (provider) {
    case "sqlite": {
      const { SqliteProvider } = await import("./sqlite-MKFLZFA7.js");
      return new SqliteProvider();
    }
    case "postgres": {
      const { PostgresProvider } = await import("./postgres-5X5AY3DL.js");
      return new PostgresProvider();
    }
    case "mysql": {
      const { MysqlProvider } = await import("./mysql-UGRPCMY3.js");
      return new MysqlProvider();
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
function buildConnectionConfig(profile, password2) {
  if (profile.provider === "sqlite") {
    return { path: profile.path };
  }
  return {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: password2 ?? ""
  };
}

// src/commands/setup.ts
async function setupCommand(name) {
  assertSafeProfileName(name);
  if (await profileExists(name)) {
    const overwrite = await askOverwrite(name);
    if (!overwrite) {
      info("Setup cancelled.");
      return;
    }
  }
  const provider = await select2({
    message: "Provider:",
    choices: [
      { name: "PostgreSQL", value: "postgres" },
      { name: "MySQL", value: "mysql" },
      { name: "SQLite", value: "sqlite" }
    ]
  });
  let profile;
  if (provider === "sqlite") {
    const path = await input({ message: "Database file path:" });
    profile = { name, provider, path };
  } else {
    const defaults = PROVIDER_DEFAULTS[provider];
    const host = await input({ message: "Host:", default: defaults.host });
    const portStr = await input({
      message: "Port:",
      default: String(defaults.port)
    });
    const port = parseInt(portStr, 10);
    const database = await input({ message: "Database:" });
    const user = await input({ message: "User:", default: defaults.user });
    profile = { name, provider, host, port, database, user };
  }
  const pw = profile.provider === "sqlite" ? void 0 : await passwordPrompt({ message: "Password:" });
  const spinner = ora("Testing connection...").start();
  try {
    const dbProvider = await createProvider(profile.provider);
    const config = buildConnectionConfig(profile, pw);
    await dbProvider.connect(config);
    await dbProvider.disconnect();
    spinner.succeed("Connected.");
  } catch (err) {
    spinner.fail("Connection failed.");
    throw err;
  }
  await saveProfile(profile);
  success(`Profile "${name}" saved.`);
}

// src/ui/errors.ts
var errorHints = [
  {
    match: (err) => err.message.includes("ECONNREFUSED"),
    message: (_err, ctx) => `Connection refused at ${ctx.host}:${ctx.port}`,
    hint: (_err, ctx) => `Is ${ctx.provider} running? Check with: ${ctx.provider === "postgres" ? "pg_isready" : "mysqladmin ping"}`
  },
  {
    match: (err) => err.message.includes("authentication") || err.message.includes("Access denied"),
    message: (err) => err.message,
    hint: (_err, ctx) => `Check your password. Run: db-restore setup ${ctx.profile} to reconfigure`
  },
  {
    match: (err) => err.message.includes("does not exist") || err.message.includes("Unknown database"),
    message: (err) => err.message,
    hint: (_err, ctx) => `Create it first or check the profile: db-restore setup ${ctx.profile}`
  },
  {
    match: (err) => err.message.includes("invalid input syntax"),
    message: (err) => err.message,
    hint: () => "The dump may contain values incompatible with the target column type. Try re-dumping with the latest version."
  }
];
function handleError(err, context = {}) {
  if (!(err instanceof Error)) {
    error(String(err));
    return;
  }
  for (const hint of errorHints) {
    if (hint.match(err)) {
      error(hint.message(err, context), hint.hint(err, context));
      return;
    }
  }
  error(err.message);
}

// src/ui/header.ts
import { existsSync as existsSync3, readFileSync } from "fs";
import { dirname, join as join3 } from "path";
import { fileURLToPath } from "url";
import chalk3 from "chalk";
function getVersion() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    const pkgPath = join3(dir, "package.json");
    if (existsSync3(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version ?? "0.0.0";
    }
    dir = dirname(dir);
  }
  return "0.0.0";
}
function printHeader() {
  const version = getVersion();
  const title = `db-restore v${version}`;
  const subtitle = "Database backup & restore";
  const width = Math.max(title.length, subtitle.length) + 4;
  const pad = (s) => s.padEnd(width - 4);
  console.log(chalk3.dim(`\u250C${"\u2500".repeat(width - 2)}\u2510`));
  console.log(chalk3.dim("\u2502") + `  ${chalk3.bold(pad(title))}` + chalk3.dim("\u2502"));
  console.log(chalk3.dim("\u2502") + `  ${chalk3.gray(pad(subtitle))}` + chalk3.dim("\u2502"));
  console.log(chalk3.dim(`\u2514${"\u2500".repeat(width - 2)}\u2518`));
  console.log();
}

// src/utils/archive.ts
import { execFile } from "child_process";
import { chmod as chmod4, readdir as readdir3, rm as rm2 } from "fs/promises";
import { join as join4 } from "path";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
var ARCHIVE_DIR_MODE = 448;
var ARCHIVE_FILE_MODE = 384;
function isSafeArchiveEntry(filename) {
  return !filename.startsWith("-") && !filename.includes("/") && !filename.includes("\\");
}
async function archiveDump(dumpDir, profileName) {
  assertSafeProfileName(profileName);
  await ensureDir(ARCHIVE_DIR, ARCHIVE_DIR_MODE);
  const now = /* @__PURE__ */ new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const archiveName = `${profileName}_${date}_${time}.tar.gz`;
  const archivePath = join4(ARCHIVE_DIR, archiveName);
  const files = await readdir3(dumpDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json") && isSafeArchiveEntry(f));
  await execFileAsync("tar", ["-czf", archivePath, "-C", dumpDir, "--", ...jsonFiles]);
  await chmod4(archivePath, ARCHIVE_FILE_MODE);
  for (const file of jsonFiles) {
    await rm2(join4(dumpDir, file));
  }
  return archivePath;
}
async function deleteDump(dumpDir) {
  const files = await readdir3(dumpDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  for (const file of jsonFiles) {
    await rm2(join4(dumpDir, file));
  }
}

// src/cli.ts
var program = new Command();
async function runDump(name, opts) {
  const profile = await loadProfile(name);
  const outputDir = opts.out ?? getDefaultDumpDir(name);
  const connectionInfo = profile.provider === "sqlite" ? `${profile.provider} @ ${profile.path}` : `${profile.provider} @ ${profile.host}:${profile.port}/${profile.database}`;
  info(`Profile: ${name} (${connectionInfo})`);
  if (await dumpExists(outputDir)) {
    const meta = await readMetadata(outputDir);
    warn(`Previous dump found (${meta.timestamp}, ${meta.tables.length} tables)`);
    const choice = await askArchiveChoice();
    if (choice === "cancel") {
      info("Dump cancelled.");
      return;
    }
    if (choice === "archive") {
      const archivePath = await archiveDump(outputDir, name);
      info(`Archived to ${archivePath}`);
    }
  }
  const pw = profile.provider === "sqlite" ? void 0 : await askPassword();
  const spinner = ora2("Connecting...").start();
  const provider = await createProvider(profile.provider);
  const config = buildConnectionConfig(profile, pw);
  await provider.connect(config);
  spinner.succeed("Connected.");
  const dumpSpinner = ora2("Dumping tables...").start();
  const result = await executeDump(provider, profile.provider, outputDir);
  dumpSpinner.succeed(`${result.tables.length} tables found.`);
  await provider.disconnect();
  printTable({
    head: ["Table", "Rows"],
    rows: result.tables.map((t) => [t.table, t.rowCount]),
    totalRow: ["Total", result.totalRows]
  });
  success(`Dump saved to ${outputDir} (${result.tables.length} files)`);
}
async function runRestore(name, opts) {
  const profile = await loadProfile(name);
  const inputDir = opts.in ?? getDefaultDumpDir(name);
  if (!await dumpExists(inputDir)) {
    error(`No dump found for profile "${name}".`, `Run first: db-restore ${name} dump`);
    return;
  }
  const pw = profile.provider === "sqlite" ? void 0 : await askPassword();
  const spinner = ora2("Connecting...").start();
  const provider = await createProvider(profile.provider);
  const config = buildConnectionConfig(profile, pw);
  await provider.connect(config);
  spinner.succeed("Connected.");
  const restoreSpinner = ora2("Restoring...").start();
  const result = await executeRestore(provider, inputDir);
  const hasErrors = result.errors.length > 0;
  if (hasErrors) {
    restoreSpinner.fail("Restore finished with errors.");
  } else {
    restoreSpinner.succeed("Restore complete.");
  }
  await provider.disconnect();
  printTable({
    head: ["Table", "Rows", "Strategy"],
    rows: result.tables.map((t) => [t.table, t.rowCount, t.strategy]),
    totalRow: ["Total", result.totalRows, ""]
  });
  for (const warning of result.warnings) {
    warn(warning);
  }
  for (const error2 of result.errors) {
    const [first, ...rest] = error2.split("\n");
    const hint = rest.length > 0 ? rest.join("\n") : void 0;
    error(first ?? error2, hint);
  }
  if (hasErrors) {
    process.exitCode = 1;
    info(
      `Partial restore: ${result.totalRows} rows across ${result.tables.length} tables (${result.errors.length} table(s) failed)`
    );
  } else {
    success(
      `Restore complete (${result.totalRows} rows across ${result.tables.length} tables)`
    );
  }
  const postChoice = await askPostRestoreChoice(hasErrors);
  if (postChoice === "delete") {
    await deleteDump(inputDir);
    info("Dump files deleted.");
  } else if (postChoice === "archive") {
    const archivePath = await archiveDump(inputDir, name);
    info(`Archived to ${archivePath}`);
  }
}
program.name("db-restore").description("Database backup & restore for local development").version(getVersion()).argument("[name]", "profile name").argument("[action]", "action to run: dump or restore").option("--out <dir>", "Dump output directory (default: ~/.config/db-restore/dumps/<name>)").option("--in <dir>", "Restore input directory (default: ~/.config/db-restore/dumps/<name>)").option("--verbose", "Show detailed output", false).hook("preAction", () => printHeader()).action(
  async (name, action, opts) => {
    if (!name) {
      program.help();
      return;
    }
    try {
      assertSafeProfileName(name);
      if (!await profileExists(name)) {
        error(
          `Profile "${name}" not found.`,
          'Run "db-restore profiles" to list profiles, or "db-restore setup <name>" to create one.'
        );
        process.exit(1);
      }
      if (action === "dump") {
        await runDump(name, opts);
      } else if (action === "restore") {
        await runRestore(name, opts);
      } else if (!action) {
        error(
          `No action specified for profile "${name}".`,
          `Run: db-restore ${name} dump  |  db-restore ${name} restore`
        );
        process.exit(1);
      } else {
        error(
          `Unknown action "${action}".`,
          `Valid actions: dump, restore. Example: db-restore ${name} dump`
        );
        process.exit(1);
      }
    } catch (err) {
      handleError(err, { profile: name });
      process.exit(1);
    }
  }
);
program.command("setup <name>").description("Create a new database profile interactively").action(async (name) => {
  try {
    await setupCommand(name);
  } catch (err) {
    handleError(err, { profile: name });
    process.exit(1);
  }
});
program.command("profiles").description("List all saved profiles").action(async () => {
  try {
    await profilesCommand();
  } catch (err) {
    handleError(err);
    process.exit(1);
  }
});
program.command("remove <name>").description("Delete a profile").action(async (name) => {
  try {
    await removeCommand(name);
  } catch (err) {
    handleError(err);
    process.exit(1);
  }
});
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  const self = fileURLToPath2(import.meta.url);
  try {
    return realpathSync(self) === realpathSync(entry);
  } catch {
    return self === resolve2(entry);
  }
}
if (isDirectRun()) {
  program.parse();
}
export {
  runDump,
  runRestore
};
