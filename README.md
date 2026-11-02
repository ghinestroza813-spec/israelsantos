# Israel Santos Thaishop

Loja one-page de equipamentos de Muay Thai com pagamento pelo Mercado Pago (Pix e cartão em até 12x), hospedada na Vercel.

## Estrutura
- `public/index.html`: a loja
- `public/catalog.json`: preços, nomes e fretes que valem de verdade na cobrança
- `api/create-payment.js`: cria o pagamento no Mercado Pago (a chave secreta fica só aqui)
- `api/webhook.js`: recebe o aviso de pagamento aprovado (e envia e-mail, se configurado)

## Publicar na Vercel
1. Em vercel.com, entre com sua conta do GitHub e clique em **Add New → Project**.
2. Escolha o repositório `israelsantos` e clique em **Deploy** (não precisa mudar nenhuma configuração).
3. Em **Settings → Environment Variables**, crie:
   - `MP_ACCESS_TOKEN`: o Access Token do Mercado Pago (de teste `TEST-...` para testar, de produção `APP_USR-...` para vender)
   - `SITE_URL`: endereço final da loja, por exemplo `https://israelsantosthaishop.com.br` (opcional enquanto usar o endereço da Vercel)
   - `NOTIFY_EMAIL` e `RESEND_API_KEY` (opcionais): e-mail que recebe um aviso a cada pedido pago
4. Em **Deployments**, clique em **Redeploy** para as variáveis valerem.
5. No Mercado Pago, em **Seu negócio → Configurações → Credenciais**, copie o Access Token. Em **Webhooks**, cadastre `https://SEU-ENDERECO/api/webhook` com o evento **Pagamentos** (opcional, só para o aviso por e-mail).

## Alterar preços e fretes
Edite `public/catalog.json` no GitHub (ícone de lápis) e salve. A Vercel publica sozinha em cerca de 1 minuto. O painel Admin da página só muda a vitrine no navegador de quem usa; o valor cobrado vem sempre do `catalog.json`.

## Novo produto
Inclua o produto em `public/catalog.json` (mesmo `id` usado na loja). Produto que não está nesse arquivo não pode ser comprado.

## Testar antes de vender
Use o Access Token de teste e as contas e cartões de teste do Mercado Pago. Faça um pedido completo até a tela de retorno.
