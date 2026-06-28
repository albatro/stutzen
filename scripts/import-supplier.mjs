import { runSupplierImport } from '../src/supplier/import.mjs';

runSupplierImport().catch(e => {
  console.error(e);
  process.exit(1);
});
