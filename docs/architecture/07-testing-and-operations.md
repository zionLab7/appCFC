# Testes, operação e migração

## Pirâmide e gates

Testes de domínio: workflow, créditos, política de cancelamento, janelas e moeda. Integração com PostgreSQL real: constraints de sobreposição sob concorrência, FKs por organização, journal desbalanceado, crédito sob duas requisições simultâneas, alocação de pagamento, duplicidade por Idempotency-Key. Contrato: validar OpenAPI e schemas de eventos; adapters com fixtures aprovadas e sem contato com portais no CI. E2E: lead → orçamento → matrícula → processo; cobrança → recebimento; compra → hold → aula → consumo; estorno; permissão por unidade; job com retry e handoff humano. Carga: p95 em cenário realista, 10 instrutores/3 unidades no piloto, escala posterior.

O comando `npm test` neste pacote executa somente testes de domínio e checagens de presença de contrato. Integração Postgres, E2E e carga são tarefas futuras listadas no Sprint 1 e backlog; **não foram executadas**.

## Migração do legado

Exportar por meios autorizados, mapear dados para staging, guardar `legacy_system` e `legacy_id` em tabela de mapeamento a criar, normalizar CPF/telefone, validar contagens e hashes, conciliar matrículas abertas, créditos, aulas futuras e financeiro por unidade, executar dry run, delta e dupla operação. Critério de corte: nenhuma aula dupla, saldo reconciliado, backups restaurados, equipe treinada, rollback operacional documentado. Não reutilizar código decompilado, secrets ou integrações internas não autorizadas.

## Riscos e decisões pendentes

- Regras oficiais do processo CNH e de automação variam por órgão/serviço; conferir antes de publicar workflow operacional.
- Política exata de crédito, reposição, falta, cancelamento e financeiro será validada com operação GP e assessoria antes do primeiro piloto.
- Escolher gateway, NFS-e, assinatura eletrônica e provedor de mensagens mediante contratos/credenciais próprios.
- Documento e comunicação têm schema inicial, mas precisam controles de acesso, retenção e templates.
- Schemas já abrangem mais domínio que a API; paridade ainda depende da execução dos épicos.
