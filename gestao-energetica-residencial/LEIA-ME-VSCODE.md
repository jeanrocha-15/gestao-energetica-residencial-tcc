# Desenvolvimento local no Windows / VS Code

Abra no VS Code a pasta `gestao-energetica-residencial` (a que contém `package.json`). Ambiente: Node.js 22.23.3 e pnpm 11.25.0.

## Instalação e início

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` aplica as migrações pendentes e inicia o Wrangler/Workerd **somente local**, sem Vinext e sem autenticação do ChatGPT Sites. Não exige login Cloudflare. `pnpm dev:local` é equivalente.

Abra **http://127.0.0.1:5173** (ou http://localhost:5173). Mantenha o mesmo endereço, pois os cookies de cada hostname são separados.

Na primeira visita, clique em **Criar conta local**, usando um e-mail identificador e senha de pelo menos 8 caracteres. Não há credenciais padrão nem envio de e-mail. Nas próximas visitas, use **Entrar**. A sessão dura sete dias e sobrevive ao reinício. Em Configurações, use **Sair da conta local**. Cada conta possui medições e tarifas próprias; não acessa a conta ChatGPT.

## Banco e migrações

O D1 é emulado localmente pelo Workerd e acessado pelo binding `DB`; o CRUD de tarifas usa Drizzle. O banco fica em `.wrangler/local-state/v3/d1/`.

Essa pasta é ignorada pelo Git, separada do banco hospedado e do estado antigo `.wrangler/state`. Os dados antigos não são apagados, copiados nem atribuídos automaticamente a contas novas. A identidade antiga de teste `local_seedy` não é usada pelas novas contas.

Migração inicial ou atualização manual, sem iniciar o servidor:

```powershell
pnpm db:migrate
```

São aplicadas em ordem, uma vez por banco:

- `0000_huge_charles_xavier.sql`: medições manuais e índice de duplicatas.
- `0001_tuya.sql`: contadores, medições automáticas e bloqueios.
- `0002_tariffs_local_auth.sql`: tarifas por usuário/vigência, proteção de sobreposição e contas/sessões locais.

Não repita esses arquivos com `d1 execute --file`: `d1_migrations` controla o que foi aplicado. Não use `--remote`. A migração `0002` não altera as tabelas de medições existentes.

Para backup, pare o servidor e copie **toda** a pasta `.wrangler/local-state`. Não a apague: ela contém dados e contas. Os snapshots Drizzle descrevem o esquema; os triggers de sobreposição permanecem no SQL customizado.

## Páginas

- `/`: indicadores e composição do custo estimado.
- `/medicoes`: cadastro, edição, exclusão e registros automáticos.
- `/historico`: gráfico, energia/custo, barras/linha e períodos 7/30/90 dias.
- `/comparacao`: comparação e detalhamento por cômodo/circuito.
- `/tarifas`: tarifas e histórico de vigências.
- `/configuracoes`: conta local, fórmula e integração Tuya.

O menu permanece montado durante a navegação. Links diretos e Voltar funcionam. Em telas menores, o menu fica no topo. Filtros permanecem durante a navegação; recarregar a página os reinicializa. Dias sem registros não entram como zero na média.

## Tarifas e bandeiras

Em **Tarifas → Cadastrar tarifa**, informe início e fim (inclusivos), TE/TUSD em R$/kWh, PIS/COFINS/ICMS em %, bandeira e adicional. Todos os valores são editáveis, inclusive zero; não são preenchidos valores regulatórios.

O adicional pode ser em R$/kWh ou R$/100 kWh. Na segunda unidade, divide-se por 100. Outros componentes são opcionais: uma linha `Nome;valor` em R$/kWh. Confirme o modelo da estimativa antes de salvar.

Para reajustar ou trocar bandeira sem sobrescrever a anterior, use **Nova vigência / bandeira**. A cópia preserva componentes, sugere o dia seguinte ao término anterior e exige novo fim. Altere a bandeira/adicional. Para antecipar uma troca, encerre a vigência anterior no dia imediatamente anterior à nova. Sobreposições são rejeitadas inclusive em gravações concorrentes.

**Editar** corrige explicitamente a configuração selecionada e recalcula estimativas do intervalo. **Excluir** remove a configuração após confirmação, deixando o período sem custo calculável. Para reajustes, sempre crie nova vigência. Tarifa e bandeira compartilham o intervalo; uma mudança apenas de bandeira também cria nova vigência.

Fórmula por data, tributos **por fora**:

```text
adicional_por_kWh = adicional / 100 (quando informado por 100 kWh)
TE = kWh × TE_unitária
TUSD = kWh × TUSD_unitária
Bandeira = kWh × adicional_por_kWh
Outros = kWh × soma dos componentes adicionais unitários
Base = TE + TUSD + Bandeira + Outros
PIS = Base × PIS_percentual / 100
COFINS = Base × COFINS_percentual / 100
ICMS = Base × ICMS_percentual / 100
Total estimado = Base + PIS + COFINS + ICMS
```

Cada data usa sua vigência antes de somar períodos/semanas. O arredondamento ocorre na apresentação monetária. Se alguma data com consumo não tiver tarifa, total e gráfico de custo ficam indisponíveis com aviso; consumo continua visível. A demonstração também precisa de tarifas que cubram suas datas: 30/06/2026 a 27/09/2026.

É uma estimativa acadêmica: não reproduz tributos por dentro, isenções, cobranças mínimas, iluminação pública e todas as regras da concessionária.

## Parar, reiniciar e verificar

No terminal, pressione `Ctrl+C`. Reinicie com `pnpm dev`; dados e migrações são mantidos.

```powershell
pnpm typecheck
pnpm build
pnpm test:local
```

`build` gera `dist/local` usando `wrangler deploy --dry-run`: apesar do nome do comando, **dry-run não publica nada**. Não existe script de publicação neste fluxo.

`test:local` usa porta 5174 e `.wrangler/test-state`, cria contas aleatórias, verifica APIs/DOM e reinicia somente seu servidor de teste. Não altera o banco da porta 5173. O DOM de teste não substitui inspeção visual em navegador.

## Erros comuns

- **ECONNRESET após “vinext dev / Sites local sign-in”**: comando antigo. Confira `dev` no `package.json`: deve ser `node scripts/local.mjs dev`. Encerre os terminais antigos. A inicialização atual não usa Vinext nem Sites.
- **Porta 5173 ocupada / página antiga**: pare o servidor anterior no terminal dele. `Get-NetTCPConnection -LocalPort 5173` identifica processos; não encerre processos desconhecidos. Reinicie e abra `127.0.0.1:5173`.
- **Sem tabela / erro D1**: pare, execute `pnpm db:migrate` e reinicie. Use sempre `wrangler.local.json` com `.wrangler/local-state`.
- **401 / sessão expirada**: entre em `/login`. Não alterne entre `localhost` e `127.0.0.1`.
- **Vigência conflitante**: limites inclusivos; a nova configuração começa no dia seguinte ao fim anterior.
- **Sem tarifa**: cadastre vigências para as datas filtradas. Não há fallback para R$ 0,92.
- **Falha de download**: confira rede e versões, repita `pnpm install --frozen-lockfile`. Não apague banco ou lockfile para resolver rede.
- **Tuya não configurada**: medições manuais continuam funcionando. Credenciais somente em `.dev.vars`, nunca no HTML; consulte `INTEGRACAO-TUYA.md`.

Referência: [desenvolvimento local D1](https://developers.cloudflare.com/d1/best-practices/local-development/). Nenhum comando deste guia usa banco remoto ou publica o projeto.
