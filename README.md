# Gestão Energética Residencial — TCC

Painel estático com cadastro exclusivamente manual de consumo diário em kWh, histórico, comparação por cômodo/circuito e estimativas de custo por vigência tarifária.

Site: https://jeanrocha-15.github.io/gestao-energetica-residencial-tcc/

## Dados e privacidade

Medições e tarifas são salvas em `localStorage`, somente no navegador e dispositivo utilizados. Não há login, banco remoto, credenciais ou coleta automática. Os registros não são enviados ao GitHub. Limpar os dados do site ou usar modo privado pode apagar registros. Em Configurações, exporte backups JSON regularmente; a importação valida o conteúdo e pede confirmação antes de substituir os dados atuais.

O banco da versão antiga em `.wrangler/local-state` é preservado localmente e não é publicado nem migrado automaticamente. Localhost e o site público têm armazenamentos independentes.

## Executar e publicar

Requer Node.js 22+. Não é necessário instalar dependências para a versão estática.

```sh
npm run build
npm test
npm run dev
```

Abra http://127.0.0.1:5175/gestao-energetica-residencial-tcc/.

Fontes: `gestao-energetica-residencial/app/dashboard.html` e `gestao-energetica-residencial/public/`. O build copia somente os arquivos públicos para `docs/`. Após editar, execute build e testes, faça commit incluindo `docs/` e envie para `main`. O GitHub Pages deve usar Deploy from a branch → main → /docs. As rotas usam `#/medicoes`, `#/tarifas` etc., permitindo atualizar a página sem erros 404.

## Modelo de energia e custos

Informe a energia consumida no dia; em medidores acumulativos, subtraia a leitura inicial da final. Não some a mesma energia em um circuito e nos equipamentos atendidos por ele. Dias sem leitura não entram na média como zero.

O adicional em R$/100 kWh é dividido por 100. Base = kWh × (TE + TUSD + adicional por kWh + outros). PIS, COFINS e ICMS são calculados separadamente por fora sobre essa base. A estimativa não substitui a fatura. Não há tarifa padrão: períodos sem vigência válida ficam sem custo estimado. Vigências sobrepostas e medições duplicadas são rejeitadas.
