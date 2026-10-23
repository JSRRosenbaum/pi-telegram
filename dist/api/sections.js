/**
 * Public Telegram sections API
 * Zones: package boundary, extension interop
 * Exposes the stable managed Telegram menu-section surface while keeping registry internals package-private
 */
export { getTelegramSectionCallbackData, getTelegramSectionDiagnostics, registerTelegramSection, } from "../lib/sections.js";
