import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { ApplicationError, NodeOperationError } from 'n8n-workflow';
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const DEFAULT_BASE_DIR = '/opt/sqlite-db';
const ALLOWED_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3']);
const SQLITE_VEC_LIBRARY_PATH = process.env.SQLITE_VEC_LIBRARY || '/usr/local/lib/sqlite-extensions/vec0.so';
const SQLITE_VEC_ENTRYPOINT = process.env.SQLITE_VEC_ENTRYPOINT || 'sqlite3_vec_init';

type Operation = 'listDatabases' | 'createDatabase' | 'deleteDatabase' | 'executeQuery';

type SqliteCommandResult = {
	stdout: string;
	stderr: string;
};

async function ensureBaseDir(directory: string) {
	await fs.mkdir(directory, { recursive: true });
}

function resolveBaseDir(): string {
	return process.env.SQLITE_BASE_DIR || DEFAULT_BASE_DIR;
}

function normalizeDatabaseName(rawName: string): string {
	const trimmed = rawName.trim();
	if (!trimmed) {
		throw new ApplicationError('Database name is required');
	}

	if (/[\\/]/.test(trimmed) || trimmed.includes('..')) {
		throw new ApplicationError('Database name cannot contain path separators or ".." segments');
	}

	const extension = path.extname(trimmed);
	if (extension && !ALLOWED_EXTENSIONS.has(extension.toLowerCase())) {
		throw new ApplicationError('Unsupported database extension. Use .db, .sqlite, or .sqlite3');
	}

	const base = extension ? trimmed : `${trimmed}.db`;

	if (!/^[\w.-]+$/.test(base)) {
		throw new ApplicationError('Database name may only contain letters, numbers, underscores, hyphens, and dots');
	}

	return base;
}

async function safeResolveDatabasePath(baseDir: string, dbName: string): Promise<string> {
	const normalizedName = normalizeDatabaseName(dbName);
	const resolvedBase = path.resolve(baseDir);
	const absolutePath = path.resolve(baseDir, normalizedName);

	if (!absolutePath.startsWith(resolvedBase + path.sep) && absolutePath !== resolvedBase) {
		throw new ApplicationError('Resolved database path is outside the configured base directory');
	}

	return absolutePath;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function runSqliteCommand(args: string[], sql?: string, options?: { loadVec?: boolean }): Promise<SqliteCommandResult> {
	const finalArgs = [...args];
	if (options?.loadVec && SQLITE_VEC_LIBRARY_PATH) {
		finalArgs.unshift('-cmd', `.load ${SQLITE_VEC_LIBRARY_PATH} ${SQLITE_VEC_ENTRYPOINT}`);
	}

	return await new Promise((resolve, reject) => {
		const child = spawn('sqlite3', finalArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

		let stdout = '';
		let stderr = '';

		if (sql) {
			if (!child.stdin) {
				reject(new ApplicationError('sqlite3 stdin stream is not available'));
				return;
			}

			child.stdin.setDefaultEncoding('utf-8');
			child.stdin.write(sql);
			if (!sql.endsWith('\n')) {
				child.stdin.write('\n');
			}
		}
		child.stdin?.end();

		child.stdout.on('data', (data: Buffer) => {
			stdout += data.toString();
		});

		child.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		child.on('error', (error: Error) => {
			reject(new ApplicationError(error.message));
		});

		child.on('close', (code: number | null) => {
			if (code !== 0) {
				const message = stderr || `sqlite3 exited with code ${code ?? 'null'}`;
				const error = new ApplicationError(message) as ApplicationError & { details?: IDataObject };
				error.details = { stderr };
				reject(error);
				return;
			}

			resolve({ stdout, stderr });
		});
	});
}

export class SqliteManager implements INodeType {
	description: INodeTypeDescription = {
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const loopItems = items.length > 0 ? items : [{ json: {} } as INodeExecutionData];
		const baseDir = resolveBaseDir();

		await ensureBaseDir(baseDir);

		for (let itemIndex = 0; itemIndex < loopItems.length; itemIndex++) {
			const operation = this.getNodeParameter('operation', itemIndex) as Operation;

			try {
				if (operation === 'listDatabases') {
					const entries = await fs.readdir(baseDir, { withFileTypes: true });
					for (const entry of entries) {
						if (!entry.isFile()) continue;
						const extension = path.extname(entry.name).toLowerCase();
						if (!ALLOWED_EXTENSIONS.has(extension)) continue;
						const fullPath = path.join(baseDir, entry.name);
						const stats = await fs.stat(fullPath);

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

				const databaseName = this.getNodeParameter('databaseName', itemIndex, '') as string;
				const dbPath = await safeResolveDatabasePath(baseDir, databaseName);

				switch (operation) {
					case 'createDatabase': {
						const overwrite = this.getNodeParameter('overwrite', itemIndex, false) as boolean;
						const initialSql = this.getNodeParameter('initialSql', itemIndex, '') as string;
						const exists = await fileExists(dbPath);

						if (exists && !overwrite) {
							throw new ApplicationError('Database already exists. Enable "Overwrite If Exists" to replace it.');
						}

						if (exists && overwrite) {
							await fs.truncate(dbPath, 0);
						} else {
							const handle = await fs.open(dbPath, 'w');
							await handle.close();
						}

						if (initialSql.trim()) {
							await runSqliteCommand([dbPath], `${initialSql}\n`);
						}

						returnData.push({
							json: {
								...loopItems[itemIndex].json,
								database: path.basename(dbPath),
								created: !exists || overwrite,
								overwritten: exists && overwrite,
								path: dbPath,
							},
						});
						break;
					}
					case 'deleteDatabase': {
						const ignoreMissing = this.getNodeParameter('ignoreMissing', itemIndex, false) as boolean;
						const exists = await fileExists(dbPath);

						if (!exists) {
							if (ignoreMissing) {
								returnData.push({
									json: {
										...loopItems[itemIndex].json,
										database: path.basename(dbPath),
										deleted: false,
										path: dbPath,
									},
								});
								break;
							}
							throw new ApplicationError('Database does not exist');
						}

						await fs.unlink(dbPath);
						returnData.push({
							json: {
								...loopItems[itemIndex].json,
								database: path.basename(dbPath),
								deleted: true,
								path: dbPath,
							},
						});
						break;
					}
					case 'executeQuery': {
						const sql = this.getNodeParameter('sql', itemIndex, '') as string;
						const returnDataFlag = this.getNodeParameter('returnData', itemIndex, true) as boolean;
						const failOnEmpty = this.getNodeParameter('failOnEmpty', itemIndex, false) as boolean;

						if (!(await fileExists(dbPath))) {
							throw new ApplicationError('Database does not exist');
						}

						const args = returnDataFlag ? ['-json', dbPath] : [dbPath];
						const { stdout } = await runSqliteCommand(args, sql, { loadVec: true });

						if (returnDataFlag) {
							const trimmed = stdout.trim();
							if (!trimmed) {
								if (failOnEmpty) {
									throw new ApplicationError('Query returned no rows');
								}

								returnData.push({
									json: {
										...loopItems[itemIndex].json,
										rows: 0,
										database: path.basename(dbPath),
										path: dbPath,
									},
								});
								break;
							}

							let parsed: IDataObject[];
							try {
								const data = JSON.parse(trimmed);
								parsed = Array.isArray(data) ? (data as IDataObject[]) : [data as IDataObject];
							} catch (parseError) {
								const message = (parseError as Error).message || 'unknown error';
								throw new ApplicationError(`Failed to parse SQLite JSON response: ${message}`);
							}

							for (const row of parsed) {
								returnData.push({ json: { ...loopItems[itemIndex].json, ...row } });
							}
						} else {
							const message = stdout.trim() || 'OK';
							returnData.push({
								json: {
									...loopItems[itemIndex].json,
									database: path.basename(dbPath),
									path: dbPath,
									sql,
									result: message,
								},
							});
						}
						break;
					}
					default:
						throw new ApplicationError(`Unsupported operation: ${operation}`);
				}
			} catch (executionError) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							...loopItems[itemIndex].json,
							error: (executionError as Error).message,
						},
						pairedItem: itemIndex,
					});
					continue;
				}

				throw new NodeOperationError(this.getNode(), executionError as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
