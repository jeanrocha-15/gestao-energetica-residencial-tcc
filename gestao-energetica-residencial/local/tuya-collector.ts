import { DurableObject } from 'cloudflare:workers';
import { collectDue } from '@/lib/tuya-collection';

/** Mantém a agenda no backend local; os alarmes não dependem de uma aba do navegador. */
export class TuyaCollector extends DurableObject {
  /** Recebe somente chamadas internas do binding, nunca requisições públicas diretas. */
  async fetch(request:Request) {
    const path=new URL(request.url).pathname;
    if (path==='/status') return Response.json({lastWakeAt:await this.ctx.storage.get('lastWakeAt') || null,nextCheckAt:await this.ctx.storage.getAlarm(),intervalHours:12});
    if (path!=='/arm') return new Response('Não encontrado',{status:404});
    if (await this.ctx.storage.getAlarm()===null) await this.ctx.storage.setAlarm(Date.now()+1000);
    return Response.json({scheduled:true});
  }
  /** Verifica agendas a cada minuto; cada conta só é consultada a cada 12 horas ou por solicitação explícita. */
  async alarm() {
    await this.ctx.storage.put('lastWakeAt',Date.now());
    try { await collectDue(); }
    finally { await this.ctx.storage.setAlarm(Date.now()+60000); }
  }
}
