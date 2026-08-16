import { loadImage } from "canvas";
import type { Image } from "canvas";
import path from "path";
import fs from "fs";
import os from "os";

const MAP_PREFIX_RE = /^(de_|cs_|ar_)/;

/** Strip de_/cs_/ar_ prefix and uppercase */
export function stripMapPrefix(name: string): string {
  return name.replace(MAP_PREFIX_RE, "").toUpperCase();
}

/**
 * Attempts to load an image directly (open+read) rather than pre-checking
 * with fs.existsSync first. On some Docker bind-mount setups, stat()-based
 * checks (existsSync) can return a stale ENOENT for a file that readdir()
 * already sees and that open()/read() can access fine — so a separate
 * existence check can produce false negatives. Trying the actual read and
 * catching failure sidesteps that class of bug entirely.
 */
async function tryLoadImageAt(p: string): Promise<Image | null> {
  try {
    return await loadImage(p);
  } catch {
    return null;
  }
}

export async function tryLoadLogo(logoName: string | null | undefined): Promise<Image | null> {
  if (!logoName) return null;
  const dir = path.join(process.cwd(), "public", "img", "logos");
  const exts = [".png", ".svg", ".jpg", ".jpeg", ".webp"];
  const candidates = [...exts.map(e => path.join(dir, logoName + e)), path.join(dir, logoName)];
  for (const p of candidates) {
    const img = await tryLoadImageAt(p);
    if (img) return img;
  }
  return null;
}

export async function tryLoadFlag(flag: string | null | undefined): Promise<Image | null> {
  if (!flag) return null;
  const code = flag.toLowerCase();
  const dir = path.join(process.cwd(), "public", "img", "flags");
  for (const ext of [".png", ".svg", ".jpg"]) {
    const img = await tryLoadImageAt(path.join(dir, code + ext));
    if (img) return img;
  }
  try { return await loadImage(`https://flagcdn.com/w160/${code}.png`); } catch { /* skip */ }
  return null;
}

export async function tryLoadLogoOrFlag(
  logo: string | null | undefined,
  flag: string | null | undefined
): Promise<Image | null> {
  return (await tryLoadLogo(logo)) ?? (await tryLoadFlag(flag));
}

export async function tryLoadMapImage(mapName: string): Promise<Image | null> {
  if (!mapName) return null;
  const dir = path.join(process.cwd(), "public", "img", "maps");
  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  const names = [mapName, mapName.replace(MAP_PREFIX_RE, "")];
  for (const n of names) {
    for (const e of exts) {
      const img = await tryLoadImageAt(path.join(dir, n + e));
      if (img) return img;
    }
  }
  return null;
}

export async function tryLoadPlayerImage(steamId: string): Promise<Image | null> {
  const dir = path.join(process.cwd(), "public", "img", "players");
  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  if (steamId) {
    for (const e of exts) {
      const img = await tryLoadImageAt(path.join(dir, steamId + e));
      if (img) return img;
    }
    let dirListing: string;
    try {
      dirListing = JSON.stringify(fs.readdirSync(dir));
    } catch (err) {
      dirListing = `<readdir failed: ${(err as Error).message}>`;
    }
    console.warn(
      `[tryLoadPlayerImage] No uploaded photo for steamId="${steamId}" (length=${steamId.length}), falling back to default. ` +
      `Checked dir="${dir}" (process.cwd()="${process.cwd()}") on host=${os.hostname()} pid=${process.pid}. ` +
      `Actual dir contents: ${dirListing}`
    );
  }
  for (const e of exts) {
    const img = await tryLoadImageAt(path.join(dir, "default" + e));
    if (img) return img;
  }
  return null;
}
