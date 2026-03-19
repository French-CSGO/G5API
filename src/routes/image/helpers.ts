import { registerFont } from "canvas";
import type { CanvasRenderingContext2D } from "canvas";
import path from "path";
import fs from "fs";
import multer from "multer";

// ─── Canvas helpers ───────────────────────────────────────────────────────────

export function drawText(
  ctx: CanvasRenderingContext2D,
  str: string, x: number, y: number,
  font: string, color = "#1a1a2e",
  align: CanvasTextAlign = "center"
) {
  ctx.font         = font;
  ctx.fillStyle    = color;
  ctx.textAlign    = align;
  ctx.textBaseline = "middle";
  ctx.fillText(str, x, y);
}

export function fieldFont(f: { bold: boolean; size: number; font: string }): string {
  return `${f.bold ? "bold " : ""}${f.size}px ${f.font}`;
}

export function tryRegisterFont(fontFile: string, families: string[]): void {
  if (!fontFile) return;
  const fontsDir = path.join(process.cwd(), "public", "fonts");

  // Si fontFile n'a pas d'extension, chercher le vrai fichier dans le dossier
  let resolvedFile = fontFile;
  if (!/\.(ttf|otf|woff|woff2)$/i.test(fontFile)) {
    const candidates = [`${fontFile}.ttf`, `${fontFile}.otf`, `${fontFile}.woff2`, `${fontFile}.woff`];
    const found = candidates.find(c => fs.existsSync(path.join(fontsDir, c)));
    if (!found) {
      console.warn(`[image] tryRegisterFont: fichier introuvable pour "${fontFile}" dans ${fontsDir}`);
      return;
    }
    resolvedFile = found;
  }

  const fontPath = path.join(fontsDir, resolvedFile).replace(/\\/g, "/");
  const baseName = resolvedFile.replace(/\.[^.]+$/, "");
  const allFamilies = [...new Set([baseName, ...families])];
  allFamilies.forEach(family => {
    try {
      registerFont(fontPath, { family });
    } catch (err) {
      console.warn(`[image] registerFont failed: ${resolvedFile} as "${family}":`, err);
    }
  });
}

// ─── Multer ───────────────────────────────────────────────────────────────────

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

export function writeFileSafe(filePath: string, buffer: Buffer): void {
  try { fs.unlinkSync(filePath); } catch { /* file didn't exist */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fs.writeFileSync as any)(filePath, buffer);
}
