"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getSorteoById } from "@/lib/sorteos/actions";
import RankingRevendedoresCard from "@/components/sorteos/RankingRevendedoresCard";

/**
 * Pantalla dedicada del ranking. El contenido es el mismo componente que usa la vista Sorteos
 * del dashboard: tenerlo en un solo lugar evita que un ajuste de diseño arregle una pantalla
 * y deje la otra atrás.
 */
export default function RevendedoresRankingPage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const [nombreSorteo, setNombreSorteo] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    getSorteoById(id)
      .then((s) => {
        if (!cancelado) setNombreSorteo(s?.nombre ?? "");
      })
      .catch(() => {
        /* el nombre es decorativo: el ranking se muestra igual */
      });
    return () => {
      cancelado = true;
    };
  }, [id]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:py-6">
      <Link
        href={`/sorteos/${id}/revendedores`}
        className="inline-block py-1 text-sm text-[#4FAEB2] hover:underline"
      >
        ← Revendedores
      </Link>
      <RankingRevendedoresCard sorteoId={id} sorteoNombre={nombreSorteo} />
    </div>
  );
}
