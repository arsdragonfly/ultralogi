import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const addon = require("./ultralogi-rs.node");

export default addon;
export const { hello, executeSql } = addon;
