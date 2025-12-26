const duckdb = require('duckdb');
const fs = require('fs');
const path = require('path');

const db = new duckdb.Database(':memory:');
const outDir = path.join(process.cwd(), 'test_output');

// Try community extension repo
db.run("INSTALL arrow FROM community", (err) => {
    if (err) console.log("INSTALL arrow FROM community:", err.message);
    else console.log("INSTALL arrow FROM community: OK");
    
    db.run("LOAD arrow", (err) => {
        if (err) console.log("LOAD arrow:", err.message);
        else console.log("LOAD arrow: OK");
        
        // Also check what copy formats are available
        db.all("SELECT * FROM duckdb_functions() WHERE function_type = 'copy' ORDER BY function_name", (err, rows) => {
            console.log("\nAvailable COPY formats:");
            if (rows) rows.forEach(r => console.log("  -", r.function_name));
            
            // Create test data
            db.run(`CREATE TABLE tiles AS SELECT i::INT as x, (i*2)::INT as y, 0::TINYINT as z, (i%16)::TINYINT as tile_type FROM generate_series(0, 16383) t(i)`, (err) => {
                if (err) throw err;
                
                const arrowPath = path.join(outDir, 'test.arrow');
                
                db.run(`COPY tiles TO '${arrowPath}' (FORMAT 'arrow')`, (err) => {
                    if (err) console.log("\nArrow IPC export:", err.message);
                    else {
                        const stat = fs.statSync(arrowPath);
                        console.log(`\nArrow IPC: ${(stat.size/1024).toFixed(1)} KB`);
                    }
                    db.close();
                });
            });
        });
    });
});
