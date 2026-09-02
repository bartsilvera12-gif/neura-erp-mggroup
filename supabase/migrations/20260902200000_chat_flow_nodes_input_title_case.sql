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
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
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
