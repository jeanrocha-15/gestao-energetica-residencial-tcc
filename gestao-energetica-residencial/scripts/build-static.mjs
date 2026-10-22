import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const destination = new URL('../../docs/', import.meta.url);
// Lista explícita: somente arquivos públicos entram no site, nunca bancos ou variáveis de ambiente.
await mkdir(destination, {recursive:true});
await copyFile(new URL('../app/dashboard.html',import.meta.url), new URL('index.html',destination));
for (const name of ['default-readings.js','local-pages.js','energy-cost.js','storage.js','readings.js','tariffs.js','favicon.svg']) {
  await copyFile(new URL('../public/'+name,import.meta.url), new URL(name,destination));
}
await writeFile(new URL('.nojekyll',destination),'');
console.log('Site estático gerado em ' + fileURLToPath(destination));
