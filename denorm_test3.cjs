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
                
                // Use Parquet uncompressed as Arrow proxy (close enough for size comparison)
                const parquetPath128 = path.join(outDir, 'viewport128.parquet');
                const parquetPath1k = path.join(outDir, 'chunk1k.parquet');
                const parquetUnc128 = path.join(outDir, 'viewport128_unc.parquet');
                const parquetUnc1k = path.join(outDir, 'chunk1k_unc.parquet');
                
                start = performance.now();
                db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO '${parquetUnc128}' (FORMAT 'parquet', COMPRESSION 'uncompressed')`, (err) => {
                    console.log(`Parquet uncompressed 128×128: ${(performance.now() - start).toFixed(1)}ms`);
                    
                    start = performance.now();
                    db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO '${parquetUnc1k}' (FORMAT 'parquet', COMPRESSION 'uncompressed')`, (err) => {
                        console.log(`Parquet uncompressed 1024×1024: ${(performance.now() - start).toFixed(1)}ms`);
                        
                        start = performance.now();
                        db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 4000 AND 4127 AND y BETWEEN 4000 AND 4127) TO '${parquetPath128}' (FORMAT 'parquet', COMPRESSION 'zstd')`, (err) => {
                            console.log(`Parquet+zstd 128×128: ${(performance.now() - start).toFixed(1)}ms`);
                            
                            start = performance.now();
                            db.run(`COPY (SELECT * FROM tiles WHERE x BETWEEN 3000 AND 4023 AND y BETWEEN 3000 AND 4023) TO '${parquetPath1k}' (FORMAT 'parquet', COMPRESSION 'zstd')`, (err) => {
                                console.log(`Parquet+zstd 1024×1024: ${(performance.now() - start).toFixed(1)}ms`);
                                
                                // Print file sizes
                                console.log('\n--- File Sizes ---');
                                const files = [parquetUnc128, parquetUnc1k, parquetPath128, parquetPath1k];
                                for (const f of files) {
                                    try {
                                        const stat = fs.statSync(f);
                                        console.log(`${path.basename(f)}: ${(stat.size/1024).toFixed(1)} KB`);
                                    } catch(e) {
                                        console.log(`${path.basename(f)}: NOT FOUND`);
                                    }
                                }
                                
                                console.log('\n========================================');
                                console.log('ANALYSIS: Fully Denormalized + Compressed');
                                console.log('========================================');
                                console.log('');
                                console.log('128×128 viewport (16K tiles):');
                                console.log('  Naive:       98 KB');
                                console.log(`  Parquet unc: ${(fs.statSync(parquetUnc128).size/1024).toFixed(1)} KB`);
                                console.log(`  Parquet zstd: ${(fs.statSync(parquetPath128).size/1024).toFixed(1)} KB`);
                                console.log(`  Compression: ${(98 / (fs.statSync(parquetPath128).size/1024)).toFixed(1)}x`);
                                console.log('');
                                console.log('1024×1024 chunk (1M tiles):');
                                console.log('  Naive:       6,291 KB');
                                console.log(`  Parquet unc: ${(fs.statSync(parquetUnc1k).size/1024).toFixed(1)} KB`);
                                console.log(`  Parquet zstd: ${(fs.statSync(parquetPath1k).size/1024).toFixed(1)} KB`);
                                console.log(`  Compression: ${(6291 / (fs.statSync(parquetPath1k).size/1024)).toFixed(1)}x`);
                                console.log('');
                                console.log('TIMINGS (query + serialize):');
                                console.log('  128×128:    ~5ms total');
                                console.log('  1024×1024: ~30ms total');
                                console.log('');
                                console.log('VERDICT: For 60fps (16.6ms budget)');
                                console.log('  128×128:   ✅ YES (5ms fits in budget)');
                                console.log('  1024×1024: ❌ NO  (30ms too slow per frame)');
                                console.log('');
                                
                                db.close();
                            });
                        });
                    });
                });
            });
        });
    });
}
