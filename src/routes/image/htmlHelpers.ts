import type { FC, FX } from "./types.js";
import { stripAccents } from "./helpers.js";

// ─── HTML/CSS rendering helpers (page-based visuals) ──────────────────────────
// Counterpart of helpers.ts, but emitting HTML/CSS strings instead of drawing
// onto a node-canvas context. Every field keeps the exact same (x, y) center-
// point coordinate model as the canvas settings so the same ImageSettings
// JSON drives both renderers without any migration.
//
// Unlike canvas (which only ever paints pixels — a malformed setting just
// renders wrong), string-building HTML means any settings-derived value that
// reaches markup or CSS text is a potential injection point: ImageSettings is
// loose JSON (not runtime-validated) and the live-preview endpoints accept it
// straight from a request body. Every value below is therefore coerced to a
// safe number or run through an allowlist before interpolation — never
// trusted as-is, regardless of where it came from.

/** Escapes text for safe use as HTML element content or inside a <style> text node. */
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes text for safe use inside an HTML attribute value. */
export function escapeAttr(str: string): string {
  return escapeHtml(str);
}

/** Coerces to a finite number, defaulting anything else (NaN, strings, objects…) to 0. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Coerces to a finite [0, 1] alpha value. */
function alpha01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0, n));
}

/** Allowlists a CSS color (#hex, rgb()/rgba(), or a short alpha keyword) — anything else falls back. */
function safeColor(v: unknown, fallback = "#000000"): string {
  const s = String(v ?? "");
  return /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|[a-zA-Z]{2,20})$/.test(s) ? s : fallback;
}

/** Allowlists a font-family name to plain identifier characters. */
function safeFontFamily(v: unknown, fallback = "Arial"): string {
  const s = String(v ?? "").trim();
  return s && /^[a-zA-Z0-9 _.-]{1,64}$/.test(s) ? s : fallback;
}

function fontFamilyList(font: string): string {
  // Single-quoted: this value is interpolated into a double-quoted style="..."
  // HTML attribute below, where a literal " would truncate the attribute early.
  return `'${safeFontFamily(font)}', Arial, sans-serif`;
}

/**
 * CSS for a single text field (FC, or one row of an FX) centered at (x, y) —
 * equivalent to canvas' textAlign="center" / textBaseline="middle" at (x, y).
 */
export function fieldStyle(f: { font: string; color: string; size: number; bold: boolean }, x: number, y: number): string {
  return [
    "position:absolute",
    `left:${num(x)}px`,
    `top:${num(y)}px`,
    "transform:translate(-50%, -50%)",
    "white-space:nowrap",
    `font-family:${fontFamilyList(f.font)}`,
    `font-size:${num(f.size)}px`,
    `font-weight:${f.bold ? "700" : "400"}`,
    `color:${safeColor(f.color)}`,
  ].join(";");
}

/** Renders a centered text field div, or an empty string if disabled/empty. */
export function textField(f: FC, text: string): string {
  if (!f.enabled) return "";
  return `<div class="field" style="${fieldStyle(f, f.x, f.y)}">${escapeHtml(stripAccents(text))}</div>`;
}

/** Renders one row (index i) of a per-player FX field. */
export function textFieldRow(f: FX, i: number, text: string): string {
  if (!f.enabled) return "";
  return `<div class="field" style="${fieldStyle(f, f.x[i], f.y[i])}">${escapeHtml(stripAccents(text))}</div>`;
}

/** hex/short color → rgba() string. Always emits well-formed CSS regardless of how malformed the input is. */
export function toRgba(hex: string, alphaValue: number): string {
  const clean = String(hex).replace("#", "").replace(/[^0-9a-fA-F]/g, "");
  const full = clean.length === 3 ? clean.split("").map(c => c + c).join("") : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha01(alphaValue)})`;
}

export interface PillShape {
  fill: string; alpha: number; radius: number;
  border?: string; border_alpha?: number; border_width?: number;
}

function pillRules(shape: PillShape, width: number, height: number): string[] {
  const w = num(width);
  const h = num(height);
  const rules = [
    `width:${w}px`,
    `height:${h}px`,
    `border-radius:${Math.min(num(shape.radius), w / 2, h / 2)}px`,
    `background:${toRgba(shape.fill, shape.alpha)}`,
  ];
  const borderWidth = num(shape.border_width);
  if (shape.border && borderWidth > 0 && num(shape.border_alpha) > 0) {
    rules.push(`box-shadow:inset 0 0 0 ${borderWidth}px ${toRgba(shape.border, shape.border_alpha as number)}`);
  }
  return rules;
}

/**
 * CSS for a rounded-rect "pill" centered at (x, y) with the given width/height
 * — equivalent to helpers.ts' drawRoundRect() centered the same way callers
 * use it in the canvas generators (x/y minus half width/height).
 */
export function pillStyle(shape: PillShape, x: number, y: number, width: number, height: number): string {
  return [
    "position:absolute",
    `left:${num(x)}px`,
    `top:${num(y)}px`,
    ...pillRules(shape, width, height),
    "transform:translate(-50%, -50%)",
  ].join(";");
}

/** Absolute-positioned rounded-rect div, top-left anchored (x,y = top-left corner, not center). */
export function pillStyleTopLeft(shape: PillShape, x: number, y: number, width: number, height: number): string {
  return [
    "position:absolute",
    `left:${num(x)}px`,
    `top:${num(y)}px`,
    ...pillRules(shape, width, height),
  ].join(";");
}

/** CSS for a team/tournament logo centered at (x, y), fit within size×size (object-fit: contain). */
export function logoStyle(x: number, y: number, size: number): string {
  return [
    "position:absolute",
    `left:${num(x)}px`,
    `top:${num(y)}px`,
    `width:${num(size)}px`,
    `height:${num(size)}px`,
    "transform:translate(-50%, -50%)",
    "object-fit:contain",
  ].join(";");
}

/**
 * CSS for a player photo centered at (x, y), covering a width×height box
 * (object-fit: cover), anchored to the top (object-position: center top) so
 * portrait photos keep the face in frame — same tradeoff as
 * helpers.ts' drawImageCover(). Optionally cropped to a circle.
 */
export function photoStyle(x: number, y: number, width: number, height: number, circle: boolean): string {
  return [
    "position:absolute",
    `left:${num(x)}px`,
    `top:${num(y)}px`,
    `width:${num(width)}px`,
    `height:${num(height)}px`,
    "transform:translate(-50%, -50%)",
    "object-fit:cover",
    "object-position:center top",
    circle ? "border-radius:50%" : "",
  ].filter(Boolean).join(";");
}

/** Absolute-positioned full-width shaded row, used to shade alternating rows inside a stats table container. */
export function rowShadeStyle(top: number, height: number, fill: string, alphaValue: number): string {
  return [
    "position:absolute",
    "left:0",
    `top:${num(top)}px`,
    "width:100%",
    `height:${num(height)}px`,
    `background:${toRgba(fill, alphaValue)}`,
  ].join(";");
}

/**
 * @font-face block for a custom uploaded font. `fontUrl` must already be a
 * ready-to-use (encoded) URL; `family` is settings-derived (a field's
 * declared font name) so it's allowlisted — this text lands raw inside a
 * <style> text node, where HTML-escaping alone wouldn't stop a value crafted
 * to look like a literal `</style>` close tag.
 */
export function fontFaceCss(fontUrl: string, family: string): string {
  return `@font-face { font-family: "${safeFontFamily(family)}"; src: url("${escapeAttr(fontUrl)}"); }`;
}
