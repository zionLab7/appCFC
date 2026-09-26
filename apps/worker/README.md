# Worker

`src/outbox-dispatcher.ts` envia eventos pendentes a um webhook configurado. O payload segue `envelope.schema.json`; o corpo é assinado em `x-gp-cfc-signature: sha256=<hex>` com HMAC SHA-256 e inclui `x-gp-cfc-event-id`. O consumidor deve deduplicar pelo ID, pois a garantia é **pelo menos uma entrega**. O worker usa lease no PostgreSQL, `FOR UPDATE SKIP LOCKED`, timeout HTTP de dez segundos e retry exponencial. Uma resposta 2xx marca `published_at`; falha mantém o evento pendente.

Configure `OUTBOX_WEBHOOK_URL` HTTPS e `OUTBOX_WEBHOOK_SECRET` com ao menos 24 caracteres e rode `npm run dev:worker`. HTTP só é aceito para `localhost`/`127.0.0.1` em desenvolvimento. O Compose não inclui receptor e o worker não inicia sem configuração. Os testes usam receptor local sintético. A implementação de consumidores, dead letter, métricas e adaptações de portais oficiais ainda está pendente; este worker não navega em portais.
