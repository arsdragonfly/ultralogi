#!/usr/bin/env node
/**
 * Auto-sync index.mjs exports from index.d.ts
 * Run after `napi build` to ensure all functions are exported
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dtsPath = join(__dirname, '..', 'index.d.ts');
const mjsPath = join(__dirname, '..', 'index.mjs');

// Parse index.d.ts to extract function names
const dtsContent = readFileSync(dtsPath, 'utf-8');
const functionRegex = /export declare function (\w+)\(/g;
const functions = [];
let match;
while ((match = functionRegex.exec(dtsContent)) !== null) {
  functions.push(match[1]);
}

console.log(`Found ${functions.length} functions in index.d.ts:`);
functions.forEach(f => console.log(`  - ${f}`));

// Generate index.mjs
const mjsContent = `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const addon = require("./ultralogi-rs.node");

export default addon;
export const { 
  ${functions.join(',\n  ')},
} = addon;
`;

writeFileSync(mjsPath, mjsContent);
console.log(`\n✅ Updated index.mjs with ${functions.length} exports`);
