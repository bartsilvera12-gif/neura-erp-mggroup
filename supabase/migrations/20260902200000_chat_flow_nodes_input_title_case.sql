-- =============================================================================
-- Suma 'title_case' a `chat_flow_nodes.input_validation`.
--
-- Capitaliza el dato al guardarlo: «ciudad del este» → «Ciudad del Este». Sirve para
-- nombres y ciudades, que el cliente escribe como sale y despues se imprimen en la
-- boleta y quedan en el CRM.
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
      /**
       * Cualquier esquema que tenga la tabla. La lista cerrada («public», «zentra_erp»,
       * «er_…», «erp_…») dejaba afuera nombres como «mggroup» o «caribenaerp»: la
       * migracion corria sin error pero no tocaba ningun esquema.
       */
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         DROP CONSTRAINT IF EXISTS chat_flow_nodes_input_validation_check',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         ADD CONSTRAINT chat_flow_nodes_input_validation_check
         CHECK (input_validation IN (''none'', ''number'', ''title_case''))',
      sch
    );
  END LOOP;
END $$;
