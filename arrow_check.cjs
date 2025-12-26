const duckdb = require('duckdb');

const db = new duckdb.Database(':memory:');

db.run("INSTALL arrow FROM community", () => {
    db.run("LOAD arrow", () => {
        // Check the copy function signature
        db.all(`SELECT * FROM duckdb_functions() WHERE function_name = 'arrow'`, (err, rows) => {
            console.log("Arrow function info:");
            if (rows && rows.length > 0) {
                console.log("  parameters:", rows[0].parameters);
                console.log("  parameter_types:", rows[0].parameter_types);
            }
            
            // Try to see available options
            db.run(`CREATE TABLE t AS SELECT 1 as a`, () => {
                db.run(`COPY t TO '/tmp/test.arrow' (FORMAT 'arrow', CODEC 'zstd')`, (err) => {
                    if (err) console.log("\nCODEC syntax:", err.message);
                    
                    db.run(`COPY t TO '/tmp/test.arrow' WITH (FORMAT 'arrow', compression='zstd')`, (err) => {
                        if (err) console.log("WITH syntax:", err.message);
                        db.close();
                    });
                });
            });
        });
    });
});
