import { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { db } from "./db.js";
import { getSetting, setSetting } from "./settings.js";
import config from "config";
import { RowDataPacket } from "mysql2/typings/mysql";
import GlobalEmitter from "../utility/emitter.js";
import { CHALLONGE_V2_BASE, challongeHeaders, challongeFetch, parseV2Match, parseV2Participant } from "../utility/challongeV2.js";
import { maxMapsFromFormat } from "./toornament.js";

let client: Client | null = null;

// ─── Challonge bracket cache ──────────────────────────────────────────────────
// updateSchedule() runs every minute, but Challonge brackets rarely change that
// often, so cache each bracket's matches/participants for a few minutes to
// avoid hammering the Challonge API quota.
const CHALLONGE_CACHE_TTL_MS = 5 * 60 * 1000;
interface ChallongeBracketData {
  rawMatches: any[];
  participantMap: Map<number, string>;
}
const challongeBracketCache = new Map<string, { data: ChallongeBracketData; expiresAt: number }>();

async function getChallongeBracketData(slug: string, headers: Record<string, string>): Promise<ChallongeBracketData> {
  const cached = challongeBracketCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Pas de filtre state=open ici : certains types de bracket (ex. une
  // "Bracket Consolante" alimentée par les perdants d'un autre bracket) ne
  // font jamais transiter leurs matchs en state "open" côté Challonge tant
  // que le round précédent n'est pas entièrement finalisé, même quand les
  // deux participants sont déjà connus — ça les faisait disparaître du
  // planning. On filtre plutôt côté appelant sur player1_id/player2_id
  // (participants connus) et state !== "complete" (pas déjà joué).
  const mRes = await challongeFetch(
    `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?per_page=500`,
    { headers }
  ).catch(() => null);
  const mData: any = mRes?.ok ? await mRes.json().catch(() => null) : null;
  const rawMatches: any[] = Array.isArray(mData?.data) ? mData.data : (mData?.data ? [mData.data] : []);

  const participantMap = new Map<number, string>();
  const pRes = await challongeFetch(
    `${CHALLONGE_V2_BASE}/tournaments/${slug}/participants.json?per_page=500`,
    { headers }
  ).catch(() => null);
  if (pRes?.ok) {
    const pData: any = await pRes.json().catch(() => null);
    const rawParts: any[] = Array.isArray(pData?.data) ? pData.data : [];
    for (const p of rawParts) {
      const part = parseV2Participant(p);
      participantMap.set(part.id, part.display_name);
    }
  }

  const data: ChallongeBracketData = { rawMatches, participantMap };
  challongeBracketCache.set(slug, { data, expiresAt: Date.now() + CHALLONGE_CACHE_TTL_MS });
  return data;
}

function isDiscordEnabled(): boolean {
  return getSetting("discord.enabled") === "true" || getSetting("discord.enabled") === "1";
}

// ─── Channel helpers ──────────────────────────────────────────────────────────

function getChannels(key: string): string[] {
  try {
    const val = getSetting(key);
    if (!val || val === "[]") return [];
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getChannelsOrDefault(key: string): string[] {
  const channels = getChannels(key);
  return channels.length ? channels : getChannels("discord.channels.default");
}

function normalizeRoleName(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s\-]/gu, "").trim().toLowerCase();
}

// Supporte channel ID (bot) et webhook URL — pour les types one-shot
// `content` est envoyé en dehors de l'embed : Discord ne notifie les mentions
// (<@id>, <@&roleId>) que si elles sont dans le texte du message, jamais
// depuis un champ d'embed.
async function sendEmbedToTargets(targets: string[], embed: EmbedBuilder, content?: string): Promise<void> {
  for (const target of targets) {
    try {
      if (target.startsWith("https://discord.com/api/webhooks/")) {
        await fetch(target, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, embeds: [embed.toJSON()] }),
        });
      } else {
        if (!client?.isReady()) continue;
        const ch = await client.channels.fetch(target) as TextChannel;
        await ch.send({ content, embeds: [embed] });
      }
    } catch (err) {
      console.error(`Discord sendEmbedToTargets [${target.slice(0, 60)}]:`, (err as Error).message);
    }
  }
}

// ─── Message ID persistence (DB) ─────────────────────────────────────────────

function getMsgId(type: "scoreboard" | "schedule", channelId: string): string {
  return getSetting(`discord.msgid.${type}.${channelId}`) || "0";
}

async function saveMsgId(type: "scoreboard" | "schedule", channelId: string, msgId: string): Promise<void> {
  await setSetting(`discord.msgid.${type}.${channelId}`, msgId);
}

// ─── Toornament token ─────────────────────────────────────────────────────────

async function getToornamentToken(): Promise<string | null> {
  try {
    const clientId: string = getSetting("toornament.clientId");
    const clientSecret: string = getSetting("toornament.clientSecret");
    const apiKey: string = getSetting("toornament.apiKey");
    if (!clientId || !clientSecret || !apiKey ||
        clientId === "toornament_client_id_go_here") return null;
    const tokenResponse = await fetch("https://api.toornament.com/oauth/v2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "organizer:admin organizer:view organizer:result organizer:participant"
      })
    });
    const tokenData = await tokenResponse.json() as { access_token?: string };
    return tokenData.access_token || null;
  } catch {
    return null;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initDiscord(): Promise<void> {
  if (!isDiscordEnabled()) return;
  try {
    const token: string = getSetting("discord.token");
    if (!token) return;

    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.once("clientReady", async (c) => {
      console.log(`Discord bot connected as ${c.user.tag}`);

      const commands = [
        new SlashCommandBuilder()
          .setName("refresh-schedule")
          .setDescription("Rafraîchit le message des matchs disponibles")
          .toJSON(),
        new SlashCommandBuilder()
          .setName("purge")
          .setDescription("Supprime tous les messages du channel actuel")
          .toJSON(),
        new SlashCommandBuilder()
          .setName("test-pings")
          .setDescription("Envoie un message taguant toutes les équipes d'une saison pour vérifier les pings")
          .addStringOption(option =>
            option
              .setName("saison")
              .setDescription("Saison à tester")
              .setRequired(true)
              .setAutocomplete(true)
          )
          .toJSON()
      ];
      const rest = new REST().setToken(token);
      const guildId: string = getSetting("discord.guildId");
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(c.user.id, guildId), { body: commands });
        await rest.put(Routes.applicationCommands(c.user.id), { body: [] });
      } else {
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
      }

      updateScoreboard();
      updateSchedule();
      setInterval(updateSchedule, 60 * 1000);
      checkStalledMatches();
      setInterval(checkStalledMatches, 60 * 1000);
    });

    client.on("interactionCreate", async (interaction) => {
      if (interaction.isAutocomplete()) {
        if (interaction.commandName === "test-pings") {
          const focused = interaction.options.getFocused();
          const seasons: RowDataPacket[] = await db.query(
            "SELECT id, name FROM season WHERE name LIKE ? ORDER BY id DESC LIMIT 25",
            [`%${focused}%`]
          );
          await interaction.respond(
            seasons.map(s => ({ name: s.name as string, value: String(s.id) }))
          );
        }
        return;
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "refresh-schedule") {
        await interaction.deferReply({ ephemeral: true });
        await updateSchedule();
        await interaction.editReply("✅ Schedule rafraîchi.");
      }
      if (interaction.commandName === "test-pings") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const seasonId = parseInt(interaction.options.getString("saison", true), 10);
          const seasonRows: RowDataPacket[] = await db.query(
            "SELECT id, name FROM season WHERE id = ?",
            [seasonId]
          );
          if (!seasonRows.length) {
            await interaction.editReply("❌ Saison introuvable.");
            return;
          }

          const teamRows: RowDataPacket[] = await db.query(
            "SELECT t.id, t.name FROM team t " +
            "INNER JOIN teams_seasons ts ON ts.teams_id = t.id WHERE ts.season_id = ? ORDER BY t.name ASC",
            [seasonId]
          );
          if (!teamRows.length) {
            await interaction.editReply(`❌ Aucune équipe associée à la saison **${seasonRows[0].name}**.`);
            return;
          }

          const channelIds = getChannels("discord.channels.default");
          if (!channelIds.length) {
            await interaction.editReply("❌ Aucun salon configuré (discord.channels.default).");
            return;
          }

          let sentTo = 0;
          for (const channelId of channelIds) {
            try {
              const channel = await client!.channels.fetch(channelId) as TextChannel;
              const guild = channel.guild;
              const mentions = teamRows.map(t => {
                const norm = normalizeRoleName(t.name);
                const role = guild.roles.cache.find(r => normalizeRoleName(r.name) === norm);
                return role ? `<@&${role.id}>` : `**${t.name}**`;
              });
              await channel.send(
                `🔔 **Test de ping — Saison ${seasonRows[0].name}**\n${mentions.join(" ")}`
              );
              sentTo++;
            } catch (err) {
              console.error(`Discord test-pings [${channelId}]:`, (err as Error).message);
            }
          }

          await interaction.editReply(
            sentTo
              ? `✅ Message envoyé dans ${sentTo} salon(s) pour ${teamRows.length} équipe(s) de la saison **${seasonRows[0].name}**.`
              : "❌ Échec de l'envoi dans tous les salons configurés."
          );
        } catch (err) {
          console.error("Discord test-pings error:", (err as Error).message);
          await interaction.editReply("❌ Erreur lors de l'envoi du test de ping.");
        }
      }
      if (interaction.commandName === "purge") {
        await interaction.deferReply({ ephemeral: true });
        try {
          const channel = interaction.channel as TextChannel;
          let total = 0;
          let hasMore = true;
          while (hasMore) {
            const fetched = await channel.messages.fetch({ limit: 100 });
            if (!fetched.size) break;
            const bulk = await channel.bulkDelete(fetched, true);
            total += bulk.size;
            const remaining = fetched.filter(m => !bulk.has(m.id));
            for (const msg of remaining.values()) {
              await msg.delete().catch(() => {});
              total++;
            }
            hasMore = fetched.size === 100;
          }
          await interaction.editReply(`✅ ${total} message(s) supprimé(s).`);
        } catch (err) {
          console.error("Discord purge error:", (err as Error).message);
          await interaction.editReply("❌ Erreur lors de la suppression.");
        }
      }
    });

    await client.login(token);

    GlobalEmitter.on("matchUpdate", updateScoreboard);
    GlobalEmitter.on("mapStatUpdate", updateScoreboard);
    GlobalEmitter.on("matchUpdate", updateSchedule);
  } catch (err) {
    console.error("Discord init failed:", (err as Error).message);
  }
}

// ─── Match Annonce ────────────────────────────────────────────────────────────

export async function announceNewMatch(matchId: number): Promise<void> {
  if (!isDiscordEnabled()) return;
  const channelIds = getChannelsOrDefault("discord.channels.announce");
  if (!channelIds.length) {
    console.warn(
      `Discord announceNewMatch: no channel configured (discord.channels.announce / discord.channels.default), match ${matchId} not announced.`
    );
    return;
  }
  if (!client?.isReady()) {
    console.warn(`Discord announceNewMatch: client not ready, match ${matchId} not announced.`);
    return;
  }
  try {
    const sql =
      "SELECT m.team1_string, m.team2_string, gs.ip_string, gs.port " +
      "FROM `match` m LEFT JOIN game_server gs ON m.server_id = gs.id WHERE m.id = ?";
    const rows: RowDataPacket[] = await db.query(sql, [matchId]);
    if (!rows.length) {
      console.warn(`Discord announceNewMatch: match ${matchId} not found in DB, not announced.`);
      return;
    }

    const match = rows[0];
    const serverIP = match.ip_string ? `${match.ip_string}:${match.port}` : "N/A";
    const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

    for (const channelId of channelIds) {
      try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        const guild = channel.guild;
        const getRoleMention = (name: string) => {
          const norm = normalizeRoleName(name);
          const role = guild.roles.cache.find(r => normalizeRoleName(r.name) === norm);
          return role ? `<@&${role.id}>` : `**${name}**`;
        };
        const t1 = getRoleMention(match.team1_string);
        const t2 = getRoleMention(match.team2_string);
        await channel.send(
          `🎮 **Match lancé :** ${t1} vs ${t2}\n🕒 Heure de début : \`${time}\`\n🖥️ IP : \`connect ${serverIP}\``
        );
      } catch (err) {
        console.error(`Discord announceNewMatch [${channelId}]:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("Discord announceNewMatch error:", (err as Error).message);
  }
}

// ─── Suivi des matchs (Scoreboard) ───────────────────────────────────────────

export async function updateScoreboard(): Promise<void> {
  const channelIds = getChannels("discord.channels.scoreboard");
  if (!client?.isReady() || !channelIds.length) return;
  try {
    const matchSql =
      "SELECT m.id, m.team1_string, m.team2_string, m.team1_score, m.team2_score, " +
      "m.pending_veto, gs.ip_string, gs.port " +
      "FROM `match` m LEFT JOIN game_server gs ON m.server_id = gs.id " +
      "WHERE m.end_time IS NULL AND m.cancelled = 0 ORDER BY m.id ASC";
    const matches: RowDataPacket[] = await db.query(matchSql, []);

    const recentSql =
      "SELECT m.id, m.team1_string, m.team2_string, m.team1_score, m.team2_score " +
      "FROM `match` m " +
      "WHERE m.end_time IS NOT NULL AND m.cancelled = 0 " +
      "AND m.end_time >= NOW() - INTERVAL 5 MINUTE ORDER BY m.end_time DESC";
    const recentMatches: RowDataPacket[] = await db.query(recentSql, []);

    let content = "";
    if (matches.length === 0) {
      content = "🟡 Aucun match en cours actuellement.";
    } else {
      for (const match of matches) {
        if (match.pending_veto) {
          content +=
            `• **${match.team1_string}** vs **${match.team2_string}**` +
            ` | 🗳️ Véto en cours...\n\n`;
          continue;
        }
        const serverIP = match.ip_string ? `${match.ip_string}:${match.port}` : "N/A";
        const mapSql =
          "SELECT map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY id ASC";
        const maps: RowDataPacket[] = await db.query(mapSql, [match.id]);
        const mapsFormatted = maps
          .map(m => ` | \`${m.map_name}\` : ${m.team1_score}-${m.team2_score}`)
          .join("");
        content +=
          `• **${match.team1_string}** vs **${match.team2_string}**` +
          ` | Série: **${match.team1_score}-${match.team2_score}**` +
          ` | 🖥️ \`connect ${serverIP}\`` +
          `${mapsFormatted}\n\n`;
      }
    }

    if (recentMatches.length > 0) {
      content = content.trimEnd();
      content += `\n\n**Terminés récemment**\n`;
      for (const m of recentMatches) {
        const winner = m.team1_score > m.team2_score ? m.team1_string
          : m.team2_score > m.team1_score ? m.team2_string : null;
        content += `✅ **${m.team1_string}** ${m.team1_score}–${m.team2_score} **${m.team2_string}**`;
        if (winner) content += ` | Victoire **${winner}**`;
        content += `\n`;
      }
    }

    for (const channelId of channelIds) {
      try {
        const ch = await client.channels.fetch(channelId) as TextChannel;
        const existing = getMsgId("scoreboard", channelId);
        let newId: string;
        if (existing === "0") {
          const msg = await ch.send(content);
          newId = msg.id;
        } else {
          try {
            const msg = await ch.messages.fetch(existing);
            await msg.edit(content);
            newId = existing;
          } catch (fetchErr: any) {
            if (fetchErr?.code === 10008) {
              // Message deleted — send a new one
              const msg = await ch.send(content);
              newId = msg.id;
            } else {
              // Transient error (network, DNS...) — keep existing ID, skip update
              newId = existing;
            }
          }
        }
        if (newId !== existing) await saveMsgId("scoreboard", channelId, newId);
      } catch (err) {
        console.error(`Discord updateScoreboard [${channelId}]:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("Discord updateScoreboard error:", (err as Error).message);
  }
}

// ─── Match à Lancer (Schedule) ────────────────────────────────────────────────

export async function updateSchedule(): Promise<void> {
  const channelIds = getChannels("discord.channels.schedule");
  if (!client?.isReady() || !channelIds.length) return;
  try {
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    const seasons: RowDataPacket[] = await db.query(
      "SELECT id, name, challonge_url FROM season WHERE challonge_url LIKE 't:%'",
      []
    );

    let content = "";

    if (token && apiKey && seasons.length > 0) {
      for (const season of seasons) {
        const tournamentId = (season.challonge_url as string).replace(/^t:/, "");

        let matches: any[] = [];
        let rangeStart = 0;
        let hasMore = true;
        while (hasMore) {
          const response = await fetch(
            `https://api.toornament.com/organizer/v2/matches?tournament_ids=${tournamentId}&statuses=pending&sort=structure`,
            {
              headers: {
                "Authorization": `Bearer ${token}`,
                "x-api-key": apiKey,
                "Range": `matches=${rangeStart}-${rangeStart + 99}`
              }
            }
          );
          const page = await response.json() as any[];
          if (!Array.isArray(page) || !page.length) break;
          matches = matches.concat(page);
          const contentRange = response.headers.get("Content-Range");
          if (contentRange) {
            const total = parseInt(contentRange.split("/")[1]);
            hasMore = matches.length < total;
            rangeStart += 100;
          } else {
            hasMore = false;
          }
        }
        if (!matches.length) continue;

        const challongeIds = matches.flatMap((m: any) =>
          m.opponents.map((o: any) => o.participant?.id).filter(Boolean)
        );
        const teamByChallongeId = new Map<string, any>();
        if (challongeIds.length > 0) {
          const localTeams: RowDataPacket[] = await db.query(
            `SELECT id, name, challonge_team_id FROM team WHERE challonge_team_id IN (${challongeIds.map(() => "?").join(",")})`,
            challongeIds
          );
          for (const t of localTeams) teamByChallongeId.set(String(t.challonge_team_id), t);
        }

        const firstRoundByGroup = new Map<string, string>();
        const toShow: any[] = [];
        for (const match of matches) {
          const groupId: string = match.group_id || "none";
          const roundId: string = match.round_id || "none";
          if (!firstRoundByGroup.has(groupId)) firstRoundByGroup.set(groupId, roundId);
          if (roundId !== firstRoundByGroup.get(groupId)) continue;

          const opp1 = match.opponents[0];
          const opp2 = match.opponents[1];
          const team1 = opp1?.participant
            ? (teamByChallongeId.get(String(opp1.participant.id)) ?? { name: opp1.participant.name })
            : null;
          const team2 = opp2?.participant
            ? (teamByChallongeId.get(String(opp2.participant.id)) ?? { name: opp2.participant.name })
            : null;
          if (team1 && team2) toShow.push({ match, team1, team2 });
        }

        if (!toShow.length) continue;

        const roundFormatRows: RowDataPacket[] = await db.query(
          "SELECT round_id, max_maps FROM season_round_format WHERE season_id = ?",
          [season.id]
        );
        const roundFormats = new Map<string, number>(roundFormatRows.map((r: any) => [String(r.round_id), r.max_maps]));

        content += `**${season.name}**\n`;
        for (const { match, team1, team2 } of toShow) {
          const scheduled = match.scheduled_datetime
            ? new Date(match.scheduled_datetime).toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
            : null;
          const maxMaps = maxMapsFromFormat(match.settings?.format) ?? roundFormats.get(String(match.round_id)) ?? null;
          content += `• **${team1.name}** vs **${team2.name}**`;
          if (maxMaps) content += ` — \`BO${maxMaps}\``;
          if (scheduled) content += ` — match prévu pour le \`${scheduled}\``;
          content += `\n`;
        }
        content += `\n`;
      }
    }

    // Challonge seasons
    const challongeApiKey: string = getSetting("challonge.apiKey");
    const frontendUrl: string = getSetting("discord.frontendUrl")?.replace(/\/$/, "") ?? "";
    if (challongeApiKey) {
      const challongeSeasons: RowDataPacket[] = await db.query(
        "SELECT s.id, s.name FROM season s WHERE s.is_challonge = 1 AND (s.challonge_url IS NULL OR s.challonge_url NOT LIKE 't:%')",
        []
      );
      for (const season of challongeSeasons) {
        const brackets: RowDataPacket[] = await db.query(
          "SELECT challonge_slug, label FROM season_challonge_tournament WHERE season_id = ? ORDER BY display_order ASC, id ASC",
          [season.id]
        );
        if (!brackets.length) continue;

        const existingChallongeIds: RowDataPacket[] = await db.query(
          "SELECT challonge_id FROM `match` WHERE season_id = ? AND cancelled = 0 AND challonge_id IS NOT NULL",
          [season.id]
        );
        const usedChallongeIds = new Set<number>(existingChallongeIds.map((r: any) => r.challonge_id));

        const challongeRoundFormatRows: RowDataPacket[] = await db.query(
          "SELECT challonge_slug, group_id, round, max_maps FROM season_challonge_round_format WHERE season_id = ?",
          [season.id]
        );
        const challongeRoundFormats = new Map<string, number>(
          challongeRoundFormatRows.map((r: any) => [`${r.challonge_slug}|${r.group_id}|${r.round}`, r.max_maps])
        );

        let seasonHeader = false;

        for (const bracket of brackets) {
          const slug = bracket.challonge_slug as string;
          const label = (bracket.label as string) || slug;
          const headers = challongeHeaders(challongeApiKey);

          const { rawMatches, participantMap } = await getChallongeBracketData(slug, headers);
          if (!rawMatches.length) continue;

          const allBracketMatches = rawMatches
            .map(m => parseV2Match(m))
            .filter(m => m.player1_id && m.player2_id && m.state !== "complete")
            .sort((a, b) => (a.round - b.round) || ((a.suggested_play_order ?? 999) - (b.suggested_play_order ?? 999)));

          const seenParticipants = new Set<number>();
          for (const m of allBracketMatches) {
            if (usedChallongeIds.has(m.id)) {
              seenParticipants.add(m.player1_id!);
              seenParticipants.add(m.player2_id!);
            }
          }

          const bracketMatches = allBracketMatches.filter(m => !usedChallongeIds.has(m.id));
          const toShow = bracketMatches.filter(m => {
            if (seenParticipants.has(m.player1_id!) || seenParticipants.has(m.player2_id!)) return false;
            seenParticipants.add(m.player1_id!);
            seenParticipants.add(m.player2_id!);
            return true;
          });

          if (!toShow.length) continue;

          const bracketTabIndex = brackets.indexOf(bracket);

          if (!seasonHeader) {
            content += `**${season.name}**\n`;
            seasonHeader = true;
          }
          content += `__${label}__\n`;
          for (const m of toShow) {
            const team1Name = participantMap.get(m.player1_id!) ?? `#${m.player1_id}`;
            const team2Name = participantMap.get(m.player2_id!) ?? `#${m.player2_id}`;
            const maxMaps = challongeRoundFormats.get(`${slug}|${m.group_id ?? "none"}|${m.round}`) ?? 1;
            content += `• **${team1Name}** vs **${team2Name}** — Ronde ${m.round} — \`BO${maxMaps}\``;
            if (m.scheduled_time) {
              const scheduled = new Date(m.scheduled_time).toLocaleString("fr-FR", {
                timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit",
                day: "2-digit", month: "2-digit"
              });
              content += ` — \`${scheduled}\``;
            }
            if (frontendUrl) {
              const params = new URLSearchParams({ match: String(m.id) });
              if (bracketTabIndex > 0) params.set("tab", String(bracketTabIndex));
              content += ` [creer](${frontendUrl}/season/${season.id}/challonge?${params.toString()})`;
            }
            content += `\n`;
          }
          content += `\n`;
        }
      }
    }

    if (!content.trim()) content = "🟡 Aucun match disponible actuellement.";

    for (const channelId of channelIds) {
      try {
        const ch = await client.channels.fetch(channelId) as TextChannel;
        const existing = getMsgId("schedule", channelId);
        let newId: string;
        if (existing === "0") {
          const msg = await ch.send(content);
          newId = msg.id;
        } else {
          try {
            const msg = await ch.messages.fetch(existing);
            await msg.edit(content);
            newId = existing;
          } catch (fetchErr: any) {
            if (fetchErr?.code === 10008) {
              // Message deleted — send a new one
              const msg = await ch.send(content);
              newId = msg.id;
            } else {
              // Transient error (network, DNS...) — keep existing ID, skip update
              newId = existing;
            }
          }
        }
        if (newId !== existing) await saveMsgId("schedule", channelId, newId);
      } catch (err) {
        console.error(`Discord updateSchedule [${channelId}]:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("Discord updateSchedule error:", (err as Error).message);
  }
}

// ─── Événements de match (default channel) ───────────────────────────────────

export async function sendPauseEvent(data: {
  matchid: string;
  matchUrl: string;
  isPaused: boolean;
  teamName: string;
  side: string;
  pauseType: string;
}): Promise<void> {
  if (!isDiscordEnabled()) return;
  const embed = new EmbedBuilder()
    .setColor(data.isPaused ? 0xe74c3c : 0x2ecc71)
    .setTitle(data.isPaused ? "🔴 PAUSE" : "🟢 REPRISE")
    .setURL(data.matchUrl)
    .addFields(
      { name: "Match", value: `[#${data.matchid}](${data.matchUrl})`, inline: true },
      { name: "Équipe", value: data.teamName, inline: true },
      { name: "Côté", value: data.side, inline: true },
      { name: "Type", value: data.pauseType, inline: true }
    )
    .setTimestamp();
  await sendEmbedToTargets(getChannels("discord.channels.default"), embed);
}

export async function sendMapResultEvent(data: {
  matchid: string;
  matchUrl: string;
  mapName: string;
  mapNumber: number;
  team1Name: string;
  team2Name: string;
  team1Score: number;
  team2Score: number;
  team1SeriesScore: number;
  team2SeriesScore: number;
  winnerName: string | null;
}): Promise<void> {
  if (!isDiscordEnabled()) return;
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`🗺️ Fin de map — ${data.mapName} (Map ${data.mapNumber + 1})`)
    .setURL(data.matchUrl)
    .addFields(
      {
        name: "Score de la map",
        value: `**${data.team1Name}** ${data.team1Score} — ${data.team2Score} **${data.team2Name}**`,
        inline: false
      },
      { name: "Série", value: `${data.team1SeriesScore} — ${data.team2SeriesScore}`, inline: true },
      { name: "Vainqueur", value: data.winnerName ?? "Match nul", inline: true }
    )
    .setTimestamp();
  await sendEmbedToTargets(getChannels("discord.channels.default"), embed);
}

export async function sendSeriesResultEvent(data: {
  matchid: string;
  matchUrl: string;
  team1Name: string;
  team2Name: string;
  team1SeriesScore: number;
  team2SeriesScore: number;
  winnerName: string | null;
}): Promise<void> {
  if (!isDiscordEnabled()) return;
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("🏆 Match terminé !")
    .setURL(data.matchUrl)
    .addFields(
      {
        name: "Équipes",
        value: `**${data.team1Name}** vs **${data.team2Name}**`,
        inline: false
      },
      { name: "Score final", value: `**${data.team1SeriesScore} — ${data.team2SeriesScore}**`, inline: true },
      { name: "Vainqueur", value: data.winnerName ?? "Match nul", inline: true }
    )
    .setTimestamp();
  await sendEmbedToTargets(getChannels("discord.channels.default"), embed);
}

// ─── Veto Finish ──────────────────────────────────────────────────────────────

export async function sendVetoCompleteEmbed(matchId: number): Promise<void> {
  if (!isDiscordEnabled()) return;
  try {
    const hostname: string = config.get("server.hostname");
    const matchUrl = `${hostname.replace(/\/$/, "")}/match/${matchId}`;

    const vetos: RowDataPacket[] = await db.query(
      `SELECT v.team_name, v.map, v.pick_or_veto,
              vs.side, vs.team_name AS side_team
       FROM veto v
       LEFT JOIN veto_side vs ON vs.veto_id = v.id
       WHERE v.match_id = ?
       ORDER BY v.id`,
      [matchId]
    );

    if (!vetos.length) return;

    let desc = "";
    for (const v of vetos) {
      const icon = v.pick_or_veto === "pick" ? "✅" : (v.pick_or_veto === "veto" ? "❌" : "🎯");
      const action = v.pick_or_veto === "pick" ? "Pick" : (v.pick_or_veto === "veto" ? "Ban" : "Decider");
      let line = `${icon} **${v.team_name}** — ${action} — \`${v.map}\``;
      if (v.pick_or_veto === "pick" && v.side && v.side_team) {
        line += ` | ${v.side_team} joue **${v.side.toUpperCase()}**`;
      }
      desc += line + "\n";
    }

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🎯 Veto Finish")
      .setURL(matchUrl)
      .setDescription(desc)
      .setTimestamp();

    await sendEmbedToTargets(getChannelsOrDefault("discord.channels.veto"), embed);
  } catch (err) {
    console.error("Discord sendVetoCompleteEmbed error:", (err as Error).message);
  }
}

// ─── Demo Available ───────────────────────────────────────────────────────────

export async function sendDemoReadyEmbed(data: {
  matchId: string;
  mapNumber: number;
  mapName: string | null;
  demoFile: string;
  matchUrl: string;
  downloadUrl: string;
}): Promise<void> {
  if (!isDiscordEnabled()) return;
  try {
    const mapLabel = data.mapName ?? `Map ${data.mapNumber + 1}`;
    const embed = new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`📹 Demo Available — ${mapLabel}`)
      .setURL(data.matchUrl)
      .setDescription(`[⬇️ Download demo](${data.downloadUrl})`)
      .addFields(
        { name: "Match", value: `[#${data.matchId}](${data.matchUrl})`, inline: true },
        { name: "Map", value: mapLabel, inline: true },
        { name: "File", value: `\`${data.demoFile}\``, inline: false }
      )
      .setTimestamp();
    await sendEmbedToTargets(getChannelsOrDefault("discord.channels.demo"), embed);
  } catch (err) {
    console.error("Discord sendDemoReadyEmbed error:", (err as Error).message);
  }
}

// ─── Streamer (GOTV) ──────────────────────────────────────────────────────────

function computeGotvPort(serverIp: string, serverPort: number): number {
  const lastOctet = parseInt(serverIp.split(".").pop() || "0", 10);
  const lastDigit = lastOctet % 10;
  const hundredsDigit = Math.max(0, lastDigit - 1);
  const portRemainder = serverPort % 100;
  return 27000 + hundredsDigit * 100 + portRemainder;
}

export async function sendGotvMatchEmbed(data: {
  matchId: number;
  team1Name: string;
  team2Name: string;
  serverIp: string;
  serverPort: number;
  matchUrl: string;
}): Promise<void> {
  if (!isDiscordEnabled()) return;
  const channelIds = getChannelsOrDefault("discord.channels.streamer");
  if (!channelIds.length) return;
  try {
    const gotvPort = computeGotvPort(data.serverIp, data.serverPort);
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle("📡 Match créé — GOTV disponible")
      .setURL(data.matchUrl)
      .addFields(
        { name: "Match", value: `[#${data.matchId}](${data.matchUrl})`, inline: false },
        { name: "Équipes", value: `**${data.team1Name}** vs **${data.team2Name}**`, inline: false },
        { name: "URL", value: `https://broadcast.white-gaming.fr`, inline: false }
      )
      .setTimestamp();
    await sendEmbedToTargets(channelIds, embed);
  } catch (err) {
    console.error("Discord sendGotvMatchEmbed error:", (err as Error).message);
  }
}

// ─── Stalled Match Reminders ────────────────────────────────────────────────
// Pings admins in discord.channels.default when a match looks stuck. Both
// "not started" rules key off the same signal — no map_stats row for the
// match yet — since pending_veto only reflects the opt-in pre-match/lobby
// veto flow (veto_before_match=true at creation) and stays 0 for the
// standard in-game veto used by most matches:
//  - no map started 5 minutes after match creation → force veto
//  - still no map started 10 minutes after creation → force start
//  - in a BO3, the next map not started 10 minutes after the previous one
//    ended → force start
// Each occurrence is tracked via the settings key/value store so it only
// fires once (mirrors discord.msgid.* persistence used for scoreboard/schedule).

const STALLED_MATCH_ADMIN_IDS = ["286256551994458113", "1171449591833579557"];

function buildMatchUrl(matchId: number): string {
  const hostname: string = config.get("server.hostname");
  return `${hostname.replace(/\/$/, "")}/match/${matchId}`;
}

function alreadyNotified(key: string): boolean {
  return getSetting(key) === "1";
}

async function notifyStalledMatch(matchId: number, title: string, description: string): Promise<void> {
  const channelIds = getChannels("discord.channels.default");
  if (!channelIds.length) return;
  const matchUrl = buildMatchUrl(matchId);
  const content = STALLED_MATCH_ADMIN_IDS.map((id) => `<@${id}>`).join(" ");
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(title)
    .setURL(matchUrl)
    .setDescription(description)
    .addFields({ name: "Match", value: `[#${matchId}](${matchUrl})`, inline: true })
    .setTimestamp();
  await sendEmbedToTargets(channelIds, embed, content);
}

async function checkStalledMatches(): Promise<void> {
  if (!isDiscordEnabled() || !client?.isReady()) return;
  try {
    const pendingVetoMatches: RowDataPacket[] = await db.query(
      "SELECT m.id FROM `match` m WHERE m.cancelled = 0 AND m.forfeit = 0 AND m.end_time IS NULL " +
        "AND m.start_time IS NOT NULL AND m.start_time <= NOW() - INTERVAL 5 MINUTE " +
        "AND NOT EXISTS (SELECT 1 FROM map_stats ms WHERE ms.match_id = m.id)",
      []
    );
    for (const m of pendingVetoMatches) {
      const key = `discord.notified.forceveto.${m.id}`;
      if (alreadyNotified(key)) continue;
      await notifyStalledMatch(
        m.id,
        "⏳ Véto non démarré",
        "Le véto n'a pas démarré 5 minutes après la création du match — pensez à **forcer le véto**."
      );
      await setSetting(key, "1");
    }

    const notStartedMatches: RowDataPacket[] = await db.query(
      "SELECT m.id FROM `match` m WHERE m.cancelled = 0 AND m.forfeit = 0 AND m.end_time IS NULL " +
        "AND m.start_time IS NOT NULL AND m.start_time <= NOW() - INTERVAL 10 MINUTE " +
        "AND NOT EXISTS (SELECT 1 FROM map_stats ms WHERE ms.match_id = m.id)",
      []
    );
    for (const m of notStartedMatches) {
      const key = `discord.notified.forcestart.${m.id}`;
      if (alreadyNotified(key)) continue;
      await notifyStalledMatch(
        m.id,
        "⏳ Match non démarré",
        "Le match n'a pas démarré 10 minutes après sa création — pensez à **forcer le lancement**."
      );
      await setSetting(key, "1");
    }

    const staleBo3Maps: RowDataPacket[] = await db.query(
      "SELECT ms.id AS map_stats_id, ms.match_id FROM map_stats ms " +
        "INNER JOIN (SELECT match_id, MAX(id) AS max_id FROM map_stats GROUP BY match_id) latest " +
        "  ON latest.match_id = ms.match_id AND latest.max_id = ms.id " +
        "INNER JOIN `match` m ON m.id = ms.match_id " +
        "WHERE m.max_maps = 3 AND m.cancelled = 0 AND m.forfeit = 0 AND m.end_time IS NULL " +
        "AND ms.end_time IS NOT NULL AND ms.end_time <= NOW() - INTERVAL 10 MINUTE",
      []
    );
    for (const row of staleBo3Maps) {
      const key = `discord.notified.forcestart.map.${row.map_stats_id}`;
      if (alreadyNotified(key)) continue;
      await notifyStalledMatch(
        row.match_id,
        "⏳ Map suivante non démarrée",
        "La map suivante n'a pas démarré 10 minutes après la fin de la précédente — pensez à **forcer le lancement**."
      );
      await setSetting(key, "1");
    }
  } catch (err) {
    console.error("Discord checkStalledMatches error:", (err as Error).message);
  }
}
