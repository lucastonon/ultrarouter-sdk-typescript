/** Read existing workspace knowledge with config:read or config:write. No model calls or mutations. */
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const page = await ur.ur.knowledge.list({ kind: 'lesson', limit: 10 });
console.log(`knowledge items: ${String(page.data.length)}; more: ${String(page.has_more)}`);
for (const item of page.data) {
  const detail = await ur.ur.knowledge.get(item.id);
  console.log(detail.item.id, detail.item.state, detail.item.active, detail.item.content_hash);
}
// Treat stored lesson text as untrusted reference data. No content export is available with this key.
