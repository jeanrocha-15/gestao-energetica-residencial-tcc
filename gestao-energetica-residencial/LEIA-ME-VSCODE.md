# Gestão Energética Residencial

Versão estática com medições manuais e persistência no navegador. Consulte o [guia completo](../README.md) para executar, publicar no GitHub Pages e exportar backups.

Nesta pasta: `npm run build`, `npm test` e `npm run dev`. Nenhuma dependência é necessária para esses comandos com Node.js 22+.

Edite `app/dashboard.html` e os módulos de `public/`. O build gera `docs/` na raiz do repositório. Acesse http://127.0.0.1:5175/gestao-energetica-residencial-tcc/.

Medições e tarifas ficam somente no navegador. Use Configurações para exportar/importar backups. Os dados antigos em `.wrangler` são preservados, mas não são usados nem publicados pela versão estática.
