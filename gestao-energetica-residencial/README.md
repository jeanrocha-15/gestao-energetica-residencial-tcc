# Gestão Energética Residencial

Dashboard privado do TCC, com dados demonstrativos e cadastro manual persistente de consumo diário em kWh.

As medições são vinculadas ao usuário autenticado e armazenadas em D1. O formulário permite cadastrar, editar e excluir registros. O dashboard separa os registros manuais da demonstração e calcula médias somente sobre dias com medições.

Execução somente local: `pnpm dev`, em http://127.0.0.1:5173. O comando aplica as migrações no D1 local e inicia o servidor. Crie uma conta local em `/login`. Consulte [LEIA-ME-VSCODE.md](LEIA-ME-VSCODE.md).

Tarifas configuráveis em `/tarifas`, com TE, TUSD, tributos, outros componentes e bandeira por vigência. Não há tarifa padrão. Custos são estimativas pelo modelo explícito de tributos por fora. Um circuito compartilhado pode ser cadastrado sem atribuir seu consumo a um cômodo específico.

A integração Tuya / Smart Life permite coletar diferenças de contadores acumulados automaticamente. Consulte [INTEGRACAO-TUYA.md](INTEGRACAO-TUYA.md) para configurar credenciais, migração obrigatória e agendamento. Os totais automáticos representam intervalos monitorados e podem ser parciais.
