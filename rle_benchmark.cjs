const duckdb = require('duckdb');

const db = new duckdb.Database(':memory:');

// Create a 32x32x64 chunk of voxels (typical Minecraft-style chunk)
// With realistic terrain: mostly air at top, stone at bottom, varied in middle
console.log('Creating 32×32×64 chunk (65,536 voxels)...');

db.run(`
    CREATE TABLE voxels AS
    SELECT 
        (i % 32)::TINYINT as x,
        ((i / 32) % 32)::TINYINT as y,
        ((i / 1024))::TINYINT as z,
        CASE 
            WHEN (i / 1024) > 48 THEN 0  -- air
            WHEN (i / 1024) < 16 THEN 1  -- stone
            WHEN (i / 1024) < 32 THEN 2  -- dirt
            ELSE (abs(hash(i)) % 4)::TINYINT  -- mixed
        END as block_type
    FROM generate_series(0, 32*32*64 - 1) t(i)
`, (err) => {
    if (err) throw err;
    
    console.log('\n--- Benchmarks (10 runs each) ---\n');
    
    // Benchmark 1: Raw select (baseline)
    benchmark('Raw SELECT *', 
        `SELECT * FROM voxels WHERE x BETWEEN 0 AND 31 AND y BETWEEN 0 AND 31`);
});

function benchmark(name, sql) {
    const times = [];
    let rowCount = 0;
    
    function run(i) {
        if (i >= 10) {
            const avg = times.reduce((a,b) => a+b, 0) / times.length;
            const min = Math.min(...times);
            const max = Math.max(...times);
            console.log(`${name.padEnd(40)}: avg=${avg.toFixed(2)}ms, min=${min.toFixed(2)}ms, max=${max.toFixed(2)}ms (${rowCount} rows)`);
            nextBenchmark();
            return;
        }
        
        const start = performance.now();
        db.all(sql, (err, rows) => {
            times.push(performance.now() - start);
            rowCount = rows.length;
            run(i + 1);
        });
    }
    run(0);
}

const benchmarks = [
    ['Raw SELECT *', `SELECT * FROM voxels`],
    
    ['Window RLE (your skepticism)', `
        SELECT x, y, z as z_start, block_type,
            LEAD(z, 1, z+1) OVER (PARTITION BY x, y, block_type ORDER BY z) - z as run_len
        FROM voxels
    `],
    
    ['GROUP BY RLE (gaps-and-islands)', `
        SELECT x, y, MIN(z) as z_start, MAX(z) as z_end, block_type
        FROM (
            SELECT x, y, z, block_type,
                z - ROW_NUMBER() OVER (PARTITION BY x, y, block_type ORDER BY z) as grp
            FROM voxels
        ) sub
        GROUP BY x, y, block_type, grp
    `],
    
    ['Simple COUNT per column', `
        SELECT x, y, block_type, COUNT(*) as cnt
        FROM voxels 
        GROUP BY x, y, block_type
    `],
];

let benchIdx = 0;
function nextBenchmark() {
    if (benchIdx >= benchmarks.length) {
        db.close();
        return;
    }
    const [name, sql] = benchmarks[benchIdx++];
    benchmark(name, sql);
}
