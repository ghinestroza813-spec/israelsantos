# Israel Santos Thaishop — Production Roadmap

## Current baseline
- Existing storefront preserved in the original HTML file.
- `index.html` is a deployment-ready copy of that storefront.
- The current browser storage and optional `window.claude` integration are legacy/demo behavior, not a production backend.
- No real payment provider is connected yet.

## Target architecture
- Storefront: existing HTML/CSS/JavaScript, deployed as a static site.
- API: Node.js 20+ with Express, deployed separately.
- Database: Supabase PostgreSQL.
- Payments: Mercado Pago Checkout Pro, with server-side webhook validation.
- Source control: GitHub; production changes should enter through reviewed pull requests.

## Implementation phases
1. Foundation: deployable entry point, API skeleton, environment template, repository hygiene.
2. Database: schema and migrations for products, customers, orders, order items, payments and inventory.
3. Authentication: server-side admin authentication, authorization and protected admin routes.
4. Storefront integration: replace browser-only persistence with API calls while preserving the interface.
5. Payments: create payment preferences on the server and validate signed webhooks.
6. Hardening: tests, backups, logging, privacy/legal pages and production deployment.

## Security rules
- Never commit real credentials, access tokens, service-role keys or payment secrets.
- Keep the Supabase service-role key and Mercado Pago access token on the server only.
- Never mark an order as paid based only on a browser redirect.
- Do not expose administrative authorization decisions in frontend JavaScript.
- Keep the existing original storefront file until the replacement is tested and approved.

## Local API setup
1. Copy `backend/.env.example` to `backend/.env` and fill only local development values.
2. Run `cd backend && npm install`.
3. Run `npm run dev`.
4. Check `http://localhost:3000/health`.

The API health endpoint does not yet connect to Supabase or process orders. Those features are intentionally scheduled for the next phases.
