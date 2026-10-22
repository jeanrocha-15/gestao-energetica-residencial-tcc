import dashboard from '../app/dashboard.html';
import login from './login.html';
import * as readings from '@/app/api/readings/route';
import * as tariffs from '@/app/api/tariffs/route';
import * as devices from '@/app/api/devices/route';
import * as tuya from '@/app/api/integrations/tuya/route';
import { auth, currentUser } from './auth';
import { finishAuthorization, isAdmin } from '@/lib/tuya-authorization';
import { armCollector } from '@/lib/tuya-collection';
import { adminTuya, adminTuyaHtml } from './admin-tuya';
export { TuyaCollector } from './tuya-collector';

const pages = ['/', '/medicoes', '/historico', '/comparacao', '/tarifas', '/configuracoes'];
/** Entrega HTML privado, sem cache, usado pelas páginas locais e pelo login. */
function html(body: string) { return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }); }

const localWorker = {
  /** Roteia apenas em localhost e substitui cabeçalhos externos pela identidade da sessão D1. */
  async fetch(request: Request, env: { ASSETS: Fetcher }, context:ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Response('Disponível somente em localhost.', { status: 403 });
    try {
      // Reativa alarmes persistidos ao iniciar o servidor, sem exigir uma página aberta.
      context.waitUntil(armCollector().catch(()=>{}));
      if (url.pathname==='/api/integrations/tuya/callback' && request.method==='GET') {
        let result='success';
        try { await finishAuthorization(request); await armCollector(); } catch { result='error'; }
        // Uma página local intermediária restabelece o contexto same-site sem enfraquecer a sessão Strict.
        return new Response(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Autorização Tuya</title><p>Retornando ao sistema…</p><a href="/configuracoes?tuya=${result}">Continuar</a><script>history.replaceState(null,'','/api/integrations/tuya/callback');location.replace('/configuracoes?tuya=${result}');</script></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Set-Cookie':'tuya_oauth_state=; HttpOnly; SameSite=Lax; Path=/api/integrations/tuya/callback; Max-Age=0'}});
      }
      if (url.pathname === '/login' || url.pathname === '/signin-with-chatgpt') return html(login);
      if (/^\/api\/auth\/(login|register|logout)$/.test(url.pathname)) return await auth(request, url.pathname.split('/').at(-1)!);
      if (['/energy-cost.js', '/local-pages.js', '/tuya-integration.js', '/favicon.svg'].includes(url.pathname)) return env.ASSETS.fetch(request);
      const user = await currentUser(request);
      if (!user) return url.pathname.startsWith('/api/') ? Response.json({ error: 'Entre na sua conta local.' }, { status: 401 }) : Response.redirect(`${url.origin}/login`, 302);
      if (url.pathname==='/admin/tuya') return isAdmin(user.id)?html(adminTuyaHtml()):new Response('Acesso restrito ao administrador.',{status:403});
      if (url.pathname==='/api/admin/tuya') return adminTuya(request,user.id);
      if (url.pathname === '/api/auth/me') return Response.json(user, { headers: { 'Cache-Control': 'no-store' } });
      const headers = new Headers(request.headers);
      for (const name of [...headers.keys()]) if (name.startsWith('oai-authenticated-user-')) headers.delete(name);
      headers.set('oai-authenticated-user-id', user.id);
      headers.set('oai-authenticated-user-email', user.email);
      // Consome o corpo original antes de encaminhar: respostas antecipadas (ex.: 403)
      // não deixam uma transmissão pendente no proxy HTTP do Workerd no Windows.
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
      const authenticated = new Request(request.url, { method: request.method, headers, body });
      const api = url.pathname === '/api/readings' ? readings : url.pathname === '/api/tariffs' ? tariffs : url.pathname === '/api/devices' ? devices : url.pathname === '/api/integrations/tuya' ? tuya : null;
      if (api) {
        const handler = (api as Record<string, unknown>)[request.method];
        return typeof handler === 'function' ? await handler(authenticated) : new Response('Método não permitido.', { status: 405 });
      }
      if (pages.includes(url.pathname) && request.method === 'GET') return html(dashboard);
      return new Response('Página não encontrada.', { status: 404 });
    } catch (error) {
      console.error('Falha no servidor local', error);
      return Response.json({ error: 'Falha local. Verifique o terminal e as migrações.' }, { status: 500 });
    }
  },
};
export default localWorker;
