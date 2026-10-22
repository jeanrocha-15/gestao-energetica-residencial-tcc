import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { devices } from '@/db/schema';

/** Retorna dados do cadastro sem permitir cache compartilhado entre usuários. */
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
/** Valida texto descritivo; identificador é um código do aparelho, nunca uma credencial. */
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 160) throw new Error(`${label}: preencha até 160 caracteres.`);
  return value.trim();
}
/** Persiste dispositivos de qualquer fabricante, mantendo o status sob controle do servidor. */
async function handle(request: Request): Promise<Response> {
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) return json({ error: 'Entre na sua conta local.' }, 401);
  const db = drizzle(getDatabase());
  try {
    if (request.method === 'GET') return json({ devices: await db.select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.createdAt)) });
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) return json({ error: 'Origem inválida.' }, 403);
    if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Envie JSON.' }, 415);
    let input: Record<string, unknown>;
    try {
      const value: unknown = await request.json();
      if (!value || typeof value !== 'object') throw new Error('Dados inválidos.');
      input = value as Record<string, unknown>;
    } catch { return json({ error: 'Dados inválidos.' }, 400); }
    if (typeof input.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(input.id)) return json({ error: 'Identificador do cadastro inválido.' }, 400);
    const owned = and(eq(devices.id, input.id), eq(devices.userId, userId));
    if (request.method === 'DELETE') {
      const removed = await db.delete(devices).where(owned).returning({ id: devices.id });
      return removed.length ? json({ deleted: true }) : json({ error: 'Dispositivo não encontrado.' }, 404);
    }
    let data;
    try {
      data = { name: text(input.name, 'Nome'), manufacturer: text(input.manufacturer, 'Fabricante'), model: text(input.model, 'Modelo'), room: text(input.room, 'Cômodo ou abrangência'), circuit: text(input.circuit, 'Circuito'), identifier: text(input.identifier, 'Identificador'), dataSource: text(input.dataSource, 'Origem dos dados') };
    } catch (error) { return json({ error: (error as Error).message }, 400); }
    // A origem informada é descritiva. Não comprova conexão e não habilita coleta automática.
    const integrationStatus = 'Integração não configurada', now = new Date().toISOString();
    if (request.method === 'POST') {
      await db.insert(devices).values({ ...data, id: input.id, userId, integrationStatus, createdAt: now, updatedAt: now });
    } else {
      const updated = await db.update(devices).set({ ...data, integrationStatus, updatedAt: now }).where(owned).returning({ id: devices.id });
      if (!updated.length) return json({ error: 'Dispositivo não encontrado.' }, 404);
    }
    return json({ device: { ...data, id: input.id, integrationStatus } }, request.method === 'POST' ? 201 : 200);
  } catch (error) {
    console.error('Falha no cadastro de dispositivos', error);
    return json({ error: 'Não foi possível salvar ou consultar dispositivos.' }, 503);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
