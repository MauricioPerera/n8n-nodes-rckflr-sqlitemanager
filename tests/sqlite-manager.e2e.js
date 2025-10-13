const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteExecutable = 'sqlite3';
const sqliteVecLibrary = process.env.SQLITE_VEC_LIBRARY || '/usr/local/lib/sqlite-extensions/vec0';
const sqliteVecEntrypoint = process.env.SQLITE_VEC_ENTRYPOINT || 'sqlite3_vec_init';
const tmpDbPath = path.join(os.tmpdir(), `sqlite-manager-e2e-${Date.now()}.sqlite`);

function runSqlite(sql) {
	const args = ['-cmd', `.load ${sqliteVecLibrary} ${sqliteVecEntrypoint}`, tmpDbPath];
	const result = spawnSync(sqliteExecutable, args, {
		input: sql,
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		throw new Error(result.stderr || `sqlite3 exited with code ${result.status}`);
	}

	return result.stdout.trim();
}

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function cleanup() {
	try {
		fs.unlinkSync(tmpDbPath);
	} catch (error) {
		if (error.code !== 'ENOENT') {
			console.warn(`Failed to clean up ${tmpDbPath}: ${error.message}`);
		}
	}
}

(async () => {
	try {
		const versionResult = spawnSync(sqliteExecutable, ['-version'], { encoding: 'utf8' });
		assert(versionResult.status === 0, `sqlite3 CLI not found in PATH. stderr: ${versionResult.stderr}`);

		runSqlite(
			`
			CREATE VIRTUAL TABLE vec_test USING vec0(
				id INTEGER PRIMARY KEY,
				embedding FLOAT[3],
				label TEXT
			);

		INSERT INTO vec_test (id, embedding, label)
		VALUES
			(1, json_array(0.10, 0.20, 0.30), 'alpha'),
			(2, json_array(0.90, 0.10, 0.00), 'beta'),
			(3, json_array(0.05, 0.18, 0.28), 'gamma');
		`
		);

	const { stdout, status, stderr } = spawnSync(
		sqliteExecutable,
		['-cmd', `.load ${sqliteVecLibrary} ${sqliteVecEntrypoint}`, '-json', tmpDbPath],
		{
			input: `
			SELECT label, distance
			FROM vec_test
			WHERE embedding MATCH json_array(0.05, 0.18, 0.28)
			  AND k = 1;
		`,
				encoding: 'utf8',
			}
		);

		assert(status === 0, `Vector query failed: ${stderr}`);

		const rows = JSON.parse(stdout || '[]');
	assert(rows.length === 1, 'Expected exactly one nearest neighbour');
	assert(rows[0].label === 'gamma', `Expected closest label to be "gamma", received "${rows[0].label}"`);
	assert(Math.abs(rows[0].distance) < 1e-6, `Expected zero distance for exact match, received ${rows[0].distance}`);

		console.log('✓ sqlite-vec integration test passed');
		cleanup();
		process.exit(0);
	} catch (error) {
		cleanup();
		console.error('✗ sqlite-vec integration test failed');
		console.error(error.message);
		process.exit(1);
	}
})();
