import { supabase } from '../config/supabase';

const BUCKET_PRODUCTOS = 'productos';
const BUCKET_TICKETS = 'tickets';

async function subirArchivo(bucket: string, file: File): Promise<string | null> {
  const ext = file.name.split('.').pop();
  const nombre = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(nombre, file, { contentType: file.type });

  if (error) return null;

  const { data } = supabase.storage.from(bucket).getPublicUrl(nombre);
  return data.publicUrl;
}

export function subirImagenProducto(file: File): Promise<string | null> {
  return subirArchivo(BUCKET_PRODUCTOS, file);
}

/** Sube una foto de evidencia del pesaje. Requiere bucket público 'tickets'. */
export function subirFotoTicket(file: File): Promise<string | null> {
  return subirArchivo(BUCKET_TICKETS, file);
}
