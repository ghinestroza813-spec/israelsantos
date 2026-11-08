-- Etapa 5B: impedir combinacoes duplicadas de tamanho e cor
-- para o mesmo produto, independentemente do SKU.
-- Preserva variacoes antigas com tamanho ou cor nulos/vazios.

CREATE UNIQUE INDEX IF NOT EXISTS
    ux_product_variants_product_size_color
ON public.product_variants (
    product_id,
    LOWER(TRIM(size)),
    LOWER(TRIM(color))
)
WHERE NULLIF(TRIM(size), '') IS NOT NULL
  AND NULLIF(TRIM(color), '') IS NOT NULL;
