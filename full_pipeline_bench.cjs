const duckdb = require('duckdb');
const fs = require('fs');
const path = require('path');

const db = new duckdb.Database(':memory:');
const outDir = './test_output';

console.log('=== Full Pipeline Benchmark ===\n');
console.log('Chunk: 32×32×64 = 65,536 voxels');
console.log('Voxel: 4 bytes (x:u8, y:u8, z:u8, type:u8)\n');

// Create chunk with realistic terrain
db.run(`
    CREATE TABLE voxels AS
    SELECT 
        (i % 32)::UTINYINT as x,
        ((i / 32) % 32)::UTINYINT as y,
        ((i / 1024))::UTINYINT as z,
        CASE 
            WHEN (i / 1024) > 48 THEN 0
            WHEN (i / 1024) < 16 THEN 1
            WHEN (i / 1024) < 32 THEN 2
            ELSE (abs(hash(i)) % 8)::UTINYINT
        END as block_type
    FROM generate_series(0, 32*32*64 - 1) t(i)
`, (err) => {
    if (err) throw err;
    runBenchmarks();
});

function runBenchmarks() {
    const results = {};
    
    // 1. Query time
    let start = performance.now();
    db.all(`SELECT x, y, z, block_type FROM voxels`, (err, rows) => {
        results.query = performance.now() - start;
        results.rows = rows.length;
        
        // 2. Arrow IPC export (uncompressed - simulates what we'd send)
        start = performance.now();
        db.run(`COPY voxels TO '${outDir}/chunk.parquet' (FORMAT PARQUET, COMPRESSION 'uncompressed')`, (err) => {
            results.export_unc = performance.now() - start;
            
            // 3. Parquet zstd (for comparison)
            start = performance.now();
            db.run(`COPY voxels TO '${outDir}/chunk_zstd.parquet' (FORMAT PARQUET, COMPRESSION 'zstd')`, (err) => {
                results.export_zstd = performance.now() - start;
                
                // Get file sizes
                const uncSize = fs.statSync(`${outDir}/chunk.parquet`).size;
                const zstdSize = fs.statSync(`${outDir}/chunk_zstd.parquet`).size;
                
                console.log('--- DuckDB Side ---');
                console.log(`Query 65K voxels:        ${results.query.toFixed(1)}ms`);
                console.log(`Export uncompressed:     ${results.export_unc.toFixed(1)}ms (${(uncSize/1024).toFixed(1)} KB)`);
                console.log(`Export zstd:             ${results.export_zstd.toFixed(1)}ms (${(zstdSize/1024).toFixed(1)} KB)`);
                
                console.log('\n--- Transfer Estimates ---');
                const rawBytes = 65536 * 4; // x,y,z,type as u8 each
                console.log(`Raw bytes:               ${(rawBytes/1024).toFixed(1)} KB`);
                console.log(`PCIe 3.0 x16 (~12 GB/s): ${(rawBytes / 12e9 * 1000).toFixed(3)}ms`);
                console.log(`PCIe 4.0 x16 (~25 GB/s): ${(rawBytes / 25e9 * 1000).toFixed(3)}ms`);
                
                console.log('\n--- GPU Side Estimates (RTX 3070 class) ---');
                console.log(`RLE scan (65K, parallel): ~0.1-0.2ms`);
                console.log(`Face extraction:          ~0.1-0.3ms`);
                console.log(`Mesh generation:          ~0.2-0.5ms`);
                
                console.log('\n=== TOTAL PIPELINE ESTIMATE ===');
                const totalMin = results.query + 0.02 + 0.1 + 0.1 + 0.2;
                const totalMax = results.query + 0.02 + 0.2 + 0.3 + 0.5;
                console.log(`Best case:  ${totalMin.toFixed(1)}ms`);
                console.log(`Worst case: ${totalMax.toFixed(1)}ms`);
                console.log(`\n60fps budget: 16.6ms`);
                console.log(`Chunks per frame: ${Math.floor(16.6 / totalMax)}-${Math.floor(16.6 / totalMin)}`);
                
                db.close();
            });
        });
    });
}
