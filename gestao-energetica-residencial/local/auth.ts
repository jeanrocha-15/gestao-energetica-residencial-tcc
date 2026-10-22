import { getDatabase } from '@/db';

/** Converte bytes de um hash para texto hexadecimal sem guardar a senha original. */
function hex(buffer: ArrayBuffer) { return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''); }
/** Deriva a senha com sal individual e PBKDF2; o custo dificulta tentativas offline. */
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256));
}
/** Armazena somente o hash do token aleatório da sessão. */
async function tokenHash(token: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))); }
/** Extrai exclusivamente o cookie de sessão emitido pelo servidor local. */
function token(request: Request) { return request.headers.get('cookie')?.match(/(?:^|;\s*)energy_session=([a-f0-9-]{72})/)?.[1] ?? ''; }
/** Consulta uma sessão ainda válida no D1, mantendo autenticação após reiniciar. */
export async function currentUser(request: Request) {
  return getDatabase().prepare('SELECT u.id, u.email FROM local_users u JOIN local_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').bind(await tokenHash(token(request)), Date.now()).first<{ id: string; email: string }>();
}
/** Registra contas locais, inicia sessões e encerra sessões com verificação de origem. */
export async function auth(request: Request, action: string) {
  const origin = request.headers.get('origin');
  if (request.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 });
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== new URL(request.url).origin)) return Response.json({ error: 'Origem inválida.' }, { status: 403 });
  const db = getDatabase();
  if (action === 'logout') {
    await db.prepare('DELETE FROM local_sessions WHERE token_hash=?').bind(await tokenHash(token(request))).run();
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': 'energy_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' } });
  }
  let body;
  try { body = await request.json() as { email: string; password: string }; } catch { return Response.json({ error: 'Dados inválidos.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return Response.json({ error: 'Dados inválidos.' }, { status: 400 });
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160 || typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) return Response.json({ error: 'Informe e-mail e senha de 8 a 128 caracteres.' }, { status: 400 });
  if (action === 'register') {
    const salt = crypto.randomUUID();
    try {
      await db.prepare('INSERT INTO local_users(id,email,password_hash,salt) VALUES(?,?,?,?)').bind(crypto.randomUUID(), email, await passwordHash(body.password, salt), salt).run();
    } catch { return Response.json({ error: 'Não foi possível criar a conta. O e-mail pode já estar cadastrado.' }, { status: 409 }); }
  }
  const user = await db.prepare('SELECT * FROM local_users WHERE email=?').bind(email).first<{ id: string; password_hash: string; salt: string }>();
  const candidate = await passwordHash(body.password, user?.salt ?? 'invalid-local-user');
  if (!user || candidate !== user.password_hash) return Response.json({ error: 'E-mail ou senha inválidos.' }, { status: 401 });
  const session = crypto.randomUUID() + crypto.randomUUID();
  await db.prepare('INSERT INTO local_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await tokenHash(session), user.id, Date.now() + 7 * 86400000).run();
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': `energy_session=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800` } });
}
