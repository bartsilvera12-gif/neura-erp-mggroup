-- =============================================================================
-- Tope de la respuesta numerica en pasos de captura.
--
-- input_max_value  Maximo aceptado cuando input_validation = 'number' (p. ej. 20 boletas
--                  por compra). NULL = sin tope, comportamiento actual.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_flow_nodes'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         ADD COLUMN IF NOT EXISTS input_max_value integer',
      sch
    );
  END LOOP;
END $$;
