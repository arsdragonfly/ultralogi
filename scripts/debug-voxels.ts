import { execute, queryVoxelChunkRaw, createVoxelWorld, query } from '../ultralogi-rs/index.mjs';
import { tableFromIPC } from 'apache-arrow';

// Helper to parse Arrow IPC to objects
function arrowToObjects(buffer: Buffer | Uint8Array): Record<string, unknown>[] {
  if (!buffer || buffer.length === 0) return [];
  const table = tableFromIPC(buffer);
  const results: Record<string, unknown>[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const row: Record<string, unknown> = {};
    for (const field of table.schema.fields) {
      row[field.name] = table.getChild(field.name)?.get(i);
    }
    results.push(row);
  }
  return results;
}

// Force drop entire voxels table to get clean state
console.log('Dropping voxels table...');
try { execute('DROP TABLE IF EXISTS voxels'); } catch(e) { console.log('Drop error:', e); }

// Test the CASE logic in isolation (using integer division //)
console.log('\nTesting CASE logic directly...');
const caseTestResult = query(`
    SELECT 
        (i // 1024) as y,
        CASE 
            WHEN (i // 1024) > 32 THEN 0
            WHEN (i // 1024) = 32 THEN 1
            WHEN (i // 1024) > 28 THEN 2
            ELSE 3
        END as block_type,
        COUNT(*) as cnt
    FROM generate_series(0, 32*32*64 - 1) t(i)
    WHERE (i // 1024) >= 28 AND (i // 1024) <= 35
    GROUP BY 1, 2
    ORDER BY y, block_type
`);

console.log('\nCASE test results (y=28-35):');
console.table(arrowToObjects(caseTestResult));

// Create world
console.log('Creating voxel world...');
console.log(createVoxelWorld(0, 0));

// Check block type distribution directly in the table
execute('DROP TABLE IF EXISTS block_stats');
execute(`
    CREATE TABLE block_stats AS
    SELECT 
        y,
        block_type,
        COUNT(*) as cnt
    FROM voxels
    WHERE chunk_x = 0 AND chunk_z = 0 AND y >= 28 AND y <= 35
    GROUP BY y, block_type
    ORDER BY y, block_type
`);

// Query the stats (returns Arrow buffer, but we need to decode it)
console.log('\nQuerying block stats at y=28-35...');

// Use raw query and parse
const raw = queryVoxelChunkRaw(0, 0);
const view = new DataView(raw.buffer, raw.byteOffset);
const count = view.getUint32(0, true);

const yData = new Uint8Array(raw.buffer, raw.byteOffset + 4 + count, count);
const types = new Uint8Array(raw.buffer, raw.byteOffset + 4 + count * 3, count);

// Count by y and type
const stats: Record<number, Record<number, number>> = {};
for (let i = 0; i < count; i++) {
  const y = yData[i];
  if (y >= 28 && y <= 35) {
    if (!stats[y]) stats[y] = {};
    const t = types[i];
    stats[y][t] = (stats[y][t] || 0) + 1;
  }
}

console.log('\nBlock types by Y level:');
for (let y = 28; y <= 35; y++) {
  const s = stats[y] || {};
  console.log(`  y=${y}: air=${s[0]||0}, grass=${s[1]||0}, dirt=${s[2]||0}, stone=${s[3]||0}`);
}

// What we expect:
// y=28: stone only
// y=29,30,31: dirt only
// y=32: grass only
// y=33,34,35: air (not returned since we filter block_type > 0)
