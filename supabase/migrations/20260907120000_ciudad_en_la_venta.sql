-- =============================================================================
-- Ciudad del comprador en la venta
--
-- Hasta ahora la ciudad solo existia en `chat_flow_data` (la contesta el cliente por
-- WhatsApp) o en `clientes.ciudad`. Una venta cargada en el punto de venta no tenia
-- donde guardarla, y el ticket impreso no la podia mostrar.
--
-- Se guarda en la venta, no solo en el cliente, porque el ticket es un documento de
-- ese momento: si la persona se muda y vuelve a comprar, la boleta vieja tiene que
-- seguir diciendo lo que se imprimio ese dia.
--
-- La columna es opcional: las ventas anteriores quedan en NULL y el ticket cae a la
-- ciudad del flujo o a la del cliente, como venia haciendo.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_entradas'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;

    EXECUTE format('ALTER TABLE %I.sorteo_entradas ADD COLUMN IF NOT EXISTS ciudad text', sch);
  END LOOP;
END $$;
