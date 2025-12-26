/// <reference path="../types/interface.d.ts" />

// Lazy-load apache-arrow to avoid conflicts with Use.GPU's module loading
let arrowModule: typeof import('apache-arrow') | null = null;

const getArrow = async () => {
  if (!arrowModule) {
    arrowModule = await import('apache-arrow');
  }
  return arrowModule;
};

/**
 * Query and return results as an Arrow Table (zero-copy from Rust).
 * @param sql - The SQL query to execute
 * @returns Arrow Table with typed columns
 */
export const queryArrowAsync = async (sql: string) => {
  const { tableFromIPC, Table } = await getArrow();
  const buffer = window.api.query(sql);
  if (buffer.length === 0) {
    return new Table();
  }
  return tableFromIPC(buffer);
};

/**
 * Query and convert results to plain JavaScript objects.
 * @param sql - The SQL query to execute
 * @returns Array of row objects
 */
export const queryRowsAsync = async <T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<T[]> => {
  const table = await queryArrowAsync(sql);
  return table.toArray() as T[];
};
