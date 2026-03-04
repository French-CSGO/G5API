import config from "config";
import { RowDataPacket } from "mysql2";
import Utils from "../utility/utils.js";
import { QueueDescriptor } from "../types/queues/QueueDescriptor.js";
import { QueueItem } from "../types/queues/QueueItem.js";
import { createClient } from "redis";
import { db } from "./db.js";
import GameServer from "../utility/serverrcon.js";
import GlobalEmitter from "../utility/emitter.js";
import { generate } from "randomstring";

const redis = createClient({ url: config.get("server.redisUrl") });
const DEFAULT_TTL_SECONDS: number =
  config.get("server.queueTTL") == 0 ? 3600 : config.get("server.queueTTL");

export class QueueService {
  static async createQueue(
    ownerId: string,
    nickname: string,
    maxPlayers: number = 10,
    isPrivate: boolean = false,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<QueueDescriptor> {
    let slug: string;
    let key: string;
    let attempts: number = 0;
    if (redis.isOpen === false) {
      await redis.connect();
    }
    do {
      slug = Utils.generateSlug();
      key = `queue:${slug}`;
      const exists = await redis.exists(key);
      if (!exists) break;
      attempts++;
    } while (attempts < 5);

    if (attempts === 5) {
      throw new Error("Failed to generate a unique queue slug after 5 attempts.");
    }

    const createdAt = Date.now();
    const expiresAt = createdAt + ttlSeconds * 1000;

    const descriptor: QueueDescriptor = {
      name: slug!,
      createdAt,
      expiresAt,
      ownerId,
      maxSize: maxPlayers,
      isPrivate: isPrivate,
      currentPlayers: 1,
    };

    await redis.sAdd("queues", slug!);
    await redis.expire(key!, ttlSeconds);
    await redis.set(`queue-meta:${slug}`, JSON.stringify(descriptor), {
      EX: ttlSeconds,
    });

    await this.addUserToQueue(slug!, ownerId, nickname);

    return descriptor;
  }

  /**
   * Create a match record for a queue after teams have been created.
   * - Picks an available server (public or owned by queue creator) and marks it in_use
   * - Uses the owner's map_list if present, otherwise falls back to default CS2 pool
   */
  static async createMatchFromQueue(
    slug: string,
    teamIds: number[]
  ): Promise<number | null> {
    const meta = await getQueueMetaOrThrow(slug);
    const apiKey = generate({ length: 24, capitalization: "uppercase" });

    const defaultCs2Maps = [
      "de_inferno",
      "de_ancient",
      "de_mirage",
      "de_nuke",
      "de_anubis",
      "de_dust2",
      "de_vertigo",
    ];

    let mapPool: string[] = [];
    let ownerUserId: number | null = await getUserIdFromMetaSlug(slug);
    try {
      if (ownerUserId && ownerUserId > 0) {
        const rows: RowDataPacket[] = await db.query(
          "SELECT map_name FROM map_list WHERE user_id = ? ORDER BY id",
          [ownerUserId]
        );
        if (rows.length) {
          mapPool = rows.map((r: any) => r.map_name).filter(Boolean);
        }
      }
    } catch (err) {
      mapPool = [];
    }
    if (!mapPool || mapPool.length === 0) mapPool = defaultCs2Maps;

    const baseMatch: any = {
      user_id: ownerUserId || 0,
      team1_id: teamIds[0] || null,
      team2_id: teamIds[1] || null,
      start_time: new Date(),
      max_maps: 1,
      title: `[PUG] ${slug}`,
      skip_veto: 0,
      veto_mappool: mapPool.join(" "),
      private_match: meta.isPrivate ? 1 : 0,
      enforce_teams: 1,
      is_pug: 1,
      api_key: apiKey,
      min_player_ready: Math.ceil(meta.maxSize / 2),
    };

    // Fetch candidate servers
    let candidates: RowDataPacket[] = [];
    try {
      if (ownerUserId && ownerUserId > 0) {
        candidates = await db.query(
          "SELECT id, ip_string, port, rcon_password FROM game_server WHERE (public_server=1 OR user_id = ?) AND in_use=0",
          [ownerUserId]
        );
      } else {
        candidates = await db.query(
          "SELECT id, ip_string, port, rcon_password FROM game_server WHERE public_server=1 AND in_use=0"
        );
      }
    } catch (err) {
      candidates = [];
    }

    // Try each available server
    for (const cand of candidates) {
      try {
        const newServer: GameServer = new GameServer(
          cand.ip_string,
          cand.port,
          cand.rcon_password
        );

        const alive = await newServer.isServerAlive();
        const get5av = await newServer.isGet5Available().catch(() => false);
        if (!alive || !get5av) continue;

        const insertSet = await db.buildUpdateStatement({
          ...baseMatch,
          server_id: cand.id,
        }) as any;
        const insertRes: any = await db.query(
          "INSERT INTO `match` SET ?",
          [insertSet]
        );
        const matchId = (insertRes as any).insertId;

        await db.query("UPDATE game_server SET in_use = 1 WHERE id = ?", [
          cand.id,
        ]);

        try {
          const get5Version: string = await newServer.getGet5Version();
          await db.query(
            "UPDATE `match` SET plugin_version = ? WHERE id = ?",
            [get5Version, matchId]
          );
        } catch {
          // ignore version retrieval errors
        }

        try {
          const prepared = await newServer.prepareGet5Match(
            config.get("server.apiURL") + "/matches/" + matchId + "/config",
            apiKey
          );

          if (!prepared) {
            await db.query(
              "DELETE FROM match_spectator WHERE match_id = ?",
              [matchId]
            );
            await db.query(
              "DELETE FROM match_cvar WHERE match_id = ?",
              [matchId]
            );
            await db.query("DELETE FROM `match` WHERE id = ?", [matchId]);
            await db.query(
              "UPDATE game_server SET in_use = 0 WHERE id = ?",
              [cand.id]
            );
            continue;
          }

          await this.deleteQueue(slug, meta.ownerId!);
          (GlobalEmitter as any).emit("queue:full", {
            slug,
            matchId,
            serverId: cand.id,
            teams: teamIds,
          });
          return matchId;
        } catch {
          try {
            await db.query(
              "DELETE FROM match_spectator WHERE match_id = ?",
              [matchId]
            );
            await db.query(
              "DELETE FROM match_cvar WHERE match_id = ?",
              [matchId]
            );
            await db.query("DELETE FROM `match` WHERE id = ?", [matchId]);
            await db.query(
              "UPDATE game_server SET in_use = 0 WHERE id = ?",
              [cand.id]
            );
          } catch {
            // ignore cleanup errors
          }
          continue;
        }
      } catch {
        continue;
      }
    }

    // No server found — create match without server assignment
    await this.deleteQueue(slug, meta.ownerId!);
    try {
      const insertSet = await db.buildUpdateStatement({
        ...baseMatch,
        server_id: null,
      }) as any;
      const insertRes: any = await db.query(
        "INSERT INTO `match` SET ?",
        [insertSet]
      );
      const matchId = (insertRes as any).insertId;
      (GlobalEmitter as any).emit("queue:full", {
        slug,
        matchId,
        serverId: null,
        teams: teamIds,
      });
      return matchId;
    } catch (err) {
      console.error("createMatchFromQueue final insert failed:", err);
      return null;
    }
  }

  static async deleteQueue(
    slug: string,
    requestorSteamId: string,
    role: string = "user"
  ): Promise<void> {
    const key = `queue:${slug}`;
    const metaKey = `queue-meta:${slug}`;
    const meta = await getQueueMetaOrThrow(slug);

    const isOwner = meta.ownerId === requestorSteamId;
    const isAdmin = role === "admin" || role === "super_admin";

    if (!isOwner && !isAdmin) {
      throw new Error("You do not have permission to delete this queue.");
    }

    await redis.del(key);
    await redis.del(metaKey);
    await redis.sRem("queues", slug);
  }

  static async addUserToQueue(
    slug: string,
    steamId: string,
    name: string
  ): Promise<void> {
    const key = `queue:${slug}`;
    const meta = await getQueueMetaOrThrow(slug);

    const currentUsers = await redis.lRange(key, 0, -1);
    const alreadyInQueue = currentUsers.some((item: string) => {
      const parsed = JSON.parse(item);
      return parsed.steamId === steamId;
    });
    if (alreadyInQueue) {
      throw new Error(`Steam ID ${steamId} is already in the queue.`);
    }

    if (meta.maxSize && currentUsers.length >= meta.maxSize) {
      throw new Error(`Queue ${slug} is full.`);
    }

    const hltvRating = await Utils.getRatingFromSteamId(steamId);

    const item: QueueItem = {
      steamId,
      timestamp: Date.now(),
      hltvRating: hltvRating ?? undefined,
      nickname: name,
    };

    meta.currentPlayers += 1;
    await redis.rPush(key, JSON.stringify(item));

    const metaKey = `queue-meta:${slug}`;
    const ttl = await redis.ttl(metaKey);
    await redis.set(metaKey, JSON.stringify(meta), { EX: ttl > 0 ? ttl : DEFAULT_TTL_SECONDS });

    (GlobalEmitter as any).emit("queue:playerJoined", {
      slug,
      currentPlayers: meta.currentPlayers,
      maxSize: meta.maxSize,
      player: item,
    });
  }

  static async removeUserFromQueue(
    slug: string,
    steamId: string,
    requestorSteamId: string,
    role: string = "user"
  ): Promise<boolean> {
    const key = `queue:${slug}`;
    const meta = await getQueueMetaOrThrow(slug);

    if (
      role === "user" &&
      steamId !== requestorSteamId &&
      meta.ownerId !== requestorSteamId
    ) {
      throw new Error(
        "You do not have permission to remove other users from this queue."
      );
    }

    const currentUsers = await redis.lRange(key, 0, -1);
    for (const item of currentUsers) {
      const parsed = JSON.parse(item);
      if (parsed.steamId === steamId) {
        await redis.lRem(key, 1, item);
        meta.currentPlayers = Math.max(0, meta.currentPlayers - 1);

        const metaKey = `queue-meta:${slug}`;
        const ttl = await redis.ttl(metaKey);
        await redis.set(metaKey, JSON.stringify(meta), { EX: ttl > 0 ? ttl : DEFAULT_TTL_SECONDS });

        (GlobalEmitter as any).emit("queue:playerLeft", {
          slug,
          currentPlayers: meta.currentPlayers,
          steamId,
        });
        return true;
      }
    }

    return false;
  }

  static async listUsersInQueue(slug: string): Promise<QueueItem[]> {
    const key = `queue:${slug}`;
    await getQueueMetaOrThrow(slug);

    const rawItems = await redis.lRange(key, 0, -1);
    return rawItems.map((item: string) => JSON.parse(item));
  }

  static async listQueues(
    requestorSteamId: string,
    role: string = "user"
  ): Promise<QueueDescriptor[]> {
    if (redis.isOpen === false) {
      await redis.connect();
    }
    const slugs = await redis.sMembers("queues");
    const descriptors: QueueDescriptor[] = [];

    for (const slug of slugs) {
      const metaRaw = await redis.get(`queue-meta:${slug}`);
      if (!metaRaw) continue;

      const meta: QueueDescriptor = JSON.parse(metaRaw);

      if (
        role === "admin" ||
        role === "super_admin" ||
        meta.ownerId === requestorSteamId ||
        meta.isPrivate === false
      ) {
        descriptors.push(meta);
      }
    }

    return descriptors;
  }

  static async getQueue(
    slug: string,
    role: string,
    requestorSteamId: string
  ): Promise<QueueDescriptor> {
    const meta = await getQueueMetaOrThrow(slug);
    if (
      role === "admin" ||
      role === "super_admin" ||
      meta.ownerId === requestorSteamId ||
      meta.isPrivate === false
    ) {
      return meta;
    }
    throw new Error(
      "You do not have permission to view this queue."
    );
  }

  static async getCurrentQueuePlayerCount(slug: string): Promise<number> {
    const meta = await getQueueMetaOrThrow(slug);
    return meta.currentPlayers;
  }

  static async getCurrentQueueMaxCount(slug: string): Promise<number> {
    const meta = await getQueueMetaOrThrow(slug);
    return meta.maxSize;
  }

  static normalizePlayerRatings(players: QueueItem[]): QueueItem[] {
    const knownRatings = players
      .map((p) => p.hltvRating)
      .filter((r) => typeof r === "number") as number[];
    let fallbackRating = 1.0;
    if (knownRatings.length > 0) {
      knownRatings.sort((a, b) => a - b);
      const mid = Math.floor(knownRatings.length / 2);
      fallbackRating =
        knownRatings.length % 2 === 0
          ? (knownRatings[mid - 1] + knownRatings[mid]) / 2
          : knownRatings[mid];
    }

    return players.map((p) => {
      if (typeof p.hltvRating === "number") return { ...p };
      const jitter = (Math.random() - 0.5) * 0.1 * fallbackRating;
      return { ...p, hltvRating: fallbackRating + jitter };
    });
  }

  /**
   * Create two balanced teams from the queue players.
   * Uses rating-based greedy balancing with a small random factor.
   */
  static async createTeamsFromQueue(slug: string): Promise<number[]> {
    const key = `queue:${slug}`;
    const meta = await getQueueMetaOrThrow(slug);

    if (redis.isOpen === false) {
      await redis.connect();
    }

    const rawItems = await redis.lRange(key, 0, -1);
    if (!rawItems || rawItems.length === 0) {
      throw new Error(`Queue ${slug} is empty.`);
    }

    const maxPlayers = meta.maxSize || rawItems.length;

    if (rawItems.length < maxPlayers) {
      throw new Error(
        `Not enough players in queue to form teams. Have ${rawItems.length}, need ${maxPlayers}.`
      );
    }

    const selectedRaw = rawItems.slice(0, maxPlayers);
    const players: QueueItem[] = selectedRaw.map(
      (r: string) => JSON.parse(r) as QueueItem
    );

    const normPlayers = QueueService.normalizePlayerRatings(players);
    normPlayers.sort(
      (a: QueueItem, b: QueueItem) => (b.hltvRating! - a.hltvRating!)
    );

    const teamA: QueueItem[] = [];
    const teamB: QueueItem[] = [];
    let sumA = 0;
    let sumB = 0;
    const flipProb = 0.1;

    const targetSizeA = Math.ceil(maxPlayers / 2);
    const targetSizeB = Math.floor(maxPlayers / 2);

    for (const p of normPlayers) {
      if (teamA.length >= targetSizeA) {
        teamB.push(p);
        sumB += p.hltvRating!;
        continue;
      }
      if (teamB.length >= targetSizeB) {
        teamA.push(p);
        sumA += p.hltvRating!;
        continue;
      }

      let assignToA = sumA <= sumB;
      if (Math.random() < flipProb) assignToA = !assignToA;

      if (assignToA) {
        teamA.push(p);
        sumA += p.hltvRating!;
      } else {
        teamB.push(p);
        sumB += p.hltvRating!;
      }
    }

    while (teamA.length > targetSizeA) {
      teamA.sort((a, b) => a.hltvRating! - b.hltvRating!);
      const moved = teamA.shift()!;
      sumA -= moved.hltvRating!;
      teamB.push(moved);
      sumB += moved.hltvRating!;
    }
    while (teamB.length > targetSizeB) {
      teamB.sort((a, b) => a.hltvRating! - b.hltvRating!);
      const moved = teamB.shift()!;
      sumB -= moved.hltvRating!;
      teamA.push(moved);
      sumA += moved.hltvRating!;
    }

    const captainA = teamA[0];
    const captainB = teamB[0];

    const teams = [
      { name: `team_${captainA?.nickname ?? "A"}`, members: teamA },
      { name: `team_${captainB?.nickname ?? "B"}`, members: teamB },
    ];

    let ownerUserId: number | null = await getUserIdFromMetaSlug(slug);

    const teamIds: number[] = [];
    for (const t of teams) {
      const teamInsert = await db.query(
        "INSERT INTO team (user_id, name, flag, logo, tag, public_team) VALUES ?",
        [[[ownerUserId, t.name, null, null, null, 0]]]
      );
      const insertedTeamId = (teamInsert as any).insertId || null;
      if (insertedTeamId) {
        teamIds.push(insertedTeamId);
        const authRows: Array<Array<any>> = [];
        for (let i = 0; i < t.members.length; i++) {
          const member = t.members[i];
          const isCaptain = i === 0 ? 1 : 0;
          authRows.push([insertedTeamId, member.steamId, "", isCaptain, 0]);
        }
        if (authRows.length > 0) {
          await db.query(
            "INSERT INTO team_auth_names (team_id, auth, name, captain, coach) VALUES ?",
            [authRows]
          );
        }
      }
    }
    return teamIds;
  }
}

async function getUserIdFromMetaSlug(slug: string): Promise<number | null> {
  const meta = await getQueueMetaOrThrow(slug);
  if (!meta.ownerId) return null;

  try {
    const ownerRows = await db.query(
      "SELECT id FROM user WHERE steam_id = ?",
      [meta.ownerId]
    );
    if (ownerRows.length) {
      return ownerRows[0].id;
    }
  } catch {
    return 0;
  }
  return 0;
}

async function getQueueMetaOrThrow(slug: string): Promise<QueueDescriptor> {
  if (redis.isOpen === false) {
    await redis.connect();
  }
  const metaKey = `queue-meta:${slug}`;
  const members = await redis.sMembers("queues");
  if (!members.includes(slug)) {
    throw new Error(`Queue ${slug} does not exist or has expired.`);
  }

  const metaRaw = await redis.get(metaKey);
  if (!metaRaw) {
    throw new Error(`Queue metadata missing for ${slug}.`);
  }

  return JSON.parse(metaRaw);
}

export default QueueService;
