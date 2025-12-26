const duckdb = require('duckdb');
const { execSync } = require('child_process');

const db = new duckdb.Database(':memory:');

console.log('Creating 67M tile table (8192×8192×1)...');
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
    console.log(`Created in ${(performance.now() - start).toFixed(0)}ms`);
    
    // Run all tests
    runTests(db);
});

function runTests(db) {
    // Test 1: Full scan
    start = performance.now();
    db.all("SELECT count(*) as count FROM tiles", (err, rows) => {
        console.log(`Full scan count=${rows[0].count}: ${(performance.now() - start).toFixed(1)}ms`);
        
        // Test 2: 128×128 viewport
        start = performance.now();
        db.all("SELECT count(*) as count FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127", (err, rows) => {
            console.log(`128×128 viewport (${rows[0].count} tiles): ${(performance.now() - start).toFixed(1)}ms`);
            
            // Test 3: 1024×1024 range
            start = performance.now();
            db.all("SELECT count(*) as count FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023", (err, rows) => {
                console.log(`1024×1024 range (${rows[0].count} tiles): ${(performance.now() - start).toFixed(1)}ms`);
                
                // Test 4: Arrow export
                start = performance.now();
                db.run("COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO '/tmp/viewport.arrow' (FORMAT 'arrow')", (err) => {
                    console.log(`Arrow export 128×128: ${(performance.now() - start).toFixed(1)}ms`);
                    
                    start = performance.now();
                    db.run("COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO '/tmp/chunk1k.arrow' (FORMAT 'arrow')", (err) => {
                        console.log(`Arrow export 1024×1024: ${(performance.now() - start).toFixed(1)}ms`);
                        
                        // Test 5: Parquet export
                        start = performance.now();
                        db.run("COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO '/tmp/viewport.parquet' (FORMAT 'parquet', COMPRESSION 'zstd')", (err) => {
                            console.log(`Parquet+zstd 128×128: ${(performance.now() - start).toFixed(1)}ms`);
                            
                            start = performance.now();
                            db.run("COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO '/tmp/chunk1k.parquet' (FORMAT 'parquet', COMPRESSION 'zstd')", (err) => {
                                console.log(`Parquet+zstd 1024×1024: ${(performance.now() - start).toFixed(1)}ms`);
                                
                                // File sizes
                                console.log('\n--- File Sizes ---');
                                console.log(execSync('ls -lh /tmp/viewport.arrow /tmp/chunk1k.arrow /tmp/viewport.parquet /tmp/chunk1k.parquet').toString());
                                
                                console.log('--- Analysis ---');
                                console.log('128×128 viewport = 16,384 tiles × 6 bytes = 98KB naive');
                                console.log('1024×1024 chunk = 1,048,576 tiles × 6 bytes = 6.3MB naive');
                                
                                db.close();
                            });
                        });
                    });
                });
            });
        });
    });
}
