import { harness } from './harness';

const r = await harness().logs(50).run();
const logs = r.named?.logs ?? (r.steps?.[0] as any)?.result ?? [];
console.log(`Fetched ${logs.length} logs:`);
for (const l of logs) {
    console.log(`${l.timestamp?.toFixed(2)} [${l.category}] ${l.message}`);
}
