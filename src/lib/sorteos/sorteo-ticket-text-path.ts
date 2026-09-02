import "server-only";

export type { TicketPathWeight, TicketFontFamily } from "@/lib/sorteos/sorteo-ticket-font-svg-path";
export {
  getSorteoInterFont,
  getSorteoTicketFont,
  normalizeTicketFontWeight,
  measureTicketTextWidth,
  svgTextAsPath,
} from "@/lib/sorteos/sorteo-ticket-font-svg-path";
