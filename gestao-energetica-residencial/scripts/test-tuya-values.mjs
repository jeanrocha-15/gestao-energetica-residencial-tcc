import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Testa somente matemática e sanitização; não substitui a API Tuya por respostas fictícias.
const source=readFileSync(new URL('../lib/tuya-values.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {decodePoint,decodePoints,numericValue,counterDelta,unitConversion}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
/** Monta especificações de entrada exclusivamente para testar conversões aritméticas isoladas. */
function point(unit,scale,raw) { return decodePoint({code:'medicao',type:'Integer',values:JSON.stringify({unit,scale})},raw); }
assert.equal(point('Wh',1,1250).normalized,0.125);
assert.equal(point('kWh',3,'1250').normalized,1.25);
assert.equal(point('W',1,1250).normalized,125);
assert.equal(point('V',1,2300).normalized,230);
assert.equal(point('mA',0,1250).normalized,1.25);
assert.equal(unitConversion('mW').factor,0.001);
assert.equal(unitConversion('MW').factor,1000000);
assert.equal(unitConversion('mWh').factor,0.000001);
assert.equal(unitConversion('MWh').factor,1000);
assert.equal(unitConversion('mwh'),null);
for (const raw of [null,undefined,'',true,{},NaN,Infinity]) assert.equal(numericValue(raw),null);
assert.equal(point('kWh',undefined,10).normalized,null);
assert.equal(point('kWh',0,null).normalized,null);
assert.equal(point('unknown',0,10).normalized,null);
assert.equal(decodePoint({code:'local_key',type:'Integer',values:'{"scale":0}'},123).raw,null);
assert.equal(decodePoints([],[{code:'phase_a',value:'encoded'}])[0].value,null);
assert.deepEqual(counterDelta(null,500,'2026-09-29','a'),{continuous:false,delta:0});
assert.deepEqual(counterDelta({total:500,date:'2026-09-29',mapping:'a'},501.5,'2026-09-29','a'),{continuous:true,delta:1.5});
assert.equal(counterDelta({total:500,date:'2026-09-28',mapping:'a'},501.5,'2026-09-29','a').delta,0);
assert.equal(counterDelta({total:500,date:'2026-09-29',mapping:'a'},1,'2026-09-29','a').delta,0);
assert.equal(counterDelta({total:500,date:'2026-09-29',mapping:'a'},501,'2026-09-29','b').delta,0);
console.log('OK: conversões, unidades SI, ausência de métricas, sanitização e diferenças de contadores. Nenhuma API remota simulada.');

// Verifica montagem e validação de URLs sem abrir páginas nem substituir respostas da Tuya.
const urlSource=readFileSync(new URL('../lib/tuya-oauth-url.ts',import.meta.url),'utf8');
const urlCompiled=ts.transpileModule(urlSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {authorizationPage,authorizationAddress}=await import('data:text/javascript;base64,'+Buffer.from(urlCompiled).toString('base64'));
for (const unsafe of ['http://auth.tuya.com/','https://tuya.com.invalid.test/','https://iot.tuya.com/','https://platform.tuya.com/','https://auth.tuya.com/?client_secret=invalid','https://auth.tuya.com/#/login?access_token=invalid']) assert.throws(()=>authorizationPage(unsafe));
const address=new URL(authorizationAddress('https://auth.tuya.com/#/login?app_schema=test','public-client','http://127.0.0.1:5173/api/integrations/tuya/callback','random-state'));
assert.equal(address.searchParams.get('state'),'random-state');
const fragment=new URLSearchParams(address.hash.split('?')[1]);
assert.equal(fragment.get('app_schema'),'test');assert.equal(fragment.get('state'),'random-state');
console.log('OK: URL de consumidor preserva o aplicativo e rejeita Developer Platform, destinos externos e segredos.');
