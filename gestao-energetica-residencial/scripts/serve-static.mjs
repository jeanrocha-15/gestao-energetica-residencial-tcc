import './build-static.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../../docs/',import.meta.url);
const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml'};
/** Serve apenas os arquivos publicados para testar localmente a mesma versão do Pages. */
async function serve(request,response) {
  const name = new URL(request.url,'http://localhost').pathname.split('/').pop() || 'index.html';
  if (!['index.html','local-pages.js','energy-cost.js','storage.js','readings.js','tariffs.js','favicon.svg'].includes(name)) {
    response.writeHead(404); response.end('Não encontrado'); return;
  }
  try {
    const data = await readFile(new URL(name,root));
    response.writeHead(200,{'Content-Type':types[name.split('.').pop()],'Cache-Control':'no-store'}); response.end(data);
  } catch { response.writeHead(500); response.end('Erro ao ler arquivo.'); }
}
createServer(serve).listen(5175,'127.0.0.1', () => console.log('Abra http://127.0.0.1:5175/gestao-energetica-residencial-tcc/'));
