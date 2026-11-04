-- Site-based catalog management. Safe additive migration: existing products are preserved.
alter table public.products
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text;

create index if not exists idx_products_pending_review
  on public.products (needs_review, is_active, created_at desc);

create index if not exists idx_products_created_by
  on public.products (created_by, created_at desc);

-- Product activity log for traceability of submissions, edits and review decisions.
create table if not exists public.product_activity_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created','updated','approved','rejected')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_activity_product_created
  on public.product_activity_log (product_id, created_at desc);

alter table public.product_activity_log enable row level security;

drop policy if exists "Admins read product activity" on public.product_activity_log;
create policy "Admins read product activity"
  on public.product_activity_log for select
  to authenticated using (public.is_admin());

-- Collaborators are represented by role='manager'; only role='admin' can review.
-- Create the Supabase Auth users first, then add their UUIDs to admin_users.
-- insert into public.admin_users (user_id, role)
-- select id, 'manager' from auth.users
-- where lower(email) in ('santoshopthai@gmail.com','israelkronos70@gmail.com')
-- on conflict (user_id) do update set role = 'manager';
