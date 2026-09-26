# Rastreamento da origem e estado de implementação

Fonte principal: `Especificacao_GP_CFC_v0.1.docx` de 24/09/2026 (arquitetura, domínios, roadmap e requisitos). Fonte secundária: `Blueprint_Funcional_InforCFC_v1.md` (cobertura funcional observada). Os dois são referências de análise, não dependências de build nem fontes de código reutilizado.

| Artefato | Estado desta entrega | Próxima validação |
|---|---|---|
| SQL 001–006 | DDL inicial + identidade OIDC/index de aluno escritos; execução em PostgreSQL local indisponível nesta sessão | rodar migrations em Docker/CI, revisar constraints |
| Seed | dados fictícios de três unidades | reexecução no Postgres |
| API TypeScript | health/meta, cadastro e leitura de alunos com JWT OIDC, membership, idempotência, outbox e auditoria | executar teste integrado em PostgreSQL/Keycloak; ampliar aluno 360; NestJS pendente |
| OpenAPI | endpoints de aluno marcados como implementados; outras rotas planejadas | validar contrato completo e responses no ambiente integrado |
| Evento JSON Schema | envelope + 3 payloads | produtor/consumidor, compatibilidade e registry |
| Workflow/agenda/ledgers | regras e exemplos; sem endpoint de escrita | testes transacionais e operação piloto |
| Desktop/web/mobile/worker | fronteiras e UX documentados | implementação futura |

Não concluir produção, migração do InforCFC ou conformidade regulatória com este pack isolado. Decisões operacionais devem ser validadas com a GP e atualizadas por ADR/versionamento.

## Continuação v0.2 — 25/09/2026

Foi incluído lockfile, provedor de desenvolvimento configurado, verificação de assinatura e claims OIDC, vínculo imutável issuer/subject, cadastro transacional com CPF opcional, idempotência concorrente, lista cursor, consulta por ID, auditoria e outbox. Oito testes locais e typecheck passaram. O CI executa migrations e teste de isolamento/idempotência em PostgreSQL; **essa execução integrada ainda não foi observada neste ambiente**. Sprint 0 permanece aberta (NestJS, staging, restore, rate limit e secret scan). Sprint 1 permanece aberta (catálogo, matrícula, processo, UX).

## Validação local v0.3 — 25/09/2026

No Mac, Node 26.7.0/npm 11.19.0 e Docker 29.1.5/Compose 5.0.1 foram verificados. A pasta recebida não tem `.git` nem remoto. PostgreSQL de desenvolvimento precisou da porta 55432 porque a 5432 já estava ocupada por um PostgreSQL local. O Compose foi atualizado para S3Mock porque as imagens MinIO configuradas não estavam acessíveis. PostgreSQL, Redis, Keycloak e S3Mock subiram. As migrations 001–010, o seed sintético, typecheck e testes locais foram executados; a suíte integrada rodou em `gpcfc_test` e em `gpcfc_fresh_test` migrado do zero. Login e fluxo HTTP completo com token Keycloak local passaram. O cursor de alunos foi corrigido para preservar microssegundos do timestamp.

Implementado nesta fatia: draft/publicação e imutabilidade de pacote versionado, snapshot da matrícula, ativação transacional com workflow publicado, etapas/tarefas, transições com pré-condições e concorrência, auditoria/outbox e primeira tela web com PKCE. O workflow e os preços do seed são fictícios; `demoActivationConfirmed` é apenas um marcador de desenvolvimento, sem assinatura/documento, e a ativação está bloqueada em produção. Testes de integração cobrem isolamento, rollback, snapshot e dupla transição. CI remoto, staging, observabilidade, dispatcher de outbox, busca/Aluno 360 completo, contrato real e critérios de performance do piloto não foram verificados.

## Continuação v0.4 — 25/09/2026

A migration 011 vincula novos pacotes à unidade e preserva pacotes anteriores como compartilhados; somente gerente autorizado pode alterar rascunho compartilhado. Matrícula de outra unidade é rejeitada pela API e por trigger no PostgreSQL. Cadastro aceita telefone fictício, e busca por nome, CPF exato ou trecho de telefone usa JSON no corpo para manter documento fora da URL. O detalhe do aluno mostra contatos; a linha do tempo paginada lê auditoria de aluno, matrícula e processo, filtrada por unidade autorizada. A tela local recebeu busca, contato e eventos. Migrations em desenvolvimento e no banco `_test`, testes integrados, suíte local, smoke com token e interação visual no navegador passaram. Permanecem pendentes contrato/assinatura real, regras operacionais, agenda, créditos/financeiro, documentos, relatórios, outbox dispatcher, CI remoto, staging e medição p95.

## Git local e revisão de interface — 25/09/2026

Foi criado o repositório Git local na branch `main`, sem remoto. `.env`, dependências instaladas e o dossiê de referências `GP_CFC_CONTEXT/` foram excluídos do versionamento. A interface passou a separar atendimento de catálogo; cadastro de aluno e pacote fica em diálogos, a busca e o aluno selecionado são o foco da tela, e a lista e a linha do tempo oferecem paginação. Uma checagem automatizada valida a sintaxe do JavaScript inline e os IDs HTML usados pelo controlador. O fluxo foi conferido no navegador com dados fictícios. A decisão de ambiente permanece local: publicação remota, execução de CI e staging ainda exigem infraestrutura da GP.

## Continuação v0.5 — 26/09/2026

A branch `main` local foi publicada em `zionLab7/appCFC`, repositório público indicado pelo usuário; `.env`, dependências e o dossiê histórico permanecem fora do Git. A migration 012 define `task.read` e índice da fila. `GET /tasks` consulta tarefas por unidade, vencimento e responsável com cursor; tarefas de etapa passam a gerar eventos e auditoria na abertura e no fechamento, na mesma transação do processo. A interface ganhou uma área de tarefas que abre o processo do aluno. Testes locais e integrados no banco `_test`, smoke autenticado e navegação visual passaram. Ainda não houve aceite dos critérios operacionais do MVP; CI remoto e staging devem ser verificados separadamente.
