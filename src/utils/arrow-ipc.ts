/**
 * Arrow IPC utilities for Use.GPU integration.
 * 
 * Uses apache-arrow library for proper IPC parsing.
 * The original "Invalid value used as weak map key" error was NOT caused
 * by apache-arrow - it was caused by numeric JSX children in Use.GPU's
 * reactive system.
 */

import { tableFromIPC } from 'apache-arrow';

/// <reference path="../types/interface.d.ts" />

/**
 * Parsed tile data in a Use.GPU-friendly format.
 * Typed arrays for efficient GPU upload.
 */
export interface TileData {
  numRows: number;
  x: Int32Array;
  y: Int32Array;
  tileType: Int32Array;
  elevation: Float32Array;
}

/**
 * A stable "handle" for tile data that Use.GPU can track.
 * The handle reference stays the same, but data can be updated.
 */
export class TileDataHandle {
  private _data: TileData | null = null;
  private _version = 0;
  
  get data(): TileData | null {
    return this._data;
  }
  
  get version(): number {
    return this._version;
  }
  
  get numRows(): number {
    return this._data?.numRows ?? 0;
  }

  update(data: TileData): void {
    this._data = data;
    this._version++;
  }

  clear(): void {
    this._data = null;
    this._version++;
  }
}

/**
 * Parse Arrow IPC stream buffer into tile data using apache-arrow.
 * Uses zero-copy toArray() for maximum performance.
 */
export function parseTileBuffer(buffer: Uint8Array): TileData {
  if (buffer.length === 0) {
    return {
      numRows: 0,
      x: new Int32Array(0),
      y: new Int32Array(0),
      tileType: new Int32Array(0),
      elevation: new Float32Array(0),
    };
  }

  const table = tableFromIPC(buffer);
  const numRows = table.numRows;
  
  // Get columns by name - DuckDB uses lowercase names
  const xCol = table.getChild('x');
  const yCol = table.getChild('y');
  const tileTypeCol = table.getChild('tile_type');
  const elevationCol = table.getChild('elevation');
  
  if (!xCol || !yCol || !tileTypeCol || !elevationCol) {
    console.error('Missing columns in Arrow table:', table.schema.fields.map(f => f.name));
    return {
      numRows: 0,
      x: new Int32Array(0),
      y: new Int32Array(0),
      tileType: new Int32Array(0),
      elevation: new Float32Array(0),
    };
  }
  
  // Use toArray() for near-zero-copy access to underlying buffers
  // This is MUCH faster than element-by-element get()
  return {
    numRows,
    x: xCol.toArray() as Int32Array,
    y: yCol.toArray() as Int32Array,
    tileType: tileTypeCol.toArray() as Int32Array,
    elevation: elevationCol.toArray() as Float32Array,
  };
}

/**
 * Query and parse in one step.
 */
export function queryTiles(sql: string): TileData {
  const buffer = window.ultralogi.query(sql);
  return parseTileBuffer(buffer);
}
