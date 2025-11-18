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

type Operation = 'listDatabases' | 'createDatabase' | 'deleteDatabase' | 'executeQuery' | 'batchInsertVectors' | 'vectorSearch';

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
					{
						action: 'Batch insert vectors',
						name: 'Batch Insert Vectors',
						value: 'batchInsertVectors',
						description: 'Insert multiple vectors efficiently in a single batch',
					},
					{
						action: 'Vector search',
						name: 'Vector Search',
						value: 'vectorSearch',
						description: 'Search for similar vectors using KNN',
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
						operation: ['createDatabase', 'deleteDatabase', 'executeQuery', 'batchInsertVectors', 'vectorSearch'],
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
			// Batch Insert Vectors parameters
			{
				displayName: 'Table Name',
				name: 'tableName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'embeddings',
				description: 'Name of the vec0 virtual table to insert vectors into',
				displayOptions: {
					show: {
						operation: ['batchInsertVectors'],
					},
				},
			},
			{
				displayName: 'Vector Field',
				name: 'vectorField',
				type: 'string',
				default: 'embedding',
				required: true,
				description: 'Name of the column that stores vector embeddings',
				displayOptions: {
					show: {
						operation: ['batchInsertVectors'],
					},
				},
			},
			{
				displayName: 'ID Field',
				name: 'idField',
				type: 'string',
				default: 'id',
				description: 'Name of the ID column (optional, leave empty for auto-increment)',
				displayOptions: {
					show: {
						operation: ['batchInsertVectors'],
					},
				},
			},
			{
				displayName: 'Metadata Fields',
				name: 'metadataFields',
				type: 'string',
				default: '',
				placeholder: 'text,source,category',
				description: 'Comma-separated list of additional fields to extract from input items',
				displayOptions: {
					show: {
						operation: ['batchInsertVectors'],
					},
				},
			},
			{
				displayName: 'Batch Size',
				name: 'batchSize',
				type: 'number',
				default: 500,
				description: 'Number of vectors to insert per SQL statement (max 1000)',
				displayOptions: {
					show: {
						operation: ['batchInsertVectors'],
					},
				},
			},
			// Vector Search parameters
			{
				displayName: 'Table Name',
				name: 'searchTableName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'embeddings',
				description: 'Name of the vec0 virtual table to search',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
					},
				},
			},
			{
				displayName: 'Vector Field',
				name: 'searchVectorField',
				type: 'string',
				default: 'embedding',
				required: true,
				description: 'Name of the column that stores vector embeddings',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
					},
				},
			},
			{
				displayName: 'Query Vector',
				name: 'queryVector',
				type: 'string',
				default: '',
				required: true,
				placeholder: '[0.1, 0.2, 0.3, ...]',
				description: 'The vector to search for (as JSON array or reference to input field)',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
					},
				},
				noDataExpression: false,
			},
			{
				displayName: 'K (Results)',
				name: 'k',
				type: 'number',
				default: 10,
				required: true,
				description: 'Number of nearest neighbors to return',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
					},
				},
			},
			{
				displayName: 'Distance Metric',
				name: 'distanceMetric',
				type: 'options',
				options: [
					{
						name: 'Cosine',
						value: 'cosine',
						description: 'Cosine similarity (default for most embeddings)',
					},
					{
						name: 'L2 (Euclidean)',
						value: 'l2',
						description: 'Euclidean distance',
					},
					{
						name: 'Inner Product',
						value: 'inner_product',
						description: 'Dot product similarity',
					},
				],
				default: 'cosine',
				description: 'Distance metric to use for similarity comparison',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
					},
				},
			},
			{
				displayName: 'Additional Filters',
				name: 'additionalFilters',
				type: 'string',
				default: '',
				placeholder: 'category = "tech" AND published = 1',
				description: 'Additional WHERE conditions to filter results (optional)',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
					},
				},
				noDataExpression: false,
			},
			{
				displayName: 'Select Fields',
				name: 'selectFields',
				type: 'string',
				default: '*',
				placeholder: 'id, text, distance',
				description: 'Comma-separated list of fields to return',
				displayOptions: {
					show: {
						operation: ['vectorSearch'],
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
					case 'batchInsertVectors': {
						const tableName = this.getNodeParameter('tableName', itemIndex, '') as string;
						const vectorField = this.getNodeParameter('vectorField', itemIndex, 'embedding') as string;
						const idField = this.getNodeParameter('idField', itemIndex, 'id') as string;
						const metadataFieldsStr = this.getNodeParameter('metadataFields', itemIndex, '') as string;
						const batchSize = Math.min(this.getNodeParameter('batchSize', itemIndex, 500) as number, 1000);

						if (!(await fileExists(dbPath))) {
							throw new ApplicationError('Database does not exist');
						}

						const metadataFields = metadataFieldsStr
							.split(',')
							.map((f) => f.trim())
							.filter((f) => f.length > 0);

						// Collect all vectors from input items
						const vectors: Array<{ id?: any; vector: number[]; metadata: IDataObject }> = [];

						for (const item of loopItems) {
							const vector = item.json[vectorField];
							if (!vector) {
								continue; // Skip items without vector
							}

							let vectorArray: number[];
							if (Array.isArray(vector)) {
								vectorArray = vector as number[];
							} else if (typeof vector === 'string') {
								try {
									vectorArray = JSON.parse(vector);
								} catch {
									throw new ApplicationError(`Invalid vector format for field "${vectorField}"`);
								}
							} else {
								throw new ApplicationError(`Vector field "${vectorField}" must be an array or JSON string`);
							}

							const metadata: IDataObject = {};
							for (const field of metadataFields) {
								if (item.json[field] !== undefined) {
									metadata[field] = item.json[field];
								}
							}

							const id = idField && item.json[idField] !== undefined ? item.json[idField] : undefined;

							vectors.push({ id, vector: vectorArray, metadata });
						}

						if (vectors.length === 0) {
							returnData.push({
								json: {
									database: path.basename(dbPath),
									path: dbPath,
									inserted: 0,
									message: 'No vectors found to insert',
								},
							});
							break;
						}

						// Insert in batches
						let totalInserted = 0;
						for (let i = 0; i < vectors.length; i += batchSize) {
							const batch = vectors.slice(i, Math.min(i + batchSize, vectors.length));

							// Build column list
							const columns = [vectorField];
							if (idField && batch[0].id !== undefined) {
								columns.unshift(idField);
							}
							for (const field of metadataFields) {
								if (batch[0].metadata[field] !== undefined) {
									columns.push(field);
								}
							}

							// Build VALUES clauses
							const values = batch.map((v) => {
								const vals: string[] = [];
								if (idField && v.id !== undefined) {
									vals.push(typeof v.id === 'string' ? `'${v.id.replace(/'/g, "''")}'` : String(v.id));
								}
								vals.push(`json_array(${v.vector.join(', ')})`);
								for (const field of metadataFields) {
									if (v.metadata[field] !== undefined) {
										const val = v.metadata[field];
										vals.push(typeof val === 'string' ? `'${String(val).replace(/'/g, "''")}'` : String(val));
									}
								}
								return `(${vals.join(', ')})`;
							});

							const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${values.join(', ')};`;

							await runSqliteCommand([dbPath], sql, { loadVec: true });
							totalInserted += batch.length;
						}

						returnData.push({
							json: {
								...loopItems[itemIndex].json,
								database: path.basename(dbPath),
								path: dbPath,
								table: tableName,
								inserted: totalInserted,
								batches: Math.ceil(vectors.length / batchSize),
							},
						});
						break;
					}
					case 'vectorSearch': {
						const searchTableName = this.getNodeParameter('searchTableName', itemIndex, '') as string;
						const searchVectorField = this.getNodeParameter('searchVectorField', itemIndex, 'embedding') as string;
						const queryVectorStr = this.getNodeParameter('queryVector', itemIndex, '') as string;
						const k = this.getNodeParameter('k', itemIndex, 10) as number;
						// Note: distanceMetric parameter exists in UI for user reference/future use
						// Currently sqlite-vec's MATCH uses the metric defined during table creation
						const additionalFilters = this.getNodeParameter('additionalFilters', itemIndex, '') as string;
						const selectFields = this.getNodeParameter('selectFields', itemIndex, '*') as string;

						if (!(await fileExists(dbPath))) {
							throw new ApplicationError('Database does not exist');
						}

						// Parse query vector
						let queryVector: number[];
						try {
							if (queryVectorStr.trim().startsWith('[')) {
								queryVector = JSON.parse(queryVectorStr);
							} else {
								// Try to get from input item
								const vectorValue = loopItems[itemIndex].json[queryVectorStr];
								if (Array.isArray(vectorValue)) {
									queryVector = vectorValue as number[];
								} else if (typeof vectorValue === 'string') {
									queryVector = JSON.parse(vectorValue);
								} else {
									throw new Error('Query vector not found or invalid format');
								}
							}
						} catch (parseError) {
							throw new ApplicationError(`Failed to parse query vector: ${(parseError as Error).message}`);
						}

						// Build SQL query
						const vectorJson = `json_array(${queryVector.join(', ')})`;

						// Distance metric mapping (sqlite-vec uses distance_ops pragma)
						let whereClause = `${searchVectorField} MATCH ${vectorJson} AND k = ${k}`;
						if (additionalFilters.trim()) {
							whereClause += ` AND (${additionalFilters.trim()})`;
						}

						const sql = `SELECT ${selectFields}, distance FROM ${searchTableName} WHERE ${whereClause} ORDER BY distance;`;

						const { stdout } = await runSqliteCommand(['-json', dbPath], sql, { loadVec: true });

						const trimmed = stdout.trim();
						if (!trimmed) {
							returnData.push({
								json: {
									...loopItems[itemIndex].json,
									results: 0,
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
