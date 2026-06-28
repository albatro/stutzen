import { runSalesImport } from '../src/sales/import.mjs';

const dateFrom = process.argv[2];
const dateTo = process.argv[3];
runSalesImport({ dateFrom, dateTo }).catch(e => { console.error(e); process.exit(1); });
