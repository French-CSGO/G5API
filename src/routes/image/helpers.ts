import { registerFont, loadImage } from "canvas";
import type { CanvasRenderingContext2D, Image as CanvasImage } from "canvas";
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

/**
 * Draws a logo/flag centered at (cfg.x, cfg.y), scaled to fit within a
 * cfg.size × cfg.size box while preserving its native aspect ratio
 * (equivalent to CSS `object-fit: contain`) — never stretches non-square
 * images (e.g. a team flag used as a logo fallback) out of shape.
 */
export function drawLogoCentered(
  ctx: CanvasRenderingContext2D,
  img: CanvasImage | null,
  cfg: { x: number; y: number; size: number }
): void {
  if (!img) return;
  const scale = Math.min(cfg.size / img.width, cfg.size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx.drawImage(img as any, cfg.x - w / 2, cfg.y - h / 2, w, h);
}

/**
 * Draws an image (e.g. a player photo) scaled up so it fully covers the
 * target box on whichever axis needs more scaling, then center-crops the
 * other axis to fit — never stretches the image out of its aspect ratio.
 * Equivalent to CSS `object-fit: cover`. Draws nothing if img is null.
 */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImage | null,
  x: number, y: number, width: number, height: number,
  circle = false
): void {
  if (!img) return;
  const scale = Math.max(width / img.width, height / img.height);
  const srcW = width / scale;
  const srcH = height / scale;
  const srcX = (img.width - srcW) / 2;
  const srcY = (img.height - srcH) / 2;
  const dx = x - width / 2;
  const dy = y - height / 2;
  if (circle) {
    const r = Math.min(width, height) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.drawImage(img as any, srcX, srcY, srcW, srcH, dx, dy, width, height);
    ctx.restore();
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.drawImage(img as any, srcX, srcY, srcW, srcH, dx, dy, width, height);
  }
}

/** Draws a background image; fills with fallbackColor if the image fails to load */
export async function drawBackground(
  ctx: CanvasRenderingContext2D,
  filename: string,
  w: number,
  h: number,
  fallback?: string
): Promise<void> {
  try {
    const img = await loadImage(path.join(process.cwd(), "public", "img", filename));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.drawImage(img as any, 0, 0, w, h);
  } catch {
    if (fallback) {
      ctx.fillStyle = fallback;
      ctx.fillRect(0, 0, w, h);
    }
  }
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
