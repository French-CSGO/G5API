/**
 * Pterodactyl panel integration service.
 * Handles server power management via the Pterodactyl Client API.
 */

import fetch from "node-fetch";
import GameServer from "../utility/serverrcon.js";
import { getSetting, getSettingBool, getSettingInt } from "./settings.js";

function isEnabled(): boolean {
  return getSettingBool("pterodactyl.enabled");
}

function getConfig() {
  const url: string = getSetting("pterodactyl.url");
  const apiKey: string = getSetting("pterodactyl.apiKey");
  return { url: url.replace(/\/$/, ""), apiKey };
}

async function sendPowerSignal(pterodactylId: string, signal: "start" | "stop"): Promise<void> {
  const { url, apiKey } = getConfig();
  const resp = await fetch(`${url}/api/client/servers/${pterodactylId}/power`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ signal }),
  });
  if (!resp.ok && resp.status !== 204) {
    throw new Error(`Pterodactyl power signal '${signal}' failed: HTTP ${resp.status}`);
  }
}

async function getServerState(pterodactylId: string): Promise<string> {
  const { url, apiKey } = getConfig();
  const resp = await fetch(`${url}/api/client/servers/${pterodactylId}/resources`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`Pterodactyl resources check failed: HTTP ${resp.status}`);
  }
  const data: any = await resp.json();
  return data?.attributes?.current_state ?? "unknown";
}

/**
 * Start a Pterodactyl server and wait until the game server is reachable via RCON.
 * @param pterodactylId - Pterodactyl server identifier
 * @param ipString - Game server IP
 * @param port - Game server RCON port
 * @param rconPassword - Encrypted RCON password (will be decrypted by GameServer)
 * @param timeoutMs - Maximum wait time in milliseconds (default 3 minutes)
 */
export async function startAndWait(
  pterodactylId: string,
  ipString: string,
  port: number,
  rconPassword: string,
  timeoutMs = 180000
): Promise<void> {
  if (!isEnabled()) return;

  console.log(`[Pterodactyl] Starting server ${pterodactylId}...`);

  const state = await getServerState(pterodactylId);
  if (state !== "running") {
    await sendPowerSignal(pterodactylId, "start");
  } else {
    console.log(`[Pterodactyl] Server ${pterodactylId} already running`);
  }

  // Wait for Pterodactyl to report "running" then for RCON to respond
  const deadline = Date.now() + timeoutMs;
  const pollInterval = 5000;
  let rconReady = false;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    try {
      const currentState = await getServerState(pterodactylId);
      if (currentState !== "running") {
        console.log(`[Pterodactyl] State: ${currentState}, waiting...`);
        continue;
      }

      const gameServer = new GameServer(ipString, port, rconPassword);
      const alive = await gameServer.isServerAlive();
      if (alive) {
        rconReady = true;
        break;
      }
      console.log(`[Pterodactyl] Server running but RCON not yet ready, waiting...`);
    } catch {
      // transient errors during startup, continue polling
    }
  }

  if (!rconReady) {
    throw new Error(
      `[Pterodactyl] Server ${pterodactylId} did not become ready within ${timeoutMs / 1000}s`
    );
  }
  console.log(`[Pterodactyl] Server ${pterodactylId} is ready`);
}

/**
 * Stop a Pterodactyl server after an optional delay.
 * @param pterodactylId - Pterodactyl server identifier
 * @param delayMs - Delay before stopping in milliseconds (default from config, 5 minutes)
 */
export async function stopAfterDelay(
  pterodactylId: string,
  delayMs?: number
): Promise<void> {
  if (!isEnabled()) return;

  let delay = delayMs;
  if (delay === undefined) {
    delay = getSettingInt("pterodactyl.shutdownDelay") || 300000;
  }

  console.log(`[Pterodactyl] Scheduling stop of server ${pterodactylId} in ${delay! / 1000}s`);
  setTimeout(async () => {
    try {
      console.log(`[Pterodactyl] Stopping server ${pterodactylId}...`);
      await sendPowerSignal(pterodactylId, "stop");
      console.log(`[Pterodactyl] Server ${pterodactylId} stopped`);
    } catch (err) {
      console.error(`[Pterodactyl] Failed to stop server ${pterodactylId}:`, err);
    }
  }, delay);
}

export function getShutdownDelay(): number {
  return getSettingInt("pterodactyl.shutdownDelay") || 300000;
}

export { isEnabled };
