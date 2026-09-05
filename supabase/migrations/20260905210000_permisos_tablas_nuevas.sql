-- =============================================================================
-- Permisos de las tablas nuevas
--
-- `CREATE TABLE` no reparte permisos: la tabla queda solo para su dueño. La
-- aplicacion se conecta a Postgres con otro rol, asi que sobre las tablas nuevas
-- recibia «permission denied» — el modo venta por WhatsApp fallaba al crear la
-- sesion y el mensaje terminaba contestado por el flujo del comprador.
--
-- En vez de escribir a mano una lista de roles (que cambia entre instalaciones),
-- se copian los permisos de una tabla que YA funciona en ese mismo esquema. Lo
-- que sirve para `sorteo_revendedores` sirve para estas.
-- =============================================================================

DO $$
DECLARE
  sch    text;
  tabla  text;
  g      record;
  nuevas text[] := ARRAY[
    'sorteo_venta_vendedor_sesiones',
    'sorteo_cierres_caja',
    'sorteo_ticket_impresion'
  ];
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteo_revendedores'
      AND c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname !~ '^pg_'
    ORDER BY 1
  LOOP
    FOREACH tabla IN ARRAY nuevas LOOP
      /* La tabla puede no existir si esa migracion no se corrio en este esquema. */
      CONTINUE WHEN to_regclass(format('%I.%I', sch, tabla)) IS NULL;

      FOR g IN
        SELECT DISTINCT grantee, privilege_type
        FROM information_schema.role_table_grants
        WHERE table_schema = sch AND table_name = 'sorteo_revendedores'
      LOOP
        RAISE NOTICE 'GRANT % ON %.% TO %', g.privilege_type, sch, tabla, g.grantee;
        IF upper(g.grantee) = 'PUBLIC' THEN
          EXECUTE format('GRANT %s ON %I.%I TO PUBLIC', g.privilege_type, sch, tabla);
        ELSE
          EXECUTE format('GRANT %s ON %I.%I TO %I', g.privilege_type, sch, tabla, g.grantee);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
