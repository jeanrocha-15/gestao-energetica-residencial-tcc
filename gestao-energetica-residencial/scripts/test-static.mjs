import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule } from 'node:vm';
import { storageRequest, readData, restoreBackup, STORAGE_KEY } from '../public/storage.js';
import { estimateCost, flagPerKwh } from '../public/energy-cost.js';

const memory = new Map();
globalThis.localStorage = {
  /** Simula a leitura persistente do navegador para testar sem alterar dados reais. */
  getItem(key) { return memory.get(key) ?? null; },
  /** Simula uma gravação atômica do navegador. */
  setItem(key,value) { memory.set(key,value); },
};
const reading = {id:crypto.randomUUID(),date:'2026-10-22',room:'sala',circuit:'Iluminação',kwh:2.5};
await storageRequest('readings','POST',reading);
assert.equal(readData().readings[0].kwh,2.5);
await assert.rejects(storageRequest('readings','POST',{...reading,id:crypto.randomUUID()}),/Já existe/);
await assert.rejects(storageRequest('readings','PUT',{...reading,kwh:-1}),/consumo/);
await storageRequest('readings','PUT',{...reading,kwh:3});
assert.equal(readData().readings[0].kwh,3);
const tariff = {id:crypto.randomUUID(),startDate:'2026-10-01',endDate:'2026-10-31',config:{te:0.3,tusd:0.4,pis:1,cofins:2,icms:10,flag:'Amarela',flagValue:2,flagUnit:'BRL_100_KWH',others:[],taxModel:'outside-v1'}};
await storageRequest('tariffs','POST',tariff);
await assert.rejects(storageRequest('tariffs','POST',{...tariff,id:crypto.randomUUID()}),/sobrepor/);
assert.equal(flagPerKwh(tariff.config),0.02);
assert.ok(Math.abs(estimateCost(10,tariff).total-8.136)<1e-9);
assert.equal(estimateCost(10,null),null);
const backup = JSON.stringify(readData());
await storageRequest('readings','DELETE',{id:reading.id});
assert.equal(readData().readings.length,0);
await restoreBackup(backup);
assert.equal(readData().readings[0].kwh,3);
await assert.rejects(restoreBackup('{bad json'));
await assert.rejects(restoreBackup(JSON.stringify({version:1,readings:[{...reading,date:'2026-02-30'}],tariffs:[]})));
assert.equal(JSON.stringify(readData()),backup);
const saved = memory.get(STORAGE_KEY);
localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
await assert.rejects(storageRequest('readings','PUT',{...reading,kwh:9}),/armazenamento/);
assert.equal(memory.get(STORAGE_KEY),saved);
memory.set(STORAGE_KEY,'corrompido');
assert.throws(readData,/inválidos/);
assert.equal(memory.get(STORAGE_KEY),'corrompido');
const html = await readFile(new URL('../app/dashboard.html',import.meta.url),'utf8');
new SourceTextModule(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
for (const file of ['local-pages.js','storage.js','energy-cost.js','readings.js','tariffs.js']) {
  const source = await readFile(new URL('../public/'+file,import.meta.url),'utf8');
  new SourceTextModule(source);
  assert.doesNotMatch(source,/fetch\s*\(|\/api\/|mountTuya/);
}
assert.doesNotMatch(html,/fetch\s*\(|\/api\/|mountTuya|connect-tuya/);
console.log('OK: cadastro, edição, exclusão, duplicatas, validação, tarifas, conversão, backup, falhas de armazenamento e sintaxe.');
