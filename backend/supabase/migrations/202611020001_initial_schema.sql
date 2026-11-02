-- Israel Santos Thaishop
-- Initial PostgreSQL schema. Apply through Supabase SQL Editor or Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  brand text,
  category text,
  price numeric(12,2) not null check (price >= 0),
  compare_at_price numeric(12,2) check (compare_at_price is null or compare_at_price >= 0),
  sku text unique,
  image_url text,
  images jsonb not null default '[]'::jsonb,
  sizes jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory (
  product_id uuid primary key references public.products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  updated_at timestamptz not null default now(),
  constraint inventory_reserved_not_over_quantity
    check (reserved_quantity <= quantity)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','awaiting_payment','paid','processing','shipped','delivered','cancelled','refunded')),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  shipping_amount numeric(12,2) not null default 0 check (shipping_amount >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  total numeric(12,2) not null check (total >= 0),
  shipping_address jsonb not null default '{}'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  sku text,
  size text,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  provider text not null default 'mercado_pago',
  provider_payment_id text unique,
  provider_preference_id text,
  status text not null default 'created'
    check (status in ('created','pending','approved','rejected','cancelled','refunded','charged_back')),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'BRL',
  raw_notification jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_active on public.products(is_active);
create index if not exists idx_products_category on public.products(category);
create index if not exists idx_orders_customer on public.orders(customer_id);
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_payments_order on public.payments(order_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

alter table public.admin_users enable row level security;
alter table public.products enable row level security;
alter table public.inventory enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

-- Public storefront may read active products only.
drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products"
  on public.products for select
  to anon, authenticated
  using (is_active = true);

-- Admin users can manage catalog and inventory.
drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products"
  on public.products for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins manage inventory" on public.inventory;
create policy "Admins manage inventory"
  on public.inventory for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Business records are private. The trusted API will use the server-only
-- service-role key after validating requests and admin permissions.
create policy "Admins read customers"
  on public.customers for select to authenticated
  using (public.is_admin());

create policy "Admins manage orders"
  on public.orders for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage order items"
  on public.order_items for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins manage payments"
  on public.payments for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins read admin users"
  on public.admin_users for select to authenticated
  using (public.is_admin());

-- No self-registration policy is created for admin_users. Promote the first
-- administrator manually only after creating that user in Supabase Auth:
-- insert into public.admin_users (user_id, role)
-- values ('AUTH_USER_UUID_HERE', 'admin');
