-- =============================================================================
-- Redes / Instagram del negocio en el ticket impreso
--
-- El cliente pidió que la boleta de venta en calle muestre, además de los datos
-- actuales, las páginas de redes (Instagram). Es configuración de la EMPRESA
-- (las redes no cambian con el sorteo), así que va en `sorteo_ticket_impresion`,
-- junto al encabezado y el pie.
--
-- `ADD COLUMN IF NOT EXISTS` para que la migración se pueda volver a correr sin
-- fallar y no rompa los esquemas donde la columna ya exista.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_ticket_impresion'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;
    EXECUTE format(
      'ALTER TABLE %I.sorteo_ticket_impresion ADD COLUMN IF NOT EXISTS instagram text',
      sch
    );
  END LOOP;
END $$;
