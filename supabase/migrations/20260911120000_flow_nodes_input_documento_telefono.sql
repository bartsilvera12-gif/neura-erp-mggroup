-- =============================================================================
-- Suma 'documento' y 'telefono' a `chat_flow_nodes.input_validation`.
--
-- El paso de la cedula se validaba como numero, y eso deja afuera a cualquier
-- extranjero: un pasaporte lleva letras y un CPF guiones, asi que el bot le
-- repreguntaba sin fin y no podia comprar. 'documento' acepta cedula, RUC y
-- documentos de otros paises; 'telefono' acepta numeros de cualquier pais.
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
         DROP CONSTRAINT IF EXISTS chat_flow_nodes_input_validation_check',
      sch
    );
    EXECUTE format(
      'ALTER TABLE %I.chat_flow_nodes
         ADD CONSTRAINT chat_flow_nodes_input_validation_check
         CHECK (input_validation IN (''none'', ''number'', ''title_case'', ''documento'', ''telefono''))',
      sch
    );
  END LOOP;
END $$;
