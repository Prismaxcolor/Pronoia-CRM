import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.ANON;
const service = process.env.SUPABASE_SERVICE_KEY;

const a = createClient(url, anon);
const s = createClient(url, service);

// PNG 1x1 transparente
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

for (const bucket of ['tickets', 'productos']) {
  const name = `__diag_${bucket}.png`;
  const { error } = await a.storage.from(bucket).upload(name, png, { contentType: 'image/png', upsert: true });
  console.log(`anon upload → ${bucket}: ${error ? '❌ ' + error.message : '✅ OK'}`);
  if (!error) await s.storage.from(bucket).remove([name]); // limpiar con service
}

const { data: buckets } = await s.storage.listBuckets();
for (const b of buckets ?? []) {
  if (['tickets', 'productos'].includes(b.name)) console.log(`bucket ${b.name}: public=${b.public}`);
}
