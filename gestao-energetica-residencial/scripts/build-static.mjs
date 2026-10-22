import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const destination = new URL('../../docs/', import.meta.url);
// Lista explícita: somente arquivos públicos entram no site, nunca bancos ou variáveis de ambiente.
await mkdir(destination, {recursive:true});
await copyFile(new URL('../app/dashboard.html',import.meta.url), new URL('index.html',destination));
for (const name of ['default-readings.js','local-pages.js','energy-cost.js','storage.js','readings.js','tariffs.js','favicon.svg']) {
  await copyFile(new URL('../public/'+name,import.meta.url), new URL(name,destination));
}
await writeFile(new URL('.nojekyll',destination),'');
// Uma versão compartilhada evita misturar HTML novo com módulos antigos guardados no cache.
const modules = ['default-readings.js','local-pages.js','energy-cost.js','storage.js','readings.js','tariffs.js'];
const files = ['index.html', ...modules];
const sources = await Promise.all(files.map(file => readFile(new URL(file, destination), 'utf8')));
const version = createHash('sha256').update(sources.join('\n')).digest('hex').slice(0,16);
/** Atualiza os caminhos dos módulos locais para que cada publicação use um conjunto consistente. */
function versionImports(source) {
  return source.replace(/(['"])\.\/([a-z-]+\.js)\1/g, (match, quote, file) =>
    modules.includes(file) ? `${quote}./${file}?v=${version}${quote}` : match);
}
for (let index = 0; index < files.length; index++) {
  await writeFile(new URL(files[index], destination), versionImports(sources[index]));
}
console.log('Site estático gerado em ' + fileURLToPath(destination));
