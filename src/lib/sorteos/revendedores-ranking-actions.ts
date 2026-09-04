import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

export type RevendedorRankingRow = {
  revendedor_id: string;
  nombre: string;
  activo: boolean;
  boletas: number;
  boletas_hoy: number;
  ventas: number;
  monto: number;
};

export type RevendedoresRanking = {
  revendedores: RevendedorRankingRow[];
  totales: { boletas: number; boletas_hoy: number; ventas: number; monto: number };
};

const VACIO: RevendedoresRanking = {
  revendedores: [],
  totales: { boletas: 0, boletas_hoy: 0, ventas: 0, monto: 0 },
};

/** Ranking de revendedores por boletas vendidas (una sola consulta agregada en el servidor). */
export async function getRevendedoresRanking(sorteoId: string): Promise<RevendedoresRanking> {
  const res = await fetchWithSupabaseSession(
    `/api/sorteos/${encodeURIComponent(sorteoId)}/revendedores/ranking`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || "No se pudo cargar el ranking.");
  }
  const json = (await res.json()) as { success?: boolean; data?: RevendedoresRanking };
  if (!json.success || !json.data) return VACIO;
  return json.data;
}
