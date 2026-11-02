# Deploy the API on Render

This repository includes a Render Blueprint at the repository root.

## Before deploying
1. Confirm the initial Supabase SQL migration has run successfully.
2. Create the first Supabase Auth user.
3. Add that user's UUID to `public.admin_users` using the SQL in the main project setup guide.
4. Keep the Supabase secret key private. Never commit it to Git.

## Deploy
1. Sign in to Render and connect the GitHub repository `ghinestroza813-spec/israelsantos`.
2. Choose the branch `feat/production-foundation` for this initial preview deployment.
3. Use the Blueprint option so Render reads `render.yaml`.
4. Set the secret environment values in the Render dashboard:
   - `SUPABASE_URL`: the Supabase project URL.
   - `SUPABASE_SECRET_KEY`: the server-only Supabase secret key.
   - `FRONTEND_ORIGIN`: leave empty only for an isolated API preview; before connecting the storefront, set the exact deployed storefront origin, e.g. `https://shop.example.com`.
5. Deploy and wait for the health check.

## Verify
- Open `https://YOUR-RENDER-SERVICE.onrender.com/health`; expected JSON has `status: "ok"`.
- Open `https://YOUR-RENDER-SERVICE.onrender.com/health/database`; expected JSON has `status: "connected"`.

Do not share the service URL with customers yet. This is a technical preview until authentication, order creation, payment processing, storefront integration and production testing are complete.

## Cost
The Blueprint uses Render's paid Starter plan to avoid relying on a sleeping free service for a store API. Check current pricing in Render before creating the service.
