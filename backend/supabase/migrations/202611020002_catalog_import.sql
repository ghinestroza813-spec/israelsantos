-- Preserve the storefront's current sample catalog while requiring review
-- before any item is exposed to customers or can be sold.
alter table public.products
  add column if not exists badge text,
  add column if not exists stock integer check (stock is null or stock >= 0),
  add column if not exists installments integer check (installments is null or installments between 1 and 24),
  add column if not exists sort_order integer not null default 0,
  add column if not exists needs_review boolean not null default true;

insert into public.products
  (slug, name, brand, category, price, badge, sizes, is_featured,
   description, stock, installments, sort_order, is_active, needs_review)
values
  ('luva-fairtex-breathable','Luva Fairtex Breathable Couro Legítimo','Fairtex','Luvas',689.90,'Importado',
   '["10 oz","12 oz","14 oz","16 oz"]'::jsonb,true,
   'Luva de Muay Thai em couro legítimo, importada da Tailândia.',null,null,1,false,true),
  ('luva-infightstyle-gold','Luva Infightstyle Gold Edition Couro','Infightstyle','Luvas',749.90,'Gold Edition',
   '["10 oz","12 oz","14 oz","16 oz"]'::jsonb,true,
   'Luva em couro da linha Gold Edition, importada da Tailândia.',null,null,2,false,true),
  ('short-twins-special','Short Twins Special Cetim Premium','Twins Special','Shorts',329.90,'Cetim premium',
   '["P","M","G","GG"]'::jsonb,true,
   'Short tradicional de Muay Thai em cetim, importado da Tailândia.',null,null,3,false,true),
  ('short-lumpinee-preto','Shorts Lumpinee Classic Preto','Lumpinee','Shorts',250.00,'Clássico',
   '["P","M","G","GG"]'::jsonb,false,
   'Short clássico de cetim no estilo tradicional dos ringues tailandeses.',null,null,4,false,true),
  ('short-lumpinee-azul','Shorts Lumpinee Classic Azul','Lumpinee','Shorts',250.00,'Clássico',
   '["P","M","G","GG"]'::jsonb,false,
   'Short clássico de cetim no estilo tradicional dos ringues tailandeses.',null,null,5,false,true),
  ('short-lumpinee-verde','Shorts Lumpinee Classic Verde','Lumpinee','Shorts',250.00,'Clássico',
   '["P","M","G","GG"]'::jsonb,false,
   'Short clássico de cetim no estilo tradicional dos ringues tailandeses.',null,null,6,false,true),
  ('caneleira-topking-couro','Caneleira Top King Couro Profissional','Top King','Caneleiras',459.90,'Profissional',
   '["P","M","G"]'::jsonb,true,
   'Caneleira em couro para treino e luta, importada da Tailândia.',null,null,7,false,true),
  ('protetor-bucal-fairtex','Protetor Bucal Duplo Fairtex','Fairtex','Acessórios',89.90,'Original',
   '[]'::jsonb,false,
   'Protetor bucal duplo (superior e inferior) para treino e luta.',null,3,8,false,true)
on conflict (slug) do update set
  name = excluded.name,
  brand = excluded.brand,
  category = excluded.category,
  price = excluded.price,
  badge = excluded.badge,
  sizes = excluded.sizes,
  is_featured = excluded.is_featured,
  description = excluded.description,
  installments = excluded.installments,
  sort_order = excluded.sort_order,
  needs_review = true,
  is_active = false,
  updated_at = now();
