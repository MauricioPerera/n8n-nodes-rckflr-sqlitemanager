const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sqliteExecutable = 'sqlite3';
const sqliteVecLibrary = process.env.SQLITE_VEC_LIBRARY || '/usr/local/lib/sqlite-extensions/vec0';
const sqliteVecEntrypoint = process.env.SQLITE_VEC_ENTRYPOINT || 'sqlite3_vec_init';
const tmpDbPath = path.join(os.tmpdir(), `benchmark-${Date.now()}.sqlite`);

function measureTime(label, fn) {
	const start = process.hrtime.bigint();
	const result = fn();
	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1_000_000; // Convert to milliseconds
	return { result, duration, label };
}

function runSqlite(sql, loadVec = false) {
	const args = loadVec
		? ['-cmd', `.load ${sqliteVecLibrary} ${sqliteVecEntrypoint}`, tmpDbPath]
		: [tmpDbPath];

	const result = spawnSync(sqliteExecutable, args, {
		input: sql,
		encoding: 'utf8',
	});

	if (result.status !== 0) {
		throw new Error(result.stderr || `sqlite3 exited with code ${result.status}`);
	}

	return result.stdout.trim();
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

function generateVector(dimensions) {
	return Array.from({ length: dimensions }, () => Math.random());
}

(async () => {
	console.log('🚀 SQLite Manager Benchmark\n');
	console.log('Testing CLI spawn overhead and vector operations performance\n');

	const results = [];

	try {
		// Benchmark 1: SQLite spawn without extension
		const bench1 = measureTime('SQLite spawn (no extension)', () => {
			return runSqlite('SELECT 1;', false);
		});
		results.push(bench1);
		console.log(`✓ ${bench1.label}: ${bench1.duration.toFixed(2)}ms`);

		// Benchmark 2: SQLite spawn with sqlite-vec extension
		const bench2 = measureTime('SQLite spawn (with sqlite-vec)', () => {
			return runSqlite('SELECT 1;', true);
		});
		results.push(bench2);
		console.log(`✓ ${bench2.label}: ${bench2.duration.toFixed(2)}ms`);

		// Benchmark 3: Create vec0 table
		const bench3 = measureTime('Create vec0 table (384 dims)', () => {
			return runSqlite(
				`
				CREATE VIRTUAL TABLE embeddings USING vec0(
					id INTEGER PRIMARY KEY,
					embedding FLOAT[384],
					text TEXT
				);
			`,
				true,
			);
		});
		results.push(bench3);
		console.log(`✓ ${bench3.label}: ${bench3.duration.toFixed(2)}ms`);

		// Benchmark 4: Single vector insert
		const vector = generateVector(384);
		const bench4 = measureTime('Single vector insert', () => {
			return runSqlite(
				`INSERT INTO embeddings (embedding, text) VALUES (json_array(${vector.join(', ')}), 'test');`,
				true,
			);
		});
		results.push(bench4);
		console.log(`✓ ${bench4.label}: ${bench4.duration.toFixed(2)}ms`);

		// Benchmark 5: Batch insert (100 vectors)
		const vectors = Array.from({ length: 100 }, (_, i) => ({
			vector: generateVector(384),
			text: `doc_${i}`,
		}));

		const batchValues = vectors
			.map((v) => `(json_array(${v.vector.join(', ')}), '${v.text}')`)
			.join(', ');

		const bench5 = measureTime('Batch insert (100 vectors)', () => {
			return runSqlite(
				`INSERT INTO embeddings (embedding, text) VALUES ${batchValues};`,
				true,
			);
		});
		results.push(bench5);
		console.log(`✓ ${bench5.label}: ${bench5.duration.toFixed(2)}ms`);

		// Benchmark 6: Vector search (KNN k=10)
		const queryVector = generateVector(384);
		const bench6 = measureTime('Vector search (k=10)', () => {
			return runSqlite(
				`SELECT text, distance FROM embeddings WHERE embedding MATCH json_array(${queryVector.join(', ')}) AND k = 10 ORDER BY distance;`,
				true,
			);
		});
		results.push(bench6);
		console.log(`✓ ${bench6.label}: ${bench6.duration.toFixed(2)}ms`);

		// Benchmark 7: Multiple spawns overhead (10 sequential spawns)
		const bench7 = measureTime('10 sequential spawns', () => {
			for (let i = 0; i < 10; i++) {
				runSqlite('SELECT 1;', true);
			}
		});
		results.push(bench7);
		console.log(`✓ ${bench7.label}: ${bench7.duration.toFixed(2)}ms`);

		// Summary
		console.log('\n📊 Summary:');
		console.log('─'.repeat(60));

		const spawnOverhead = bench2.duration - bench1.duration;
		console.log(`Extension loading overhead: ${spawnOverhead.toFixed(2)}ms`);

		const perSpawnCost = bench7.duration / 10;
		console.log(`Average spawn cost: ${perSpawnCost.toFixed(2)}ms`);

		const perVectorInsert = bench5.duration / 100;
		console.log(`Per-vector insert (batched): ${perVectorInsert.toFixed(2)}ms`);

		const speedup = bench4.duration / perVectorInsert;
		console.log(`Batch speedup: ${speedup.toFixed(1)}x faster`);

		console.log('\n💡 Recommendations:');
		if (perSpawnCost > 50) {
			console.log(
				`⚠️  Spawn cost is ${perSpawnCost.toFixed(2)}ms - Connection pooling HIGHLY recommended`,
			);
		} else if (perSpawnCost > 20) {
			console.log(
				`⚡ Spawn cost is ${perSpawnCost.toFixed(2)}ms - Connection pooling would improve performance`,
			);
		} else {
			console.log(
				`✓ Spawn cost is ${perSpawnCost.toFixed(2)}ms - Current approach is acceptable`,
			);
		}

		if (bench5.duration > 1000) {
			console.log('⚠️  Large batch inserts are slow - Consider transaction optimization');
		}

		cleanup();
		process.exit(0);
	} catch (error) {
		cleanup();
		console.error('✗ Benchmark failed');
		console.error(error.message);
		process.exit(1);
	}
})();
