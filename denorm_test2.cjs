const duckdb = require('duckdb');
const fs = require('fs');
const path = require('path');

const db = new duckdb.Database(':memory:');
const outDir = path.join(process.cwd(), 'test_output');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

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
    runTests(db, outDir);
});

function runTests(db, outDir) {
    start = performance.now();
    db.all("SELECT count(*) as count FROM tiles", (err, rows) => {
        console.log(`Full scan 67M rows: ${(performance.now() - start).toFixed(1)}ms`);
        
        start = performance.now();
        db.all("SELECT count(*) as count FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127", (err, rows) => {
            console.log(`128×128 query (${rows[0].count} tiles): ${(performance.now() - start).toFixed(1)}ms`);
            
            start = performance.now();
            db.all("SELECT count(*) as count FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023", (err, rows) => {
                console.log(`1024×1024 query (${rows[0].count} tiles): ${(performance.now() - start).toFixed(1)}ms`);
                
                // Arrow IPC export
                const arrowPath128 = path.join(outDir, 'viewport128.arrow');
                const arrowPath1k = path.join(outDir, 'chunk1k.arrow');
                const parquetPath128 = path.join(outDir, 'viewport128.parquet');
                const parquetPath1k = path.join(outDir, 'chunk1k.parquet');
                
                start = performance.now();
                db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO '${arrowPath128}' (FORMAT 'arrow')`, (err) => {
                    if (err) console.log('Arrow export error:', err);
                    console.log(`Arrow IPC 128×128: ${(performance.now() - start).toFixed(1)}ms`);
                    
                    start = performance.now();
                    db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO '${arrowPath1k}' (FORMAT 'arrow')`, (err) => {
                        if (err) console.log('Arrow export error:', err);
                        console.log(`Arrow IPC 1024×1024: ${(performance.now() - start).toFixed(1)}ms`);
                        
                        start = performance.now();
                        db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO '${parquetPath128}' (FORMAT 'parquet', COMPRESSION 'zstd')`, (err) => {
                            console.log(`Parquet+zstd 128×128: ${(performance.now() - start).toFixed(1)}ms`);
                            
                            start = performance.now();
                            db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO '${parquetPath1k}' (FORMAT 'parquet', COMPRESSION 'zstd')`, (err) => {
                                console.log(`Parquet+zstd 1024×1024: ${(performance.now() - start).toFixed(1)}ms`);
                                
                                // Print file sizes
                                console.log('\n--- File Sizes ---');
                                for (const f of [arrowPath128, arrowPath1k, parquetPath128, parquetPath1k]) {
                                    try {
                                        const stat = fs.statSync(f);
                                        console.log(`${path.basename(f)}: ${(stat.size/1024).toFixed(1)} KB`);
                                    } catch(e) {
                                        console.log(`${path.basename(f)}: NOT FOUND`);
                                    }
                                }
                                
                                console.log('\n--- Summary ---');
                                console.log('128×128 = 16,384 tiles × 6 bytes = 98 KB naive');
                                console.log('1024×1024 = 1,048,576 tiles × 6 bytes = 6,291 KB naive');
                                
                                db.close();
                            });
                        });
                    });
                });
            });
        });
    });
}
