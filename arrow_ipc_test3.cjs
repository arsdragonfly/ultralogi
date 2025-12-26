const duckdb = require('duckdb');
const fs = require('fs');
const path = require('path');

const db = new duckdb.Database(':memory:');
const outDir = path.join(process.cwd(), 'test_output');

db.run("INSTALL arrow FROM community", (err) => {
    db.run("LOAD arrow", (err) => {
        console.log("Arrow extension loaded");
        
        // Create 128x128 viewport like before (16K tiles)
        db.run(`CREATE TABLE tiles AS 
            SELECT 
                (i % 128)::SMALLINT as x,
                (i / 128)::SMALLINT as y,
                0::TINYINT as z,
                (abs(hash(i)) % 16)::TINYINT as tile_type
            FROM generate_series(0, 16383) t(i)`, (err) => {
            if (err) throw err;
            
            const tests = [
                { name: 'arrow', sql: `COPY tiles TO '${outDir}/tiles.arrow' (FORMAT 'arrow')` },
                { name: 'arrow+lz4', sql: `COPY tiles TO '${outDir}/tiles_lz4.arrow' (FORMAT 'arrow', COMPRESSION 'lz4')` },
                { name: 'arrow+zstd', sql: `COPY tiles TO '${outDir}/tiles_zstd.arrow' (FORMAT 'arrow', COMPRESSION 'zstd')` },
                { name: 'parquet', sql: `COPY tiles TO '${outDir}/tiles.parquet' (FORMAT 'parquet', COMPRESSION 'uncompressed')` },
                { name: 'parquet+zstd', sql: `COPY tiles TO '${outDir}/tiles_zstd.parquet' (FORMAT 'parquet', COMPRESSION 'zstd')` },
            ];
            
            let idx = 0;
            function runNext() {
                if (idx >= tests.length) {
                    printResults();
                    return;
                }
                const t = tests[idx++];
                const start = performance.now();
                db.run(t.sql, (err) => {
                    if (err) console.log(`${t.name}: ${err.message}`);
                    else console.log(`${t.name}: ${(performance.now() - start).toFixed(1)}ms`);
                    runNext();
                });
            }
            
            function printResults() {
                console.log('\n--- File Sizes (16K tiles / 128×128 viewport) ---');
                const files = fs.readdirSync(outDir).filter(f => f.startsWith('tiles'));
                for (const f of files.sort()) {
                    const stat = fs.statSync(path.join(outDir, f));
                    console.log(`${f.padEnd(25)}: ${(stat.size/1024).toFixed(1).padStart(7)} KB`);
                }
                console.log(`\nNaive (6 bytes/tile):      ${(16384*6/1024).toFixed(1).padStart(7)} KB`);
                db.close();
            }
            
            runNext();
        });
    });
});
