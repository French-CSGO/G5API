import path from "path";
import fs from "fs";

// ─── URL-resolving counterparts of loaders.ts ─────────────────────────────────
// The canvas generators load image *pixels* server-side (via node-canvas'
// loadImage) because they have to composite them into a rasterized PNG. The
// HTML/CSS generators just need a URL the browser can fetch itself — so these
// resolve a filename to whichever static route actually serves it, without
// ever reading the file's bytes.

const MAP_PREFIX_RE = /^(de_|cs_|ar_)/;

function existingFile(dir: string, baseName: string, exts: string[]): string | null {
  for (const ext of exts) {
    if (fs.existsSync(path.join(dir, baseName + ext))) return baseName + ext;
  }
  return null;
}

export function resolveLogoUrl(logoName: string | null | undefined): string | null {
  if (!logoName) return null;
  const dir = path.join(process.cwd(), "public", "img", "logos");
  const found = existingFile(dir, logoName, [".png", ".jpg", ".jpeg", ".webp"])
    ?? (fs.existsSync(path.join(dir, logoName)) ? logoName : null);
  return found ? `/static/img/logos/${encodeURIComponent(found)}` : null;
}

export function resolveFlagUrl(flag: string | null | undefined): string | null {
  if (!flag) return null;
  const code = flag.toLowerCase();
  const dir = path.join(process.cwd(), "public", "img", "flags");
  const found = existingFile(dir, code, [".png", ".jpg", ".jpeg"]);
  if (found) return `/static/img/flags/${encodeURIComponent(found)}`;
  // Pas de drapeau local : on retombe sur le CDN, comme loaders.ts.
  return `https://flagcdn.com/w160/${encodeURIComponent(code)}.png`;
}

export function resolveLogoOrFlagUrl(logo: string | null | undefined, flag: string | null | undefined): string | null {
  return resolveLogoUrl(logo) ?? resolveFlagUrl(flag);
}

export function resolveMapImageUrl(mapName: string): string | null {
  if (!mapName) return null;
  const dir = path.join(process.cwd(), "public", "img", "maps");
  const names = [mapName, mapName.replace(MAP_PREFIX_RE, "")];
  for (const n of names) {
    const found = existingFile(dir, n, [".png", ".jpg", ".jpeg", ".webp"]);
    if (found) return `/static/img/maps/${encodeURIComponent(found)}`;
  }
  return null;
}

export function resolvePlayerImageUrl(steamId: string): string {
  const dir = path.join(process.cwd(), "public", "img", "players");
  if (steamId) {
    const found = existingFile(dir, steamId, [".png", ".jpg", ".jpeg", ".webp"]);
    if (found) return `/static/img/players/${encodeURIComponent(found)}`;
  }
  const fallback = existingFile(dir, "default", [".png", ".jpg", ".jpeg", ".webp"]);
  return fallback ? `/static/img/players/${encodeURIComponent(fallback)}` : "";
}

/** Résout un fichier de police (avec ou sans extension) vers son URL statique + nom de famille. */
export function resolveFontFace(fontFile: string): { family: string; url: string } | null {
  if (!fontFile) return null;
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  let resolvedFile = fontFile;
  if (!/\.(ttf|otf|woff|woff2)$/i.test(fontFile)) {
    const candidates = [`${fontFile}.ttf`, `${fontFile}.otf`, `${fontFile}.woff2`, `${fontFile}.woff`];
    const found = candidates.find(c => fs.existsSync(path.join(fontsDir, c)));
    if (!found) return null;
    resolvedFile = found;
  } else if (!fs.existsSync(path.join(fontsDir, fontFile))) {
    return null;
  }
  const family = resolvedFile.replace(/\.[^.]+$/, "");
  return { family, url: `/static/fonts/${encodeURIComponent(resolvedFile)}` };
}

export function resolveBackgroundUrl(filename: string): string | null {
  if (!filename) return null;
  const dir = path.join(process.cwd(), "public", "img");
  return fs.existsSync(path.join(dir, filename)) ? `/static/img/${encodeURIComponent(filename)}` : null;
}

export function stripMapPrefix(name: string): string {
  return name.replace(MAP_PREFIX_RE, "").toUpperCase();
}
