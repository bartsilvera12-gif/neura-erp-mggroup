import "server-only";

export type { TicketPathWeight } from "@/lib/sorteos/sorteo-ticket-font-svg-path";
export {
  getSorteoInterFont,
  normalizeTicketFontWeight,
  measureTicketTextWidth,
  svgTextAsPath,
} from "@/lib/sorteos/sorteo-ticket-font-svg-path";
