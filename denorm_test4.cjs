const duckdb = require('duckdb');
const fs = require('fs');
const path = require('path');

const db = new duckdb.Database(':memory:');
const outDir = path.join(process.cwd(), 'test_output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

console.log('Creating 67M tile table...');
let start = performance.now();

db.run(`
    CREATE TABLE tiles AS
    SELECT 
        (i % 8192)::SMALLINT as x,
        ((i / 8192) % 8192)::SMALLINT as y,
        0::TINYINT as z,
        (abs(hash(i)) % 16)::TINYINT as tile_type
    FROM generate_series(0, 8192*8192 - 1) t(i)
`, (err) => {
    if (err) throw err;
    console.log(`Created in ${(performance.now() - start).toFixed(0)}ms\n`);
    
    // Check what formats are available
    console.log('Testing Arrow IPC export formats...\n');
    
    const tests = [
        // Arrow IPC variants
        ["arrow_ipc_unc_128", "COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO 'test_output/v128.arrow' (FORMAT 'arrow')"],
        ["arrow_ipc_lz4_128", "COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO 'test_output/v128_lz4.arrow' WITH (FORMAT 'arrow', COMPRESSION 'lz4')"],
        ["arrow_ipc_zstd_128", "COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO 'test_output/v128_zstd.arrow' WITH (FORMAT 'arrow', COMPRESSION 'zstd')"],
        
        // 1M tiles
        ["arrow_ipc_unc_1k", "COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO 'test_output/c1k.arrow' (FORMAT 'arrow')"],
        ["arrow_ipc_lz4_1k", "COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO 'test_output/c1k_lz4.arrow' WITH (FORMAT 'arrow', COMPRESSION 'lz4')"],
        ["arrow_ipc_zstd_1k", "COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO 'test_output/c1k_zstd.arrow' WITH (FORMAT 'arrow', COMPRESSION 'zstd')"],
    ];
    
    function runTest(idx) {
        if (idx >= tests.length) {
            printResults();
            return;
        }
        const [name, sql] = tests[idx];
        start = performance.now();
        db.run(sql, (err) => {
            if (err) {
                console.log(`${name}: FAILED - ${err.message}`);
            } else {
                console.log(`${name}: ${(performance.now() - start).toFixed(1)}ms`);
            }
            runTest(idx + 1);
        });
    }
    
    function printResults() {
        console.log('\n--- File Sizes ---');
        const files = fs.readdirSync(outDir).filter(f => f.endsWith('.arrow') || f.endsWith('.parquet'));
        for (const f of files.sort()) {
            const stat = fs.statSync(path.join(outDir, f));
            console.log(`${f}: ${(stat.size/1024).toFixed(1)} KB`);
        }
        
        console.log('\n--- Comparison (128×128 = 16K tiles) ---');
        console.log('Naive (6 bytes/tile):     98 KB');
        try { console.log(`Arrow uncompressed:       ${(fs.statSync('test_output/v128.arrow').size/1024).toFixed(1)} KB`); } catch(e) {}
        try { console.log(`Arrow LZ4:                ${(fs.statSync('test_output/v128_lz4.arrow').size/1024).toFixed(1)} KB`); } catch(e) {}
        try { console.log(`Arrow ZSTD:               ${(fs.statSync('test_output/v128_zstd.arrow').size/1024).toFixed(1)} KB`); } catch(e) {}
        try { console.log(`Parquet ZSTD:             ${(fs.statSync('test_output/viewport128.parquet').size/1024).toFixed(1)} KB`); } catch(e) {}
        
        console.log('\n--- Comparison (1024×1024 = 1M tiles) ---');
        console.log('Naive (6 bytes/tile):     6,291 KB');
        try { console.log(`Arrow uncompressed:       ${(fs.statSync('test_output/c1k.arrow').size/1024).toFixed(1)} KB`); } catch(e) {}
        try { console.log(`Arrow LZ4:                ${(fs.statSync('test_output/c1k_lz4.arrow').size/1024).toFixed(1)} KB`); } catch(e) {}
        try { console.log(`Arrow ZSTD:               ${(fs.statSync('test_output/c1k_zstd.arrow').size/1024).toFixed(1)} KB`); } catch(e) {}
        try { console.log(`Parquet ZSTD:             ${(fs.statSync('test_output/chunk1k.parquet').size/1024).toFixed(1)} KB`); } catch(e) {}
        
        db.close();
    }
    
    runTest(0);
});
