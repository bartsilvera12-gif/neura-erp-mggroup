/**
 * Corre el motor de recontacto en modo SIMULACIÓN (dry-run) contra la empresa configurada.
 * No envía WhatsApp ni escribe en chat_flow_recontact_runs: solo lista candidatos por regla.
 *
 * Requiere .env.local con NEURA_CLIENT_EMPRESA_ID (+ conexión Supabase service role / DB).
 *
 *   npx tsx scripts/verify-recontact-executor-dry.ts
 */
import { config } from "dotenv";
import { join } from "path";

config({ path: join(process.cwd(), ".env.local") });

async function main(): Promise<void> {
  const empresaId = process.env.NEURA_CLIENT_EMPRESA_ID?.trim();
  if (!empresaId) {
    console.error("Falta NEURA_CLIENT_EMPRESA_ID en .env.local — no hay empresa para simular.");
    process.exit(1);
  }

  // Import dinámico: así dotenv ya cargó las envs antes de instanciar clientes Supabase/pool.
  const { runRecontactForEmpresa } = await import("@/lib/chat/recontact-executor");

  const res = await runRecontactForEmpresa({ empresaId, dryRun: true });

  console.log(JSON.stringify(res, null, 2));
  console.log(
    `\nResumen: ${res.rules_evaluated} regla(s), ${res.total_candidates} candidato(s) ` +
      `(locked=${res.locked}, dry_run=${res.dry_run}).`
  );

  if (!res.locked) {
    console.warn("Nota: no se obtuvo el candado (¿otra pasada en curso?).");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
