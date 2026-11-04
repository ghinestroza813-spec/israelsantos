-- Stage 5: product variants and auditable inventory movements.
-- Additive migration: existing products, sizes, stock and SKUs remain untouched.

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text unique,
  size text,
  color text,
  label text,
  price_override numeric(12,2) check (price_override is null or price_override >= 0),
  stock integer not null default 0 check (stock >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0 and reserved_quantity <= stock),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_option_present check (
    nullif(trim(coalesce(size, '')), '') is not null
    or nullif(trim(coalesce(color, '')), '') is not null
    or nullif(trim(coalesce(label, '')), '') is not null
  )
);

create index if not exists idx_product_variants_product
  on public.product_variants(product_id, is_active);
create index if not exists idx_product_variants_low_stock
  on public.product_variants(stock) where is_active = true;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid references public.product_variants(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening','purchase','sale','adjustment','return','loss','reservation','release')),
  quantity_delta integer not null,
  stock_before integer not null check (stock_before >= 0),
  stock_after integer not null check (stock_after >= 0),
  reason text,
  reference text,
  idempotency_key text unique,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint inventory_movement_delta_nonzero check (quantity_delta <> 0)
);

create index if not exists idx_inventory_movements_product_created
  on public.inventory_movements(product_id, created_at desc);
create index if not exists idx_inventory_movements_variant_created
  on public.inventory_movements(variant_id, created_at desc);

alter table public.product_variants enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists "Public can read active product variants" on public.product_variants;
create policy "Public can read active product variants"
  on public.product_variants for select to anon, authenticated
  using (is_active = true and exists (
    select 1 from public.products p where p.id = product_id and p.is_active = true
  ));

drop policy if exists "Admins manage product variants" on public.product_variants;
create policy "Admins manage product variants"
  on public.product_variants for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins read inventory movements" on public.inventory_movements;
create policy "Admins read inventory movements"
  on public.inventory_movements for select to authenticated
  using (public.is_admin());

-- All stock changes go through this transaction-safe function from the trusted API.
-- The idempotency key prevents retries from applying the same movement twice.
create or replace function public.apply_inventory_movement(
  p_variant_id uuid,
  p_movement_type text,
  p_quantity_delta integer,
  p_reason text default null,
  p_reference text default null,
  p_idempotency_key text default null,
  p_actor_user_id uuid default null
)
returns table(movement_id uuid, variant_id uuid, stock_before integer, stock_after integer, replayed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_variant public.product_variants%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_movement_id uuid;
  v_after integer;
begin
  if p_quantity_delta = 0 then
    raise exception 'Quantity delta must not be zero' using errcode = '22023';
  end if;
  if p_movement_type not in ('opening','purchase','sale','adjustment','return','loss','reservation','release') then
    raise exception 'Invalid inventory movement type' using errcode = '22023';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.inventory_movements
    where idempotency_key = p_idempotency_key;
    if found then
      return query select v_existing.id, v_existing.variant_id,
        v_existing.stock_before, v_existing.stock_after, true;
      return;
    end if;
  end if;

  select * into v_variant from public.product_variants
    where id = p_variant_id for update;
  if not found then
    raise exception 'Product variant not found' using errcode = 'P0002';
  end if;

  v_after := v_variant.stock + p_quantity_delta;
  if v_after < 0 then
    raise exception 'Insufficient stock' using errcode = '23514';
  end if;
  if v_variant.reserved_quantity > v_after then
    raise exception 'Stock cannot be lower than reserved quantity' using errcode = '23514';
  end if;

  update public.product_variants
    set stock = v_after, updated_at = now()
    where id = p_variant_id;

  insert into public.inventory_movements (
    product_id, variant_id, movement_type, quantity_delta,
    stock_before, stock_after, reason, reference, idempotency_key, actor_user_id
  ) values (
    v_variant.product_id, p_variant_id, p_movement_type, p_quantity_delta,
    v_variant.stock, v_after, p_reason, p_reference, p_idempotency_key, p_actor_user_id
  ) returning id into v_movement_id;

  return query select v_movement_id, p_variant_id, v_variant.stock, v_after, false;
end;
$$;

revoke all on function public.apply_inventory_movement(uuid,text,integer,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.apply_inventory_movement(uuid,text,integer,text,text,text,uuid) to service_role;
