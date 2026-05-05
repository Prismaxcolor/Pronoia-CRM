import { supabase } from '../config/supabase';

const BUCKET = 'productos';

export async function subirImagenProducto(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop();
  const nombre = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(nombre, file, { contentType: file.type });

  if (error) return null;

  const { data } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(nombre);

  return data.publicUrl;
}
