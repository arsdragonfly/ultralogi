/// <reference path="./types/interface.d.ts" />
import { hello, execute, query, queryTilesGpuReady, benchmarkTileQuery } from 'ultralogi-rs';

window.ultralogi = {
  hello,
  execute,
  query,
  queryTilesGpuReady,
  benchmarkTileQuery,
};
