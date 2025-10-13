"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteManager = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const DEFAULT_BASE_DIR = '/opt/sqlite-db';
const ALLOWED_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const SQLITE_VEC_LIBRARY_PATH = process.env.SQLITE_VEC_LIBRARY || '/usr/local/lib/sqlite-extensions/vec0.so';
const SQLITE_VEC_ENTRYPOINT = process.env.SQLITE_VEC_ENTRYPOINT || 'sqlite3_vec_init';
async function ensureBaseDir(directory) {
    await fs_1.promises.mkdir(directory, { recursive: true });
}
function resolveBaseDir() {
    return process.env.SQLITE_BASE_DIR || DEFAULT_BASE_DIR;
}
function normalizeDatabaseName(rawName) {
    const trimmed = rawName.trim();
    if (!trimmed) {
        throw new n8n_workflow_1.ApplicationError('Database name is required');
    }
    if (/[\\/]/.test(trimmed) || trimmed.includes('..')) {
        throw new n8n_workflow_1.ApplicationError('Database name cannot contain path separators or ".." segments');
    }
    const extension = path_1.default.extname(trimmed);
    if (extension && !ALLOWED_EXTENSIONS.has(extension.toLowerCase())) {
        throw new n8n_workflow_1.ApplicationError('Unsupported database extension. Use .db, .sqlite, or .sqlite3');
    }
    const base = extension ? trimmed : `${trimmed}.db`;
    if (!/^[\w.-]+$/.test(base)) {
        throw new n8n_workflow_1.ApplicationError('Database name may only contain letters, numbers, underscores, hyphens, and dots');
    }
    return base;
}
async function safeResolveDatabasePath(baseDir, dbName) {
    const normalizedName = normalizeDatabaseName(dbName);
    const resolvedBase = path_1.default.resolve(baseDir);
    const absolutePath = path_1.default.resolve(baseDir, normalizedName);
    if (!absolutePath.startsWith(resolvedBase + path_1.default.sep) && absolutePath !== resolvedBase) {
        throw new n8n_workflow_1.ApplicationError('Resolved database path is outside the configured base directory');
    }
    return absolutePath;
}
async function fileExists(filePath) {
    try {
        await fs_1.promises.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function runSqliteCommand(args, sql, options) {
    const finalArgs = [...args];
    if ((options === null || options === void 0 ? void 0 : options.loadVec) && SQLITE_VEC_LIBRARY_PATH) {
        finalArgs.unshift('-cmd', `.load ${SQLITE_VEC_LIBRARY_PATH} ${SQLITE_VEC_ENTRYPOINT}`);
    }
    return await new Promise((resolve, reject) => {
        var _a;
        const child = (0, child_process_1.spawn)('sqlite3', finalArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        if (sql) {
            if (!child.stdin) {
                reject(new n8n_workflow_1.ApplicationError('sqlite3 stdin stream is not available'));
                return;
            }
            child.stdin.setDefaultEncoding('utf-8');
            child.stdin.write(sql);
            if (!sql.endsWith('\n')) {
                child.stdin.write('\n');
            }
        }
        (_a = child.stdin) === null || _a === void 0 ? void 0 : _a.end();
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        child.on('error', (error) => {
            reject(new n8n_workflow_1.ApplicationError(error.message));
        });
        child.on('close', (code) => {
            if (code !== 0) {
                const message = stderr || `sqlite3 exited with code ${code !== null && code !== void 0 ? code : 'null'}`;
                const error = new n8n_workflow_1.ApplicationError(message);
                error.details = { stderr };
                reject(error);
                return;
            }
            resolve({ stdout, stderr });
        });
    });
}
class SqliteManager {
    constructor() {
        this.description = {
            displayName: 'SQLite Manager',
            name: 'sqliteManager',
            icon: { light: 'file:sqliteManager.svg', dark: 'file:sqliteManager.dark.svg' },
            group: ['transform'],
            version: 1,
            description: 'Manage SQLite databases and execute queries',
            defaults: {
                name: 'SQLite Manager',
            },
            inputs: ['main'],
            outputs: ['main'],
            usableAsTool: true,
            properties: [
                {
                    displayName: 'Operation',
                    name: 'operation',
                    type: 'options',
                    noDataExpression: true,
                    options: [
                        {
                            action: 'List databases',
                            name: 'List Databases',
                            value: 'listDatabases',
                            description: 'List SQLite databases in the workspace',
                        },
                        {
                            action: 'Create database',
                            name: 'Create Database',
                            value: 'createDatabase',
                            description: 'Create a new SQLite database file',
                        },
                        {
                            action: 'Delete database',
                            name: 'Delete Database',
                            value: 'deleteDatabase',
                            description: 'Delete a SQLite database file',
                        },
                        {
                            action: 'Execute SQL query',
                            name: 'Execute Query',
                            value: 'executeQuery',
                            description: 'Run SQL against a SQLite database',
                        },
                    ],
                    default: 'listDatabases',
                },
                {
                    displayName: 'Database Name',
                    name: 'databaseName',
                    type: 'string',
                    default: '',
                    required: true,
                    placeholder: 'workspace.db',
                    description: 'Name of the SQLite database file. The .db extension is added if omitted.',
                    displayOptions: {
                        show: {
                            operation: ['createDatabase', 'deleteDatabase', 'executeQuery'],
                        },
                    },
                },
                {
                    displayName: 'Overwrite If Exists',
                    name: 'overwrite',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to truncate the database if it already exists',
                    displayOptions: {
                        show: {
                            operation: ['createDatabase'],
                        },
                    },
                },
                {
                    displayName: 'Initial SQL',
                    name: 'initialSql',
                    type: 'string',
                    typeOptions: {
                        rows: 4,
                    },
                    default: '',
                    placeholder: 'CREATE TABLE IF NOT EXISTS ...',
                    description: 'Optional SQL to run after the database is created',
                    displayOptions: {
                        show: {
                            operation: ['createDatabase'],
                        },
                    },
                },
                {
                    displayName: 'Ignore Missing',
                    name: 'ignoreMissing',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to skip errors if the database does not exist',
                    displayOptions: {
                        show: {
                            operation: ['deleteDatabase'],
                        },
                    },
                },
                {
                    displayName: 'SQL',
                    name: 'sql',
                    type: 'string',
                    typeOptions: {
                        rows: 6,
                    },
                    default: '',
                    required: true,
                    placeholder: 'SELECT * FROM my_table;',
                    displayOptions: {
                        show: {
                            operation: ['executeQuery'],
                        },
                    },
                    noDataExpression: false,
                },
                {
                    displayName: 'Return Data',
                    name: 'returnData',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to return rows from the SQL query as output items',
                    displayOptions: {
                        show: {
                            operation: ['executeQuery'],
                        },
                    },
                },
                {
                    displayName: 'Fail On Empty Result',
                    name: 'failOnEmpty',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to throw an error when a query returns no rows',
                    displayOptions: {
                        show: {
                            operation: ['executeQuery'],
                            returnData: [true],
                        },
                    },
                },
            ],
        };
    }
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        const loopItems = items.length > 0 ? items : [{ json: {} }];
        const baseDir = resolveBaseDir();
        await ensureBaseDir(baseDir);
        for (let itemIndex = 0; itemIndex < loopItems.length; itemIndex++) {
            const operation = this.getNodeParameter('operation', itemIndex);
            try {
                if (operation === 'listDatabases') {
                    const entries = await fs_1.promises.readdir(baseDir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (!entry.isFile())
                            continue;
                        const extension = path_1.default.extname(entry.name).toLowerCase();
                        if (!ALLOWED_EXTENSIONS.has(extension))
                            continue;
                        const fullPath = path_1.default.join(baseDir, entry.name);
                        const stats = await fs_1.promises.stat(fullPath);
                        returnData.push({
                            json: {
                                database: entry.name,
                                path: fullPath,
                                sizeBytes: stats.size,
                                updatedAt: stats.mtime.toISOString(),
                            },
                        });
                    }
                    continue;
                }
                const databaseName = this.getNodeParameter('databaseName', itemIndex, '');
                const dbPath = await safeResolveDatabasePath(baseDir, databaseName);
                switch (operation) {
                    case 'createDatabase': {
                        const overwrite = this.getNodeParameter('overwrite', itemIndex, false);
                        const initialSql = this.getNodeParameter('initialSql', itemIndex, '');
                        const exists = await fileExists(dbPath);
                        if (exists && !overwrite) {
                            throw new n8n_workflow_1.ApplicationError('Database already exists. Enable "Overwrite If Exists" to replace it.');
                        }
                        if (exists && overwrite) {
                            await fs_1.promises.truncate(dbPath, 0);
                        }
                        else {
                            const handle = await fs_1.promises.open(dbPath, 'w');
                            await handle.close();
                        }
                        if (initialSql.trim()) {
                            await runSqliteCommand([dbPath], `${initialSql}\n`);
                        }
                        returnData.push({
                            json: {
                                ...loopItems[itemIndex].json,
                                database: path_1.default.basename(dbPath),
                                created: !exists || overwrite,
                                overwritten: exists && overwrite,
                                path: dbPath,
                            },
                        });
                        break;
                    }
                    case 'deleteDatabase': {
                        const ignoreMissing = this.getNodeParameter('ignoreMissing', itemIndex, false);
                        const exists = await fileExists(dbPath);
                        if (!exists) {
                            if (ignoreMissing) {
                                returnData.push({
                                    json: {
                                        ...loopItems[itemIndex].json,
                                        database: path_1.default.basename(dbPath),
                                        deleted: false,
                                        path: dbPath,
                                    },
                                });
                                break;
                            }
                            throw new n8n_workflow_1.ApplicationError('Database does not exist');
                        }
                        await fs_1.promises.unlink(dbPath);
                        returnData.push({
                            json: {
                                ...loopItems[itemIndex].json,
                                database: path_1.default.basename(dbPath),
                                deleted: true,
                                path: dbPath,
                            },
                        });
                        break;
                    }
                    case 'executeQuery': {
                        const sql = this.getNodeParameter('sql', itemIndex, '');
                        const returnDataFlag = this.getNodeParameter('returnData', itemIndex, true);
                        const failOnEmpty = this.getNodeParameter('failOnEmpty', itemIndex, false);
                        if (!(await fileExists(dbPath))) {
                            throw new n8n_workflow_1.ApplicationError('Database does not exist');
                        }
                        const args = returnDataFlag ? ['-json', dbPath] : [dbPath];
                        const { stdout } = await runSqliteCommand(args, sql, { loadVec: true });
                        if (returnDataFlag) {
                            const trimmed = stdout.trim();
                            if (!trimmed) {
                                if (failOnEmpty) {
                                    throw new n8n_workflow_1.ApplicationError('Query returned no rows');
                                }
                                returnData.push({
                                    json: {
                                        ...loopItems[itemIndex].json,
                                        rows: 0,
                                        database: path_1.default.basename(dbPath),
                                        path: dbPath,
                                    },
                                });
                                break;
                            }
                            let parsed;
                            try {
                                const data = JSON.parse(trimmed);
                                parsed = Array.isArray(data) ? data : [data];
                            }
                            catch (parseError) {
                                const message = parseError.message || 'unknown error';
                                throw new n8n_workflow_1.ApplicationError(`Failed to parse SQLite JSON response: ${message}`);
                            }
                            for (const row of parsed) {
                                returnData.push({ json: { ...loopItems[itemIndex].json, ...row } });
                            }
                        }
                        else {
                            const message = stdout.trim() || 'OK';
                            returnData.push({
                                json: {
                                    ...loopItems[itemIndex].json,
                                    database: path_1.default.basename(dbPath),
                                    path: dbPath,
                                    sql,
                                    result: message,
                                },
                            });
                        }
                        break;
                    }
                    default:
                        throw new n8n_workflow_1.ApplicationError(`Unsupported operation: ${operation}`);
                }
            }
            catch (executionError) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: {
                            ...loopItems[itemIndex].json,
                            error: executionError.message,
                        },
                        pairedItem: itemIndex,
                    });
                    continue;
                }
                throw new n8n_workflow_1.NodeOperationError(this.getNode(), executionError, { itemIndex });
            }
        }
        return [returnData];
    }
}
exports.SqliteManager = SqliteManager;
//# sourceMappingURL=SqliteManager.node.js.map