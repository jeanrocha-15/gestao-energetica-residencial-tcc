import { env } from 'cloudflare:workers';
/** Obtém o banco D1 configurado no servidor e interrompe a operação se ele não estiver disponível. */
export function getDatabase() {
  if (!env.DB) throw new Error('Measurement database unavailable');
  return env.DB;
}
