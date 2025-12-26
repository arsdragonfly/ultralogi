const duckdb = require('duckdb');
const { tableFromIPC } = require('apache-arrow');
const fs = require('fs');

const db = new duckdb.Database(':memory:');

db.run(`INSTALL arrow; LOAD arrow;`, () => {
    db.run(`
        CREATE TABLE voxels AS
        SELECT 
            (i % 32)::UTINYINT as x,
            ((i / 32) % 32)::UTINYINT as y,
            ((i / 1024))::UTINYINT as z,
            (abs(hash(i)) % 8)::UTINYINT as block_type
        FROM generate_series(0, 32*32*64 - 1) t(i)
    `, () => {
        console.log('=== Arrow IPC vs JS Objects ===\n');
        console.log('65,536 voxels (32×32×64)\n');
        
        // Warm up
        db.run(`COPY voxels TO '/tmp/voxels.arrow' (FORMAT 'arrow')`, () => {
            
            // 1. Arrow IPC export to file
            let start = performance.now();
            db.run(`COPY voxels TO '/tmp/voxels.arrow' (FORMAT 'arrow')`, () => {
                const exportTime = performance.now() - start;
                
                // 2. Read Arrow file + parse to typed arrays
                start = performance.now();
                const buf = fs.readFileSync('/tmp/voxels.arrow');
                const readTime = performance.now() - start;
                
                start = performance.now();
                const table = tableFromIPC(buf);
                const parseTime = performance.now() - start;
                
                start = performance.now();
                const x = table.getChild('x').toArray();  // Uint8Array
                const y = table.getChild('y').toArray();
                const z = table.getChild('z').toArray();
                const block = table.getChild('block_type').toArray();
                const extractTime = performance.now() - start;
                
                const arrowSize = fs.statSync('/tmp/voxels.arrow').size;
                
                console.log('--- Arrow Pipeline ---');
                console.log(`COPY to Arrow file:       ${exportTime.toFixed(1)}ms`);
                console.log(`Read file:                ${readTime.toFixed(1)}ms`);
                console.log(`Parse IPC (tableFromIPC): ${parseTime.toFixed(1)}ms`);
                console.log(`Extract typed arrays:     ${extractTime.toFixed(1)}ms`);
                console.log(`TOTAL:                    ${(exportTime + readTime + parseTime + extractTime).toFixed(1)}ms`);
                console.log(`File size:                ${(arrowSize / 1024).toFixed(1)} KB`);
                console.log(`Arrays:                   ${x.constructor.name}[${x.length}]`);
                
                // Compare to db.all()
                start = performance.now();
                db.all(`SELECT x, y, z, block_type FROM voxels`, (err, rows) => {
                    const dbAllTime = performance.now() - start;
                    console.log('\n--- JS Object Pipeline ---');
                    console.log(`db.all():                 ${dbAllTime.toFixed(1)}ms`);
                    
                    console.log(`\n→ Arrow is ${(dbAllTime / (exportTime + readTime + parseTime + extractTime)).toFixed(1)}x faster`);
                    
                    db.close();
                });
            });
        });
    });
});
