-- =============================================================================
-- Confirmación del dato capturado, pegada al mensaje del paso siguiente.
--
-- capture_confirm_label  Etiqueta a mostrar («CI», «Nombre», «Ciudad»). Con valor, al
--                        capturar el dato el bot antepone «✅ <etiqueta>: <valor>» al
--                        mensaje del siguiente paso, en el mismo mensaje.
--                        NULL o vacío = comportamiento actual (sin confirmación).
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
         ADD COLUMN IF NOT EXISTS capture_confirm_label text',
      sch
    );
  END LOOP;
END $$;
