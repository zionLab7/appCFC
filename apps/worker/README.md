# Worker

Futuro executor isolado das automações regulatórias, acionado por outbox/fila e adapters aprovados. A primeira versão não contém robôs conectados a portais oficiais. Os eventos `task.created.v1` e `task.closed.v1` já são gravados na outbox pela API; o dispatcher/consumidor ainda não foi implementado.
