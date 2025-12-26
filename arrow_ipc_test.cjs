const duckdb = require('duckdb');
const fs = require('fs');
const path = require('path');

const db = new duckdb.Database(':memory:');
const outDir = path.join(process.cwd(), 'test_output');

// Try to install and load the arrow community extension
db.run("INSTALL arrow", (err) => {
    if (err) console.log("INSTALL arrow:", err.message);
    else console.log("INSTALL arrow: OK");
    
    db.run("LOAD arrow", (err) => {
        if (err) console.log("LOAD arrow:", err.message);
        else console.log("LOAD arrow: OK");
        
        // Create test data
        db.run(`CREATE TABLE tiles AS SELECT i::INT as x, (i*2)::INT as y, 0::TINYINT as z, (i%16)::TINYINT as tile_type FROM generate_series(0, 16383) t(i)`, (err) => {
            if (err) throw err;
            
            // Try Arrow IPC export
            const arrowPath = path.join(outDir, 'test.arrow');
            const arrowZstdPath = path.join(outDir, 'test_zstd.arrow');
            
            let start = performance.now();
            db.run(`COPY tiles TO '${arrowPath}' (FORMAT 'arrow')`, (err) => {
                if (err) console.log("Arrow IPC:", err.message);
                else console.log(`Arrow IPC: ${(performance.now() - start).toFixed(1)}ms`);
                
                // Try with compression
                start = performance.now();
                db.run(`COPY tiles TO '${arrowZstdPath}' (FORMAT 'arrow', COMPRESSION 'zstd')`, (err) => {
                    if (err) console.log("Arrow IPC+zstd:", err.message);
                    else console.log(`Arrow IPC+zstd: ${(performance.now() - start).toFixed(1)}ms`);
                    
                    // Print sizes
                    console.log('\n--- File Sizes ---');
                    for (const f of [arrowPath, arrowZstdPath]) {
                        try {
                            const stat = fs.statSync(f);
                            console.log(`${path.basename(f)}: ${(stat.size/1024).toFixed(1)} KB`);
                        } catch(e) {
                            console.log(`${path.basename(f)}: NOT FOUND`);
                        }
                    }
                    db.close();
                });
            });
        });
    });
});
