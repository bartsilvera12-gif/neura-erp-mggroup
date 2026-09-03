-- =============================================================================
-- Reserva atómica del procesamiento de una imagen entrante.
--
-- Meta reintenta el webhook y las dos entregas pueden llegar casi a la vez: un chequeo
-- «leer y después escribir» no alcanza, porque ambas leen antes de que alguna escriba.
-- Con este índice único, la segunda inserción falla y ese request sabe que no debe
-- reprocesar: el cliente deja de recibir cada mensaje dos veces.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'chat_flow_events'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    RAISE NOTICE 'Aplicando en el esquema %', sch;
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS chat_flow_events_image_claim_uidx
         ON %I.chat_flow_events (conversation_id, (payload->>''wa_message_id''))
       WHERE event_type = ''image_processing_claimed''',
      sch
    );
  END LOOP;
END $$;
