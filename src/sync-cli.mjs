import { runSync } from './ym/sync.mjs';

runSync().catch(e => {
  console.error(e);
  process.exit(1);
});
