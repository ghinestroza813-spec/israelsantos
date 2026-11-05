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
