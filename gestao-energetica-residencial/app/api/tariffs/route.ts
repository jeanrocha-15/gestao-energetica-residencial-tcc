import { drizzle } from 'drizzle-orm/d1';
import { and, eq, desc } from 'drizzle-orm';
import { getDatabase } from '@/db';
import { tariffs } from '@/db/schema';
import { validateTariff } from '@/lib/tariffs';

/** Responde sem permitir armazenamento das configurações particulares em cache. */
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
/** Centraliza autorização, validação e CRUD das tarifas usando Drizzle sobre D1. */
async function handle(request: Request): Promise<Response> {
  const userId = request.headers.get('oai-authenticated-user-id');
  if (!userId) return json({ error: 'Entre na sua conta local para acessar tarifas.' }, 401);
  const db = drizzle(getDatabase());
  try {
    if (request.method === 'GET') return json({ tariffs: await db.select().from(tariffs).where(eq(tariffs.userId, userId)).orderBy(desc(tariffs.startDate)) });
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) return json({ error: 'Origem inválida.' }, 403);
    if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'Envie JSON.' }, 415);
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object') throw new Error('Objeto esperado.');
      body = parsed as Record<string, unknown>;
    } catch { return json({ error: 'JSON inválido.' }, 400); }
    if (request.method === 'DELETE') {
      if (typeof body?.id !== 'string') return json({ error: 'Identificador inválido.' }, 400);
      const deleted = await db.delete(tariffs).where(and(eq(tariffs.id, body.id), eq(tariffs.userId, userId))).returning({ id: tariffs.id });
      return deleted.length ? json({ deleted: true }) : json({ error: 'Tarifa não encontrada.' }, 404);
    }
    let data;
    try { data = validateTariff(body); } catch (error) { return json({ error: (error as Error).message }, 400); }
    const now = new Date().toISOString();
    if (request.method === 'POST') {
      await db.insert(tariffs).values({ ...data, userId, createdAt: now, updatedAt: now });
    } else {
      const updated = await db.update(tariffs).set({ ...data, updatedAt: now }).where(and(eq(tariffs.id, data.id), eq(tariffs.userId, userId))).returning({ id: tariffs.id });
      if (!updated.length) return json({ error: 'Tarifa não encontrada.' }, 404);
    }
    return json({ tariff: data }, request.method === 'POST' ? 201 : 200);
  } catch (error) {
    // O erro pode ser encapsulado pelo Drizzle; percorremos a causa sem expor SQL ao usuário.
    let cause: unknown = error;
    while (cause instanceof Error) {
      if (/TARIFF_OVERLAP|UNIQUE constraint/.test(cause.message)) return json({ error: 'Vigência conflitante ou registro duplicado. Os limites das datas são inclusivos.' }, 409);
      cause = cause.cause;
    }
    console.error('Falha ao persistir tarifa', error);
    return json({ error: 'Não foi possível acessar as tarifas.' }, 503);
  }
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
