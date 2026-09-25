# Workflow, agenda, financeiro e automação

## Workflow Engine

Fonte: definição/versionamento publicado; `process.workflow_version_id` fica fixo. Passos têm código, estágio, ordem, pré-condições tipadas, ações, papel, prazo e conclusão. Exemplo em `packages/workflows/sp-first-b.v1.json` é **ilustrativo e não validação regulatória oficial**. `TransitionProcess` abre transação, bloqueia `process_step`, verifica papel, unidade, versão, estado esperado e pré-condições; aplica estado e `process_transition`, emite `audit_event` + `outbox_event`; em consequência cria tarefas e job, mas worker só devolve resultado normalizado e o domínio decide a próxima transição. Não avaliar JavaScript arbitrário do banco. Publicar v2 cria nova versão; processos antigos seguem v1 até migração explícita.

## Scheduling Engine

`suggest`: interseção de horários aluno/instrutor/veículo/unidade, categoria, bloqueios, SLA e preferências; ordenar por janela desejada, continuidade e ociosidade. Sugestão é provisória. `book` exige `Idempotency-Key`: transação, `SELECT ... FOR UPDATE` no wallet, permissão e estado do processo, validade da categoria/recursos, janela legal/configurada, sobreposição e ausência de bloqueio; insere lesson + duas resource_booking + credit_reservation + auditoria/outbox e commit. As duas exclusion constraints PostgreSQL são o último bloqueio concorrente; mapear SQLSTATE `23P01` para HTTP 409 `SLOT_TAKEN`. Falha desfaz tudo. Ordenar locks por UUID; não segurar transação durante chamada de portal. Cancelamento libera bookings/hold conforme regra versionada; conclusão converte hold em consumo único. `resource_block` criado após aula futura gera tarefa de remanejamento, não alteração silenciosa.

## Credit Ledger

Concessão `GRANT +N`; agendamento cria hold (não altera ledger); aula válida conclui hold e registra `CONSUME -1`; cancelamento dentro da política libera hold; falta cobrável registra consumo; reposição `RESTORE +N` com referência ao evento anterior. Disponível = soma de entradas − holds. Cada comando trava wallet, valida ≥0, grava idempotentemente por fonte; não permite saldo negativo. O modelo não autoriza débito direto em ledger sem o serviço de domínio. Reversão sempre lança outra entrada identificando origem.

## Financeiro

Matrícula cria receivable/installments conforme preço e condição; `ReceivePayment` verifica permissão, valor, moeda e limite de parcelas sob lock; cria payment/allocations; lança journal `Dr Caixa/PSP; Cr Contas a receber` no mesmo commit; emite evento. Duas linhas ou mais, soma de débito = soma de crédito. Estorno integral/parcial usa `payment_refund` e `payment_allocation_reversal`, com journal inverso; o serviço ainda precisa validar cumulativos de estorno e tratar gateway e comprovante, portanto **não expor endpoint de refund até os testes de integração**. Conciliação vincula transação bancária por ID único e quantia/data, sempre com revisão de ambiguidades. Contas a pagar e caixa são estruturas iniciais, sem serviços operacionais.

## Regulatory Automation

`request` grava job/outbox. Dispatcher escolhe adapter por `(provider,operation)`, claim com lock/lease, credencial via secret manager, timeout, rate limit, tentativa. Resultados normalizados `{status,code,observedAt,externalReference,evidenceRef}`; erros: transitório → retry exponencial com jitter, autenticação/captcha/2FA → `WAITING_HUMAN`, permanente → fila humana. Worker não escreve tabelas de processo, financeiro ou aluno. Evidências em storage privado com retenção e auditoria. Operações oficiais dependem de disponibilidade, autorização e testes contratuais reais; nenhuma está implementada aqui.
