"use client";

import { usePathname } from "next/navigation";
import Sidebar from "./layout/Sidebar";
import Header from "./layout/Header";

const STANDALONE_ROUTES = ["/login"];

/**
 * Pantallas del vendedor: el POS por link mágico y la impresión del ticket. Viven fuera del
 * chrome del ERP porque quien las usa no es usuario del ERP: no tiene sesión, ni menú, ni
 * módulos. La del ticket además se imprime, y el encabezado saldría en el papel.
 */
function isRevendedorPos(pathname: string | null): boolean {
  if (!pathname) return false;
  return (
    pathname === "/rv" ||
    pathname.startsWith("/rv/") ||
    pathname.startsWith("/ticket/")
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStandalone =
    pathname && (STANDALONE_ROUTES.includes(pathname) || isRevendedorPos(pathname));

  if (isStandalone) {
    return <>{children}</>;
  }

  return (
    <div id="neura-app-shell" className="flex h-svh min-h-0 overflow-hidden bg-[#F8FAFC]">
      <Sidebar />
      <div id="neura-main-column" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main id="neura-main-content" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
