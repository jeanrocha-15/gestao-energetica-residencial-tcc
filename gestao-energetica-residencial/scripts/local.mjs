import './sites-env.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const common = ['--config', 'wrangler.local.json'];
const persistence = ['--persist-to', '.wrangler/local-state'];

/** Executa o Wrangler instalado, transmitindo erros e encerramento ao terminal do VS Code. */
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
    // Este sinal inicial arma o backend sem abrir navegador; não é um temporizador de coleta.
    const startup=args[0]==='dev'?setInterval(async()=>{
      try { const response=await fetch('http://127.0.0.1:5173/login',{signal:AbortSignal.timeout(1000)}); if(response.ok) clearInterval(startup); } catch { /* Aguarda o compilador iniciar o servidor. */ }
    },1500):undefined;
    child.on('error', error=>{clearInterval(startup);reject(error);});
    child.on('exit', code => {clearInterval(startup);if(code===0) resolve();else reject(new Error(`Wrangler terminou com código ${code}.`));});
  });
}

// O comando não possui opção remota: migrações e execução usam a mesma pasta local.
const command = process.argv[2] || 'dev';
if (!['dev', 'migrate', 'build'].includes(command)) throw new Error('Use dev, migrate ou build.');
if (command === 'build') {
  await run(['deploy', '--dry-run', '--outdir', 'dist/local', ...common]);
} else {
  await run(['d1', 'migrations', 'apply', 'DB', '--local', ...common, ...persistence]);
  if (command === 'dev') await run(['dev', '--local', '--ip', '127.0.0.1', '--port', '5173', ...common, ...persistence]);
}
