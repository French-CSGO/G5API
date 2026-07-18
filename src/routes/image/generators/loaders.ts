import { loadImage } from "canvas";
import type { Image } from "canvas";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import Utils from "../../../utility/utils.js";
import { writeFileSafe } from "../helpers.js";

const MAP_PREFIX_RE = /^(de_|cs_|ar_)/;

/** Strip de_/cs_/ar_ prefix and uppercase */
export function stripMapPrefix(name: string): string {
  return name.replace(MAP_PREFIX_RE, "").toUpperCase();
}

export async function tryLoadLogo(logoName: string | null | undefined): Promise<Image | null> {
  if (!logoName) return null;
  const dir = path.join(process.cwd(), "public", "img", "logos");
  const exts = [".png", ".svg", ".jpg", ".jpeg", ".webp"];
  const candidates = [...exts.map(e => path.join(dir, logoName + e)), path.join(dir, logoName)];
  for (const p of candidates) {
    if (fs.existsSync(p)) { try { return await loadImage(p); } catch { /* skip */ } }
  }
  return null;
}

export async function tryLoadFlag(flag: string | null | undefined): Promise<Image | null> {
  if (!flag) return null;
  const code = flag.toLowerCase();
  const dir = path.join(process.cwd(), "public", "img", "flags");
  for (const ext of [".png", ".svg", ".jpg"]) {
    const p = path.join(dir, code + ext);
    if (fs.existsSync(p)) { try { return await loadImage(p); } catch { /* skip */ } }
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
      const p = path.join(dir, n + e);
      if (fs.existsSync(p)) { try { return await loadImage(p); } catch { /* skip */ } }
    }
  }
  return null;
}

export async function tryLoadPlayerImage(steamId: string): Promise<Image | null> {
  const dir = path.join(process.cwd(), "public", "img", "players");
  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  if (steamId) {
    for (const e of exts) {
      const p = path.join(dir, steamId + e);
      if (fs.existsSync(p)) { try { return await loadImage(p); } catch { /* skip */ } }
    }
    // No manually-uploaded photo — fall back to the player's live Steam avatar
    const steamImg = await tryLoadSteamAvatar(steamId, dir);
    if (steamImg) return steamImg;
  }
  for (const e of exts) {
    const p = path.join(dir, "default" + e);
    if (fs.existsSync(p)) { try { return await loadImage(p); } catch { /* skip */ } }
  }
  return null;
}

/** Fetches the player's Steam avatar and caches it to disk as {steamId}.png for future calls. */
async function tryLoadSteamAvatar(steamId: string, playersDir: string): Promise<Image | null> {
  try {
    const avatarUrl = await Utils.getSteamImage(steamId);
    if (!avatarUrl) return null;
    const res = await fetch(avatarUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const img = await loadImage(buffer);
    try {
      if (!fs.existsSync(playersDir)) fs.mkdirSync(playersDir, { recursive: true });
      writeFileSafe(path.join(playersDir, `${steamId}.png`), buffer);
    } catch { /* caching is best-effort */ }
    return img;
  } catch {
    return null;
  }
}
