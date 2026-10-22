# Configuração de desenvolvedor: Tuya / Smart Life

## Administrador local

1. Crie sua conta local em http://127.0.0.1:5173. Com a sessão aberta, consulte `/api/auth/me` e copie o campo `id` da sua própria conta.
2. No `.dev.vars`, ao lado de `package.json`, configure `LOCAL_ADMIN_USER_ID` com esse ID. Reinicie `pnpm dev`.
3. Acesse http://127.0.0.1:5173/admin/tuya. Essa página e `/api/admin/tuya` verificam o administrador no servidor. Registro comum, campos no navegador e cabeçalhos enviados pelo cliente não concedem esse papel.

O usuário final não vê campos de Access ID/Secret, endpoint, UID ou instruções sobre arquivos de configuração. O administrador mantém esses valores no arquivo privado do servidor; a página administrativa mostra somente presença/ausência da configuração e diagnóstico, nunca segredos.

## Habilitar autorização do usuário na Tuya

Na Tuya Developer Platform, abra o projeto Smart Home, vá a **Devices → Link App Account → Configure OAuth 2.0 Authorization**, habilite o aplicativo desejado e configure região e callback. Use a chave específica de **Authorization → App Authorization**, conforme a [documentação oficial de OAuth](https://developer.tuya.com/en/docs/iot/authorization-code-page-usage?id=Kdkyz44dz6a7r).

Cadastre este callback exatamente e use a mesma origem para entrar no sistema:

```text
http://127.0.0.1:5173/api/integrations/tuya/callback
```

Copie a URL H5 de autorização fornecida pela plataforma, preservando os parâmetros do aplicativo. Não use a URL de login da Developer Platform: endereços dessa plataforma e URLs contendo segredos são rejeitados. O servidor acrescenta `client_id`, `redirect_uri`, `response_type=code` e um `state` aleatório, preservando também rotas H5 com fragmento quando fornecidas. O retorno deve preservar `state`; respostas sem estado válido são rejeitadas.

**Verifique na Tuya se seu projeto/serviço permite o callback HTTP de loopback.** Se a plataforma exigir HTTPS ou não autorizar esse retorno local, será necessário habilitar um retorno local aceito por ela antes do teste completo. O código não publica servidor nem cria túnel para contornar essa restrição. A disponibilidade do OAuth para o app escolhido também depende da habilitação na plataforma.

## Arquivo privado do servidor

Configure em `.dev.vars` (já ignorado pelo Git):

| Variável | Origem/finalidade |
| --- | --- |
| `LOCAL_ADMIN_USER_ID` | ID da sua conta local, obtido em `/api/auth/me` |
| `TUYA_OAUTH_CLIENT_ID` | Client ID da chave específica de App Authorization |
| `TUYA_OAUTH_CLIENT_SECRET` | Secret dessa mesma chave |
| `TUYA_OAUTH_IDENTIFIER` | Bundle Identifier configurado; para Android, SHA1 concatenado com Application ID, sem separador |
| `TUYA_OAUTH_AUTHORIZE_URL` | URL H5 oficial fornecida na configuração OAuth |
| `TUYA_OAUTH_REDIRECT_URI` | Callback local acima, idêntico ao autorizado na Tuya |
| `TUYA_ENDPOINT` | Endpoint do centro de dados do projeto e dos usuários |
| `TUYA_TOKEN_KEY` | Chave aleatória de 32 bytes, representada por 64 caracteres hexadecimais |

O identificador usado na assinatura segue a [assinatura oficial de App Authorization](https://developer.tuya.com/en/docs/iot/new-app-singnature?id=Kdnqza5d7iwkc). O Client ID público faz parte do redirecionamento OAuth exigido pelo provedor; o usuário não precisa copiá-lo ou configurá-lo. Secret, chave de cifragem e tokens nunca são enviados ao navegador.

Endpoints aceitos: `https://openapi.tuyaus.com`, `https://openapi-ueaz.tuyaus.com`, `https://openapi.tuyaeu.com`, `https://openapi-weaz.tuyaeu.com`, `https://openapi.tuyacn.com`, `https://openapi.tuyain.com`. Uma instalação usa um centro de dados; não direciona automaticamente contas de outra região.

Para gerar a chave sem mostrá-la no terminal, execute **uma vez**, na pasta do projeto:

```powershell
node -e "const fs=require('node:fs'); const p='.dev.vars'; const s=fs.existsSync(p)?fs.readFileSync(p,'utf8'):''; if(/^TUYA_TOKEN_KEY=/m.test(s)) throw new Error('A chave ja existe; preserve-a.'); fs.appendFileSync(p,'\nTUYA_TOKEN_KEY='+require('node:crypto').randomBytes(32).toString('hex')+'\n');"
```

Preserve essa chave junto do backup privado: os tokens OAuth são cifrados com AES-GCM no D1, vinculados ao usuário local. Sem a chave correta será necessário autorizar novamente. O UID Tuya é obtido da resposta oficial de autorização, sem ser solicitado ao usuário final. Cada conta fica isolada; a mesma conta Tuya não pode ser atribuída silenciosamente a dois usuários.

Autorize os serviços de tokens, dispositivos, especificações, status e logs no projeto. Plano e permissões da Tuya determinam a disponibilidade dos dados. Tokens expirados são renovados no backend usando o refresh token, também cifrado.

## Coleta a cada 12 horas

Execute `pnpm dev`: as migrações são aplicadas e o coletor é ativado automaticamente. O backend usa um alarme local persistente, verifica agendas a cada minuto e consulta cada conta vencida a cada 12 horas. A próxima execução, última tentativa e última coleta concluída ficam no D1. A tela mostra essas datas ao carregar/voltar para a página.

O navegador pode estar fechado. **O computador precisa estar ligado, sem suspensão, e `pnpm dev` deve continuar executando.** Após reiniciar, agendas vencidas são retomadas; não há coleta enquanto o servidor está parado. Depois de editar código, reinicie o servidor: o Wrangler possui uma [limitação de alarmes após hot reload](https://developers.cloudflare.com/durable-objects/platform/known-issues/).

A coleta manual continua disponível. Nova autorização/associação e o botão administrativo de teste solicitam uma execução antecipada; depois dela o próximo intervalo é de 12 horas. Falhas mantêm a última data de sucesso e exibem um aviso, sem inventar consumo. Dados e alarmes usam `.wrangler/local-state`, separados do ambiente hospedado.

## Como testar

1. Pare o servidor antigo com Ctrl+C e execute `pnpm dev`. Abra `/admin/tuya` com a conta administradora e confira `oauthReady: true` e o diagnóstico do coletor.
2. Em outra sessão, entre como usuário comum. `/admin/tuya` e `/api/admin/tuya` devem negar acesso. Em **Dispositivos inteligentes**, deve haver apenas o fluxo de conexão, autorização e dados, sem configuração de credenciais.
3. Clique **Conectar Tuya/Smart Life**, entre e autorize na página oficial. O retorno é automático: o painel de dispositivos abre, lista os aparelhos autorizados e consulta seus dados reais. Salve as associações de ambiente/circuito. Se um aparelho não disponibilizar métricas, elas continuam indisponíveis; falhas individuais não escondem os demais aparelhos.
4. No administrador, clique **Solicitar coleta agora no backend** e feche todas as páginas. Aguarde até um minuto, mantendo o servidor ligado. Reabra: confira última tentativa, última atualização e registros reais. A próxima coleta deve estar programada para 12 horas depois da tentativa.
5. Reinicie o servidor e confira que vínculo, associações, datas e energia continuam salvos. Contadores acumulados precisam de referência e de uma leitura posterior; eventos incrementais são deduplicados. A primeira leitura não fabrica um consumo anterior.
6. Execute `pnpm test:local` para testar isolamento, bloqueio administrativo, início OAuth, hash/isolamento do estado, cancelamento, replay rejeitado, alarme sem navegador, intervalo de 12 horas, persistência e regressões. As configurações temporárias dos testes não pertencem a nenhuma conta remota; verificam o protocolo local sem efetuar uma troca de código nem simular autorização ou sucesso na nuvem.

## Preservação e limites

- Vínculos antigos já salvos continuam funcionando com `TUYA_CLIENT_ID`, `TUYA_CLIENT_SECRET`, `TUYA_USER_ID` e `TUYA_APP_UID`, privados no servidor. Novas autorizações usam OAuth. As tabelas de medições e associações anteriores são preservadas.
- Migração D1 `0005_tuya_oauth_collection.sql`: tokens cifrados, estados temporários e agenda. O binding local `TUYA_COLLECTOR` guarda o alarme persistente; não exige deploy.
- Conversões, tarifas, filtros e regras de consumo permanecem iguais. Contadores acumulados não distribuem intervalos que atravessam dias; nesses casos há nova referência. Eventos incrementais consultam até sete dias disponíveis desde a associação/última coleta, sujeitos à retenção e ao limite existente de páginas. Portanto coleta a cada 12 horas não garante reconstruir energia que o aparelho/API não disponibiliza.
- Sem métrica de energia reconhecida, nenhuma energia é inventada. Logs negados não são substituídos por soma de snapshots.
- Autorização e dados reais na Tuya só podem ser validados com credenciais, permissões e aparelhos reais. Os testes locais não comprovam consentimento da plataforma nem compatibilidade do callback com seu projeto.
