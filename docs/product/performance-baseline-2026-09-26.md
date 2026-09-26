# Referência local de latência — 26/09/2026

Medição de leitura autenticada na API local, feita com token Keycloak de desenvolvimento e dados **exclusivamente sintéticos** em Ponte Rasa. Host macOS arm64, Node v26.7.0, API em `127.0.0.1:3000`, PostgreSQL 16 no Compose. Havia 18 alunos e 5 aulas na unidade. Um cliente executou, para cada endpoint, 10 requisições de aquecimento e depois 100 requisições sequenciais; o cronômetro incluiu HTTP, autenticação, banco e leitura completa da resposta. Valores em milissegundos, ordenados por amostra; p95 é a 95ª amostra.

| Endpoint | p50 | p95 | máximo |
|---|---:|---:|---:|
| `GET /students?limit=10` | 1,71 | 2,65 | 3,51 |
| `GET /tasks?view=open&limit=10` | 3,22 | 4,56 | 6,22 |
| `GET /reports/operations` | 2,40 | 4,40 | 87,26 |

Esta referência detecta regressões grosseiras na máquina de desenvolvimento. Não representa carga concorrente, rede externa, volume real, navegador do operador, tamanho de dados do piloto nem metas de aceite. Antes do MVP operacional, repetir em staging isolado com dataset sintético representativo, concorrência e critérios p95 acordados com a GP Autoescola; investigar o outlier do relatório se reaparecer.
