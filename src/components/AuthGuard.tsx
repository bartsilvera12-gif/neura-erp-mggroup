"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCurrentUser, getSession } from "@/lib/auth";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import {
  firstAccessibleHref,
  isModuleSlugGranted,
  pathRequiresModuleSlug,
} from "@/lib/modulos/route-slug-map";
import ZentraLoader from "@/components/ZentraLoader";
import ServicioSuspendido from "@/components/ServicioSuspendido";
import { BootProvider, useBoot } from "@/components/BootContext";

const PUBLIC_ROUTES = ["/login"];

type ModuleAccess = { superAdmin: boolean; slugs: Set<string> };

/** Servicio cortado por falta de pago: en vez del ERP se muestra el aviso. */
type Bloqueo = { bloqueada: boolean; mensaje: string | null };

function AuthGuardInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { sidebarReady } = useBoot();
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<ModuleAccess | null>(null);
  const [bloqueo, setBloqueo] = useState<Bloqueo | null>(null);

  const isPublic = useMemo(
    () =>
      !!(
        pathname &&
        (PUBLIC_ROUTES.includes(pathname) ||
          pathname === "/rv" ||
          pathname.startsWith("/rv/") ||
          /**
           * La impresión del ticket la abre el vendedor desde su POS, que no tiene sesión de
           * ERP: sin esto el botón «Imprimir ticket» lo mandaba al login. Los datos siguen
           * protegidos en la API, que exige sesión de vendedor —y solo sobre sus ventas— o de
           * usuario del ERP.
           */
          pathname.startsWith("/ticket/"))
      ),
    [pathname]
  );

  useEffect(() => {
    if (isPublic) {
      setLoading(false);
      setAccess(null);
      setBloqueo(null);
      return;
    }

    let cancelled = false;

    async function checkAuthAndModules() {
      setLoading(true);
      const session = await getSession();
      if (cancelled) return;
      if (!session) {
        router.push("/login");
        setLoading(false);
        return;
      }

      const res = await fetchWithSupabaseSession("/api/empresas/module-access", {
        cache: "no-store",
      });
      if (cancelled) return;

      let superAdmin = false;
      let slugs: string[] = [];

      const bootstrapSuper = isBootstrapSuperAdminEmail(session.user.email ?? null);

      if (res.ok) {
        const data = (await res.json()) as {
          superAdmin?: boolean;
          slugs?: string[];
          bloqueada?: boolean;
          mensajeBloqueo?: string | null;
        };
        superAdmin = !!data.superAdmin || bootstrapSuper;
        slugs = Array.isArray(data.slugs) ? data.slugs : [];
        if (data.bloqueada && !superAdmin) {
          setBloqueo({ bloqueada: true, mensaje: data.mensajeBloqueo ?? null });
          setAccess({ superAdmin: false, slugs: new Set() });
          setLoading(false);
          return;
        }
        setBloqueo(null);
      } else {
        superAdmin = bootstrapSuper;
      }

      if (!superAdmin) {
        try {
          const cu = await getCurrentUser();
          if ((cu?.rol ?? "").trim() === "super_admin") superAdmin = true;
        } catch {
          /* sin fila usuarios en cliente */
        }
      }

      setAccess({
        superAdmin,
        slugs: new Set(slugs),
      });
      setLoading(false);
    }

    checkAuthAndModules();
    return () => {
      cancelled = true;
    };
  }, [isPublic, router]);

  useEffect(() => {
    if (loading || isPublic || !access || !pathname || bloqueo?.bloqueada) return;

    if (pathname.startsWith("/admin") && !access.superAdmin) {
      router.replace(firstAccessibleHref(access.slugs, { superAdmin: false }));
      return;
    }

    const slug = pathRequiresModuleSlug(pathname);
    if (slug && !access.superAdmin && !isModuleSlugGranted(slug, access.slugs)) {
      const dest = firstAccessibleHref(access.slugs, { superAdmin: access.superAdmin });
      if (dest !== pathname.split("?")[0]) router.replace(dest);
    }
  }, [pathname, access, loading, isPublic, router, bloqueo]);

  /**
   * El loader queda visible mientras se chequea sesión (loading) o mientras el
   * sidebar termina de cargar su menú (sidebarReady). El AppShell se renderiza
   * debajo desde el primer momento para que el Sidebar pueda hacer su fetch.
   */
  const showLoader = !isPublic && (loading || !sidebarReady);

  /** Reemplaza la aplicación entera: no es un cartel encima del ERP. */
  if (!isPublic && bloqueo?.bloqueada) {
    return <ServicioSuspendido mensaje={bloqueo.mensaje} />;
  }

  return (
    <>
      {/* Renderizamos los children inmediatamente para que el Sidebar pueda fetch */}
      {(!loading || isPublic) && children}
      {showLoader ? <ZentraLoader overlay /> : null}
    </>
  );
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  return (
    <BootProvider>
      <AuthGuardInner>{children}</AuthGuardInner>
    </BootProvider>
  );
}
