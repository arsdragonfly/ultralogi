const duckdb = require('duckdb');

const db = new duckdb.Database(':memory:');

// Pre-create + benchmark pure SQL perf
db.run(`
    CREATE TABLE voxels AS
    SELECT 
        (i % 32)::UTINYINT as x,
        ((i / 32) % 32)::UTINYINT as y,
        ((i / 1024))::UTINYINT as z,
        (abs(hash(i)) % 8)::UTINYINT as block_type
    FROM generate_series(0, 32*32*64 - 1) t(i)
`, (err) => {
    // Warm up
    for (let i = 0; i < 3; i++) {
        db.all(`SELECT x, y, z, block_type FROM voxels`, () => {});
    }
    
    setTimeout(() => {
        console.log('=== Query Method Comparison ===\n');
        
        // Method 1: db.all (materializes to JS objects)
        let times = [];
        let completed = 0;
        const runs = 5;
        
        for (let i = 0; i < runs; i++) {
            const start = performance.now();
            db.all(`SELECT x, y, z, block_type FROM voxels`, (err, rows) => {
                times.push(performance.now() - start);
                completed++;
                if (completed === runs) {
                    const avg = times.reduce((a,b) => a+b) / times.length;
                    console.log(`db.all() (→ JS objects):  ${avg.toFixed(1)}ms`);
                    
                    // Method 2: Prepared statement
                    const stmt = db.prepare(`SELECT x, y, z, block_type FROM voxels`);
                    times = [];
                    completed = 0;
                    
                    for (let i = 0; i < runs; i++) {
                        const start = performance.now();
                        stmt.all((err, rows) => {
                            times.push(performance.now() - start);
                            completed++;
                            if (completed === runs) {
                                const avg = times.reduce((a,b) => a+b) / times.length;
                                console.log(`prepared.all():           ${avg.toFixed(1)}ms`);
                                
                                // Method 3: COUNT only (no transfer)
                                const start = performance.now();
                                db.all(`SELECT COUNT(*) FROM voxels`, (err, rows) => {
                                    console.log(`COUNT(*) only:            ${(performance.now() - start).toFixed(1)}ms`);
                                    
                                    // Method 4: Export to file (bypass JS)
                                    const start2 = performance.now();
                                    db.run(`COPY voxels TO '/tmp/bench.bin' (FORMAT CSV)`, (err) => {
                                        console.log(`COPY to file:             ${(performance.now() - start2).toFixed(1)}ms`);
                                        
                                        console.log('\n→ Bottleneck: Node.js object materialization');
                                        db.close();
                                    });
                                });
                            }
                        });
                    }
                }
            });
        }
    }, 500);
});
