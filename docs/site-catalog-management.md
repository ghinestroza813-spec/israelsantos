# Site-based product catalog workflow

## Product direction

Product data is authored in the store's protected admin panel. Supabase is the source of truth. Google Sheets is a reporting mirror only; staff do not enter catalog data in Sheets.

## Roles

- `admin`: store owner. Can view all products, edit catalog records, and approve/reject pending products.
- `manager`: collaborator. Can create products and edit any product while it is inactive and `needs_review=true`. Cannot publish, approve, reject, or change review/publication flags.

Create each collaborator in Supabase Authentication first. Then add their existing Auth user IDs to `public.admin_users` with role `manager`. Do not share the owner's login.

## Database migration

Apply `backend/supabase/migrations/202611040001_site_catalog_management.sql` in Supabase SQL Editor after checking that the existing products table is the expected schema. It is additive and does not delete or rewrite product rows.

After both collaborator accounts exist in Supabase Auth, run the commented INSERT in the migration using their Auth user IDs/email lookup. Keep the owner as role `admin`.

## API behavior

- `POST /api/admin/products`: creates a product with `is_active=false`, `needs_review=true`, and `created_by` set from the authenticated session. Client-supplied publication flags are overridden.
- `POST /api/admin/uploads/product-image`: accepts JPEG, PNG or WebP, up to 5 MB, and stores the file in the configured Supabase Storage bucket.
- `PATCH /api/admin/products/:id`: managers can edit only pending/inactive products; admin can edit any product.
- `POST /api/admin/products/:id/review`: admin-only approve/reject action. Approval activates the product; rejection leaves it inactive. Only pending products can be reviewed.
- Google Sheets secret-based decision endpoint also only matches products that are still pending/inactive.

## Google Sheets reporting mirror

Optional Render environment variables:
- `GOOGLE_SHEETS_WEBHOOK_URL`: deployed Apps Script Web App URL.
- `GOOGLE_SHEETS_WEBHOOK_SECRET`: long random secret shared with the Apps Script.

The API posts a compact product event payload after create, update, approve or reject. The Apps Script Web App source is in `docs/google-sheets-reporting.gs`. Deploy it as a Web App (execute as the owner; access Anyone), then set Script Properties `CATALOG_REPORT_SECRET` and `REPORT_SPREADSHEET_ID`. The API sends the secret in the JSON body because Apps Script Web Apps do not expose arbitrary request headers to `doPost`. The script verifies the secret and appends an audit row to `Relatório de produtos`. Reporting sync is best-effort: a Sheets outage never blocks product submission or approval. Never put the Supabase service key in Apps Script or a spreadsheet.

## Current implementation status

This PR delivers the API/database foundation. The storefront admin UI still needs the direct image-upload interaction, a dedicated approval queue, and the reporting Apps Script endpoint before collaborators should use the new workflow. Do not deploy to production until the migration, UI and end-to-end checks are complete.
