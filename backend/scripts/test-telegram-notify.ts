// Diagnóstico manual del envío de documentos por Telegram (Fase 1). Crea un
// proveedor de prueba temporal, le manda un ticket de pesaje de prueba al chat_id
// indicado, y borra el proveedor al terminar. Requiere N8N_WEBHOOK_ENVIAR_DOCUMENTO
// configurado en .env y que el bot ya te haya vinculado (tu chat_id real).
//
// Uso: npx tsx scripts/test-telegram-notify.ts <chat_id>

import { supabaseAdmin as sb } from '../src/config/supabase.js';
import { notificarDocumento } from '../src/services/telegram-notify-service.js';
import { generarTicketPdf, nombreArchivoTicket } from '../src/services/document-generator.js';
import type { TicketPublico } from '../src/services/ticket-pesaje-service.js';

const chatId = process.argv[2];
if (!chatId) {
  console.error('Uso: npx tsx scripts/test-telegram-notify.ts <chat_id>');
  process.exit(1);
}

const { data: proveedor, error } = await sb
  .from('proveedores')
  .insert({ nombre: '[DIAGNÓSTICO] Envío Telegram', telegram_chat_id: chatId, telegram_linked_at: new Date().toISOString() })
  .select('id')
  .single();

if (error || !proveedor) {
  console.error('No se pudo crear el proveedor de prueba:', error?.message);
  process.exit(1);
}

const ticket: TicketPublico = {
  id: 'diagnostico',
  numero: 0,
  codigo: 'Pesaje 0000 (diagnóstico)',
  tipo: 'compra',
  entidadId: proveedor.id,
  fecha: new Date().toISOString().slice(0, 10),
  materiales: [
    { id: 'm1', productoId: null, nombreProducto: 'Cobre (diagnóstico)', subcategoria: null, pesoBruto: 12, tara: 2, devolucion: 0, pesoNeto: 10, destinoTipo: 'mpp', loteId: null, nombreLote: null },
  ],
  pesoNetoTotal: 10,
  pesoGlobal: 10,
  diferencia: 0,
  fotos: [],
  observaciones: 'Diagnóstico manual del pipeline de envío por Telegram.',
  facturado: false,
  estado: 'completo',
  pesadoPor: null,
  completadoPor: null,
  completadoEn: null,
  createdAt: new Date().toISOString(),
};

try {
  await notificarDocumento({
    entidadTipo: 'proveedor',
    entidadId: proveedor.id,
    tipoDocumento: 'ticket',
    nombreArchivo: nombreArchivoTicket(ticket),
    generarBuffer: nombreEntidad => generarTicketPdf(ticket, nombreEntidad),
  });
  console.log('✅ notificarDocumento() ejecutado sin errores. Revisá Telegram.');
} finally {
  await sb.from('proveedores').delete().eq('id', proveedor.id);
  console.log('Proveedor de prueba borrado.');
}
