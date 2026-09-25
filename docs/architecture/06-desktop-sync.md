# Desktop local, sincronização e cache

**Escolha:** Tauri 2 + React; SQLite para subconjunto explícito, com chave de criptografia vinculada ao SO após spike. Escopo inicial: alunos ativos/recentes da unidade autorizada, agenda de janela curta, recursos, catálogos, tarefas. Sem downloads automáticos de documentos, dados financeiros detalhados ou credenciais. SQLite nunca é fonte de verdade de reservas/pagamentos.

## Protocolo proposto

1. Login OIDC; API retorna unidades permitidas e versão de escopo. Cliente cria cache por identidade/organização, recebe cursor monotônico por unidade.
2. `GET /sync/changes?unitId=&cursor=` retorna eventos/projeções autorizadas e tombstones, paginados. Cliente aplica lote em transação SQLite e só então confirma cursor.
3. Mutação offline **permitida** (ex.: rascunho de observação) recebe `clientMutationId`, `expectedVersion`, estado `PENDING` na outbox local. Online, envia comando idempotente. ACK remove outbox após atualizar projeção. Expiração de permissão apaga cache da unidade.
4. Erro 409 vira item de conflito na UI, exibindo versão local/servidor e ação humana. Cadastro simples admite merge explícito por campo; não usar `last-write-wins` para financeiro, documento oficial, processo ou agenda.
5. Sync recomeça após interrupção. TTL e purge por logout/revogação. Mudança de organização e credencial requer descarte do cache anterior.

**Operação offline v0.1:** leitura autorizada de cache e rascunhos locais; reservar aula, receber/estornar pagamento, concluir etapa e disparar automação requer conexão. Atualizações regulatórias nunca são executadas no desktop. A UI distingue “salvo no dispositivo” de “confirmado pelo servidor”. Testar perda de rede durante envio, duplicidade, revogação de acesso e troca de unidade.

**Metas observáveis:** abertura quente ≤ 2 s, mudança de aba ≤ 100 ms, busca local ≤ 150 ms em hardware de referência definido no Sprint 0. Medir com dados fictícios representativos e registrar percentis.
