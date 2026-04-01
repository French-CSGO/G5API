/**
 * Service de configuration stockée en base de données.
 * Remplace la lecture de config.get() pour toutes les clés non-essentielles au démarrage.
 *
 * Architecture :
 *  - Cache en mémoire (Map) chargé au démarrage
 *  - Toute écriture met à jour la DB ET le cache
 *  - Les services (discord, twitch, pterodactyl) rechargent leurs paramètres via reloadServices()
 */

import { db } from "./db.js";
import { RowDataPacket } from "mysql2";

// ─── Cache en mémoire ────────────────────────────────────────────────────────

const cache = new Map<string, string | null>();
let loaded = false;

// ─── Valeurs par défaut ───────────────────────────────────────────────────────

const DEFAULTS: Record<string, string> = {
  // Discord
  "discord.enabled": "false",
  "discord.token": "",
  "discord.announceChannelId": "",
  "discord.scoreboardChannelId": "",
  "discord.scheduleChannelId": "",
  "discord.guildId": "",
  "discord.eventWebhookUrl": "",

  // Twitch
  "twitch.enabled": "false",
  "twitch.username": "",
  "twitch.token": "",
  "twitch.channels": "[]",

  // Pterodactyl
  "pterodactyl.enabled": "false",
  "pterodactyl.url": "",
  "pterodactyl.apiKey": "",
  "pterodactyl.shutdownDelay": "300000",

  // Toornament
  "toornament.clientId": "",
  "toornament.clientSecret": "",
  "toornament.apiKey": "",
};

// ─── Chargement initial ───────────────────────────────────────────────────────

/**
 * Charge toutes les clés depuis la DB dans le cache.
 * Appeler une fois au démarrage.
 */
export async function loadSettings(): Promise<void> {
  try {
    const rows: RowDataPacket[] = await db.query(
      "SELECT setting_key, setting_value FROM settings",
      []
    );
    for (const row of rows) {
      cache.set(row.setting_key, row.setting_value);
    }
    loaded = true;
    console.log(`[Settings] ${rows.length} paramètre(s) chargé(s) depuis la DB.`);
  } catch (err) {
    console.error("[Settings] Impossible de charger les paramètres depuis la DB :", err);
    loaded = true; // continue avec les valeurs par défaut
  }
}

// ─── Getters ─────────────────────────────────────────────────────────────────

/**
 * Retourne la valeur d'une clé (depuis le cache ou la valeur par défaut).
 */
export function getSetting(key: string): string {
  if (cache.has(key)) {
    return cache.get(key) ?? DEFAULTS[key] ?? "";
  }
  return DEFAULTS[key] ?? "";
}

export function getSettingBool(key: string): boolean {
  return getSetting(key) === "true";
}

export function getSettingInt(key: string): number {
  return parseInt(getSetting(key)) || 0;
}

/**
 * Retourne toutes les clés connues avec leur valeur actuelle.
 */
export function getAllSettings(): Record<string, string> {
  const result: Record<string, string> = { ...DEFAULTS };
  for (const [k, v] of cache.entries()) {
    result[k] = v ?? "";
  }
  return result;
}

// ─── Setters ─────────────────────────────────────────────────────────────────

/**
 * Met à jour une clé en DB et dans le cache.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.query(
    "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) " +
    "ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = NOW()",
    [key, value]
  );
  cache.set(key, value);
}

/**
 * Met à jour plusieurs clés en une seule opération.
 */
export async function setSettings(entries: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    await setSetting(key, value);
  }
}

// ─── Callbacks de rechargement ────────────────────────────────────────────────

type ReloadFn = () => Promise<void>;
const reloadCallbacks: ReloadFn[] = [];

/**
 * Enregistre une fonction de rechargement (appelée par discord.ts, twitch.ts, etc.)
 */
export function onSettingsReload(fn: ReloadFn): void {
  reloadCallbacks.push(fn);
}

/**
 * Recharge tous les services enregistrés.
 * Appelé après une modification de paramètres via l'API.
 */
export async function reloadServices(): Promise<void> {
  await loadSettings();
  for (const fn of reloadCallbacks) {
    try {
      await fn();
    } catch (err) {
      console.error("[Settings] Erreur lors du rechargement d'un service :", err);
    }
  }
}
