# Etapa 5A — Homologação do painel de estoque

O novo painel está em `/stock-admin/` no **backend**, não no HTML legado da loja.

## Configuração segura
1. Crie uma implantação de homologação do backend usando a branch `feature/etapa-5a-estoque-variacoes`. Não altere o serviço de produção.
2. Configure `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (somente servidor), `SUPABASE_ANON_KEY` (chave pública/publishable do mesmo projeto), `FRONTEND_ORIGIN` e demais variáveis já utilizadas pelo backend. Nunca copie `SUPABASE_SECRET_KEY` para HTML, JavaScript público ou GitHub.
3. Idealmente, use um **projeto Supabase de homologação** com migrações aplicadas e dados de teste; não execute movimentações de teste no estoque real.
4. Garanta que a conta de teste esteja cadastrada em Supabase Auth e em `public.admin_users` com a função adequada. O painel legado usa senha local e não substitui essa conta.
5. Acesse `https://SEU-BACKEND-DE-HOMOLOGACAO/stock-admin/` e entre com as credenciais de teste.

## Testes de aceitação
- Acessar `/api/admin/products` sem token deve retornar 401.
- Conta Auth sem registro em `admin_users` deve receber 403.
- Administrador autorizado consegue consultar produtos, variações e histórico.
- Colaborador pode consultar estoque, mas não registrar movimentação (403).
- Proprietário consegue registrar entrada de +1 em uma variação de teste; o histórico deve mostrar antes/depois.
- Saída com quantidade negativa maior que o saldo disponível deve falhar sem alterar o estoque.
- A mesma `idempotency_key` repetida não deve criar duas movimentações.
- Entrada negativa e saída positiva devem falhar na validação da API.
- `products.stock` deve continuar inalterado após movimentações de variantes.
- A integração Google Sheets e o catálogo legado devem continuar funcionando.
- Verificar console do navegador para erros CSP e testar o painel em celular.

## Limites atuais
- A autenticação da página é em memória: recarregar exige novo login.
- Não existe ainda sincronização de checkout/pedidos com estoque por variação. **Não tratar a nova tabela como estoque de venda em produção até implementar reserva e baixa transacional.**
- Os 8 produtos com estoque original ainda não alocado precisam de conferência manual por tamanho.
- Este PR é um rascunho; exige homologação antes de merge/deploy.


## Registro de homologação — 6 e 7 de novembro de 2026

**Escopo:** ambiente Render `israelsantos-homologacao`, projeto Supabase `israelsantos-homologacao`, branch `feature/etapa-5a-estoque-variacoes`. Não houve merge para `main` neste registro.

**Variação de teste isolada:** produto Caneleira Top King Couro Profissional; SKU `TESTE-TOPKING-001`; variação inativa, identificada como “TESTE - Não comercializar”. Estoque e reservado ao fim dos testes: **0 / 0**.

### Evidências e resultados observados

- Entrada de +1 e saída de -1 registradas com valores antes/depois; tentativa de saída com estoque 0 rejeitada.
- Teste de concorrência/idempotência: duas requisições simultâneas de entrada +1 com a **mesma chave** retornaram HTTP 200; primeira com `replayed=false`, segunda com `replayed=true`, mesmo `movement_id`; estoque 0 → 1, sem duplicação. Entrada compensada posteriormente com saída -1.
- Teste de duas vendas simultâneas com **chaves diferentes** e estoque inicial 1: uma requisição HTTP 200 (1 → 0) e outra HTTP 409; estoque final 0, sem saldo negativo.
- Painel exibiu **seis registros de auditoria** referentes às entradas e saídas dos testes, e estoque disponível/reservado **0 / 0**.
- `GET /api/admin/me` sem token retornou HTTP 401; `POST /api/admin/variants/:id/movements` sem token retornou HTTP 401.
- A função `public.apply_inventory_movement` foi verificada com EXECUTE para `postgres` e `service_role`, sem EXECUTE para `anon` ou `authenticated` na consulta de privilégios.
- Foram revogadas em homologação as permissões `TRUNCATE`, `TRIGGER` e `REFERENCES` de `anon` e `authenticated` nas tabelas `public.product_variants` e `public.inventory_movements`. Consulta posterior de privilégios não retornou concessões diretas para esses papéis.
- RLS habilitado nas duas tabelas (`relrowsecurity=true`; `relforcerowsecurity=false`). Política pública de variantes exige simultaneamente `product_variants.is_active=true` e `products.is_active=true`.
- A função `public.is_admin()` mantém a verificação `public.admin_users.user_id = auth.uid()`, é `SECURITY DEFINER` e teve `search_path` ajustado para vazio em homologação. Foi revogado EXECUTE de `PUBLIC`, mantendo concessões para `authenticated` e `service_role`. Verificação efetiva: `anon=false`, `authenticated=true`, `service_role=true`.
- Após esses ajustes, o painel continuou exibindo a variação de teste com estoque 0 / reservado 0 e os seis registros de histórico.
- Foi conferido manualmente que a variável `SUPABASE_URL` do serviço Render de homologação corresponde ao projeto Supabase de homologação.

### Pendências antes de produção

- Estes são **testes funcionais e verificações pontuais**, não uma auditoria integral de segurança. Validar os demais cenários da lista de aceitação acima (incluindo usuário não administrador, colaborador, CSP/mobile, catálogo e Google Sheets), além de revisar políticas, privilégios e configuração de implantação como um todo.
- Revisar a divergência entre `main` e a branch da Etapa 5A antes de qualquer merge; preservar os oito produtos originais e todas as integrações existentes.
- Implementar e testar checkout, pedidos, reserva e baixa transacional por variação antes de usar esse estoque para vendas reais.
- Não ativar a variação de teste nem executar novas movimentações sem plano de teste aprovado.
