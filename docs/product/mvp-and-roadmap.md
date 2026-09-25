# MVP, roadmap e critérios de corte

## MVP operacional

O primeiro piloto que poderá executar parte real da operação GP deve incluir: login e RBAC por organização/unidade; aluno 360; matrícula com pacote versionado/contrato; processo e workflow versionado; tarefas; agenda com instrutor/veículo e prevenção de conflito; créditos por ledger; recebíveis e pagamento básico conciliável; documentos essenciais; auditoria; relatórios operacionais de alunos por etapa, aulas e financeiro. A fundação v0.1 deste ZIP **ainda não é esse MVP**.

**Aceite do MVP:** demonstrar fluxos ponta a ponta com equipe de Ponte Rasa, Penha e Mooca; impedir reserva simultânea do mesmo aluno/instrutor/veículo sob carga; reconciliar créditos e financeiro por amostra e total; registrar autoria de transições; verificar separação de unidade; restaurar backup; medir p95; validar regras reais de pacotes/cancelamento; operar em paralelo com o legado antes do corte. Todas as contas abertas e agenda futura migradas devem ser conferidas.

## Marcos

| Fase | Entrega verificável | Dependências |
|---|---|---|
| F0 Fundação | API modular, autenticação, organizações/unidades, RBAC, auditoria, CI, migrações, ambientes | nenhuma |
| F1 Aluno/processo | Pessoa, Aluno 360, pacote versão, matrícula, workflow, tarefa | F0 |
| F2 Financeiro/créditos | Recebíveis, alocação de pagamento, journal, wallet, bloqueios configuráveis | F1 |
| F3 Agenda | Recursos, disponibilidade, reserva concorrente, cancelamento, avaliação | F1+F2 |
| F4 Jornada completa | Teórico, exames, documentos, comunicações, relatórios | F1–F3 |
| F5 Automação | Workers/adapters, filas, evidências e handoff | F1+F4 |
| F6 Fiscal e apps | NFS-e, gateways, aluno/instrutor mobile | F2–F5 |
| F7 Otimização | IA assistiva, sugestão de agenda, BI avançado | dados e operação validados |

**Fronteira de escopo:** detecção de estados oficiais, regras legais e políticas financeiras mudam; workflow JSON de exemplo não autoriza automação ou atendimento a órgão público. Todos os workflows de produção são publicados depois de validação com equipe e fontes oficiais.
