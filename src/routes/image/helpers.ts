import { registerFont } from "canvas";
import type { CanvasRenderingContext2D } from "canvas";
import path from "path";
import fs from "fs";
import multer from "multer";

// ─── Canvas helpers ───────────────────────────────────────────────────────────

export function stripAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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
  ctx.fillText(stripAccents(str), x, y);
}

export function drawMultilineText(
  ctx: CanvasRenderingContext2D,
  str: string, x: number, y: number,
  font: string, color = "#1a1a2e",
  lineHeight: number,
  align: CanvasTextAlign = "center"
) {
  const lines = str.split("\n");
  const totalH = (lines.length - 1) * lineHeight;
  ctx.font         = font;
  ctx.fillStyle    = color;
  ctx.textAlign    = align;
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    ctx.fillText(stripAccents(line), x, y - totalH / 2 + i * lineHeight);
  });
}

export function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, radius: number,
  fillColor: string, fillAlpha = 1,
  strokeColor = "", strokeAlpha = 0, strokeWidth = 0
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  if (fillAlpha > 0) {
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  if (strokeColor && strokeWidth > 0 && strokeAlpha > 0) {
    ctx.globalAlpha = strokeAlpha;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
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
  // Normalize to prevent path traversal — ensure the resolved path stays within its parent dir
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const safePath = path.join(dir, base);
  try { fs.unlinkSync(safePath); } catch { /* file didn't exist */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fs.writeFileSync as any)(safePath, buffer);
}
