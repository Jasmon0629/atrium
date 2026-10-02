import { createServer } from './app.js';
import { initDb } from './db.js';
import { seedIfEmpty } from './seed.js';

if (process.env.NODE_ENV === 'production' && !process.env.ATRIUM_SECRET) {
  console.error('Refusing to start: ATRIUM_SECRET (JWT signing secret) is not set. Put it in .env / the environment.');
  process.exit(1);
}

await initDb();
await seedIfEmpty();

const PORT = Number(process.env.PORT || 4600);
createServer().listen(PORT, () => {
  console.log(`Atrium server listening on http://localhost:${PORT}`);
});
