-- =============================================================================
-- Aviso previo al sorteo: configuración por sorteo.
-- Columnas en el mismo schema que `sorteos` (public, zentra_erp, er_*, erp_*).
--
-- recordatorio_previo_enabled     apagado por defecto: ningún sorteo existente
--                                 empieza a mandar avisos sin que alguien lo prenda.
-- recordatorio_previo_dias_antes  cuántos días antes de `fecha_sorteo` sale el aviso.
-- recordatorio_previo_template_id plantilla aprobada (chat_campaign_templates.id).
-- recordatorio_previo_campaign_id campaña creada por el cron (trazabilidad / cancelar).
-- recordatorio_previo_sent_at     marca de idempotencia: con valor, no se vuelve a enviar.
-- =============================================================================

DO $$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT DISTINCT n.nspname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'sorteos'
      AND c.relkind = 'r'
      AND (
        n.nspname IN ('public', 'zentra_erp')
        OR n.nspname ~ '^er_[0-9a-f]{32}$'
        OR n.nspname LIKE 'erp\_%' ESCAPE '\'
      )
    ORDER BY 1
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.sorteos
         ADD COLUMN IF NOT EXISTS recordatorio_previo_enabled boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS recordatorio_previo_dias_antes integer NOT NULL DEFAULT 1,
         ADD COLUMN IF NOT EXISTS recordatorio_previo_template_id uuid,
         ADD COLUMN IF NOT EXISTS recordatorio_previo_campaign_id uuid,
         ADD COLUMN IF NOT EXISTS recordatorio_previo_sent_at timestamptz',
      sch
    );

    /** Índice parcial: el cron busca solo los sorteos con aviso pendiente. */
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS sorteos_recordatorio_previo_pendiente_idx
         ON %I.sorteos (empresa_id, fecha_sorteo)
       WHERE recordatorio_previo_enabled = true AND recordatorio_previo_sent_at IS NULL',
      sch
    );
  END LOOP;
END $$;
