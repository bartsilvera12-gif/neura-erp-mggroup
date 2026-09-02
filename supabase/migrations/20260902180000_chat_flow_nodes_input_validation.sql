-- =============================================================================
-- Validación de la respuesta de texto en pasos de captura.
-- Columnas en el mismo schema que `chat_flow_nodes` (public, zentra_erp, er_*, erp_*).
--
-- input_validation       'none' (comportamiento actual, guarda lo que sea) o
--                        'number' (solo dígitos; si no, se repregunta sin avanzar).
-- input_invalid_message  texto de la repregunta. Vacío = texto por defecto del sistema.
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
         ADD COLUMN IF NOT EXISTS input_validation text NOT NULL DEFAULT ''none'',
         ADD COLUMN IF NOT EXISTS input_invalid_message text',
      sch
    );

    /** Restringido a los valores que entiende el motor: un typo no debe romper el flujo. */
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         DROP CONSTRAINT IF EXISTS chat_flow_nodes_input_validation_check',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         ADD CONSTRAINT chat_flow_nodes_input_validation_check
         CHECK (input_validation IN (''none'', ''number''))',
      sch
    );
  END LOOP;
END $$;
