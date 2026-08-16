import { registerFont, loadImage, createCanvas } from "canvas";
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
 * target box on whichever axis needs more scaling, then crops the other
 * axis to fit — never stretches the image out of its aspect ratio.
 * Equivalent to CSS `object-fit: cover`. Horizontal overflow is center-
 * cropped, but vertical overflow is anchored to the top (like
 * `object-position: top`) rather than centered, since portrait player
 * photos usually have the face near the top — centering would cut into
 * it whenever there's more headroom above than below. Draws nothing if
 * img is null.
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
  const srcY = 0;
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
  limits: { fileSize: 8 * 1024 * 1024 },
});

/**
 * node-canvas can only decode PNG/JPEG/GIF — never WebP or AVIF, regardless
 * of system libraries. Browsers happily display those formats directly
 * (e.g. via the static file route), which makes a bad upload look "fine"
 * until it's rendered into a generated image and fails there instead.
 * Throws with a clear message if the buffer isn't decodable, so upload
 * routes can reject it up front instead of silently persisting it.
 */
export async function assertDecodableImage(buffer: Buffer): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadImage(buffer as any);
  } catch {
    throw new Error(
      "Format d'image non supporté (WebP et AVIF ne sont pas décodables par le générateur — utilisez PNG ou JPEG)."
    );
  }
}

/**
 * Downscales an uploaded image buffer so neither dimension exceeds
 * maxDimension, preserving aspect ratio — never upscales. Re-encodes as
 * JPEG when the original filename looks like one (smaller output for
 * photos/backgrounds), PNG otherwise (keeps transparency for logos).
 * Assumes the buffer is already known-decodable (see assertDecodableImage);
 * returns the original buffer unchanged if it's already within bounds.
 */
export async function resizeImageBuffer(
  buffer: Buffer,
  maxDimension: number,
  originalName = ""
): Promise<Buffer> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img = await loadImage(buffer as any);
    if (img.width <= maxDimension && img.height <= maxDimension) return buffer;

    const scale = Math.min(maxDimension / img.width, maxDimension / img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx.drawImage(img as any, 0, 0, w, h);

    const isJpeg = /\.jpe?g$/i.test(originalName);
    return isJpeg ? canvas.toBuffer("image/jpeg", { quality: 0.9 }) : canvas.toBuffer("image/png");
  } catch (err) {
    console.warn("[resizeImageBuffer] Failed to resize, keeping original:", err);
    return buffer;
  }
}

export function writeFileSafe(filePath: string, buffer: Buffer): void {
  // Normalize to prevent path traversal — ensure the resolved path stays within its parent dir
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const safePath = path.join(dir, base);
  try { fs.unlinkSync(safePath); } catch { /* file didn't exist */ }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fs.writeFileSync as any)(safePath, buffer);
}
