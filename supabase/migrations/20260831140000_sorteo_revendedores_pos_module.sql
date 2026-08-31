-- =============================================================================
-- Módulo POS de Revendedores (MG GROUP, single_client schema: mggroup).
-- Paso 1 — Fundación:
--   * sorteo_revendedores: access_token (link mágico), cupo_boletos, revocación.
--   * sorteo_revendedor_rendiciones: registro de entregas de efectivo (rendición).
-- Idempotente. Scoped SOLO a `mggroup` para no afectar otros clientes.
-- La atribución de la venta usa sorteo_entradas.revendedor_id (ya existe).
-- =============================================================================

-- --- sorteo_revendedores: acceso por link mágico + cupo ----------------------
ALTER TABLE mggroup.sorteo_revendedores
  ADD COLUMN IF NOT EXISTS access_token            text,
  ADD COLUMN IF NOT EXISTS access_token_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_revoked_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cupo_boletos            integer;

COMMENT ON COLUMN mggroup.sorteo_revendedores.access_token IS
  'Token opaco del link mágico del revendedor (/rv/:token). NULL o access_revoked_at != NULL = sin acceso.';
COMMENT ON COLUMN mggroup.sorteo_revendedores.cupo_boletos IS
  'Máximo de boletos que puede vender el revendedor. NULL = ilimitado.';

-- Un token vigente es único (permite NULL / revocados sin chocar).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sorteo_revendedores_access_token
  ON mggroup.sorteo_revendedores (access_token)
  WHERE access_token IS NOT NULL AND access_revoked_at IS NULL;

-- --- sorteo_revendedor_rendiciones: entregas de efectivo ---------------------
CREATE TABLE IF NOT EXISTS mggroup.sorteo_revendedor_rendiciones (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES mggroup.empresas(id) ON DELETE CASCADE,
  sorteo_id              uuid NOT NULL REFERENCES mggroup.sorteos(id) ON DELETE CASCADE,
  revendedor_id          uuid NOT NULL REFERENCES mggroup.sorteo_revendedores(id) ON DELETE CASCADE,
  monto                  numeric NOT NULL DEFAULT 0,
  observacion            text,
  registrado_por_user_id uuid,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sorteo_rev_rendiciones_revendedor
  ON mggroup.sorteo_revendedor_rendiciones (revendedor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sorteo_rev_rendiciones_empresa
  ON mggroup.sorteo_revendedor_rendiciones (empresa_id);
CREATE INDEX IF NOT EXISTS idx_sorteo_rev_rendiciones_sorteo
  ON mggroup.sorteo_revendedor_rendiciones (sorteo_id);

COMMENT ON TABLE mggroup.sorteo_revendedor_rendiciones IS
  'Registro de entregas de efectivo del revendedor al negocio. Saldo a rendir = ventas efectivo atribuidas - SUM(rendiciones).';

ALTER TABLE mggroup.sorteo_revendedor_rendiciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sorteo_rev_rend_select" ON mggroup.sorteo_revendedor_rendiciones;
DROP POLICY IF EXISTS "sorteo_rev_rend_insert" ON mggroup.sorteo_revendedor_rendiciones;
DROP POLICY IF EXISTS "sorteo_rev_rend_update" ON mggroup.sorteo_revendedor_rendiciones;
DROP POLICY IF EXISTS "sorteo_rev_rend_delete" ON mggroup.sorteo_revendedor_rendiciones;

CREATE POLICY "sorteo_rev_rend_select" ON mggroup.sorteo_revendedor_rendiciones FOR SELECT
  USING (mggroup.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_rend_insert" ON mggroup.sorteo_revendedor_rendiciones FOR INSERT
  WITH CHECK (mggroup.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_rend_update" ON mggroup.sorteo_revendedor_rendiciones FOR UPDATE
  USING (mggroup.puede_acceder_empresa(empresa_id))
  WITH CHECK (mggroup.puede_acceder_empresa(empresa_id));
CREATE POLICY "sorteo_rev_rend_delete" ON mggroup.sorteo_revendedor_rendiciones FOR DELETE
  USING (mggroup.puede_acceder_empresa(empresa_id));
