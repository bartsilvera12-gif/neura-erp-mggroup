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
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         ADD COLUMN IF NOT EXISTS capture_confirm_label text',
      sch
    );
  END LOOP;
END $$;
