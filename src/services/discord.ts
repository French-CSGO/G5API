import { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { db } from "./db.js";
import { getSetting, getSettingBool } from "./settings.js";
import config from "config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RowDataPacket } from "mysql2/typings/mysql";
import GlobalEmitter from "../utility/emitter.js";
import { CHALLONGE_V2_BASE, challongeHeaders, parseV2Match, parseV2Participant } from "../utility/challongeV2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGE_ID_FILE = path.join(__dirname, "../../../public/discord_scoreboard_id.json");
const SCHEDULE_MESSAGE_ID_FILE = path.join(__dirname, "../../../public/discord_schedule_id.json");

let client: Client | null = null;
let announceChannelId = "";
let scoreboardChannelId = "";
let scoreboardMessageId = "0";
let scheduleChannelId = "";
let scheduleMessageId = "0";
let serverEventChannelId = "";

function loadMessageId() {
  try {
    if (fs.existsSync(MESSAGE_ID_FILE)) {
      const json = JSON.parse(fs.readFileSync(MESSAGE_ID_FILE, "utf-8"));
      scoreboardMessageId = json.messageId || "0";
    }
  } catch {}
}

function saveMessageId(id: string) {
  scoreboardMessageId = id;
  try {
    fs.mkdirSync(path.dirname(MESSAGE_ID_FILE), { recursive: true });
    fs.writeFileSync(MESSAGE_ID_FILE, JSON.stringify({ messageId: id }));
  } catch {}
}

function loadScheduleMessageId() {
  try {
    if (fs.existsSync(SCHEDULE_MESSAGE_ID_FILE)) {
      const json = JSON.parse(fs.readFileSync(SCHEDULE_MESSAGE_ID_FILE, "utf-8"));
      scheduleMessageId = json.messageId || "0";
    }
  } catch {}
}

function saveScheduleMessageId(id: string) {
  scheduleMessageId = id;
  try {
    fs.mkdirSync(path.dirname(SCHEDULE_MESSAGE_ID_FILE), { recursive: true });
    fs.writeFileSync(SCHEDULE_MESSAGE_ID_FILE, JSON.stringify({ messageId: id }));
  } catch {}
}

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

export async function initDiscord(): Promise<void> {
  try {
    const token: string = getSetting("discord.token");
    if (!token) return;
    announceChannelId = getSetting("discord.announceChannelId");
    scoreboardChannelId = getSetting("discord.scoreboardChannelId");
    scheduleChannelId = getSetting("discord.scheduleChannelId");
    serverEventChannelId = getSetting("discord.serverEventChannelId");
    loadMessageId();
    loadScheduleMessageId();

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
    });

    client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "refresh-schedule") {
        await interaction.deferReply({ ephemeral: true });
        await updateSchedule();
        await interaction.editReply("✅ Schedule rafraîchi.");
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

export async function announceNewMatch(matchId: number): Promise<void> {
  if (!client?.isReady() || !announceChannelId) return;
  try {
    const sql =
      "SELECT m.team1_string, m.team2_string, gs.ip_string, gs.port " +
      "FROM `match` m LEFT JOIN game_server gs ON m.server_id = gs.id WHERE m.id = ?";
    const rows: RowDataPacket[] = await db.query(sql, [matchId]);
    if (!rows.length) return;

    const match = rows[0];
    const serverIP = match.ip_string ? `${match.ip_string}:${match.port}` : "N/A";
    const time = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

    const channel = await client.channels.fetch(announceChannelId) as TextChannel;
    const guild = channel.guild;

    const getRoleMention = (name: string) => {
      const role = guild.roles.cache.find(r => r.name === name);
      return role ? `<@&${role.id}>` : `**${name}**`;
    };

    const t1 = getRoleMention(match.team1_string);
    const t2 = getRoleMention(match.team2_string);

    await channel.send(
      `🎮 **Match lancé :** ${t1} vs ${t2}\n🕒 Heure de début : \`${time}\`\n🖥️ IP : \`connect ${serverIP}\``
    );
  } catch (err) {
    console.error("Discord announceNewMatch error:", (err as Error).message);
  }
}

export async function updateScoreboard(): Promise<void> {
  if (!client?.isReady() || !scoreboardChannelId) return;
  try {
    const matchSql =
      "SELECT m.id, m.team1_string, m.team2_string, m.team1_score, m.team2_score, " +
      "gs.ip_string, gs.port " +
      "FROM `match` m LEFT JOIN game_server gs ON m.server_id = gs.id " +
      "WHERE m.end_time IS NULL AND m.cancelled = 0 ORDER BY m.id ASC";
    const matches: RowDataPacket[] = await db.query(matchSql, []);

    let content = "";
    if (matches.length === 0) {
      content = "🟡 Aucun match en cours actuellement.";
    } else {
      for (const match of matches) {
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

    const channel = await client.channels.fetch(scoreboardChannelId) as TextChannel;
    if (scoreboardMessageId === "0") {
      const msg = await channel.send(content);
      saveMessageId(msg.id);
    } else {
      try {
        const msg = await channel.messages.fetch(scoreboardMessageId);
        await msg.edit(content);
      } catch {
        const msg = await channel.send(content);
        saveMessageId(msg.id);
      }
    }
  } catch (err) {
    console.error("Discord updateScoreboard error:", (err as Error).message);
  }
}

export async function updateSchedule(): Promise<void> {
  if (!client?.isReady() || !scheduleChannelId) return;
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

        // Resolve local team names
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

        // Per group, only keep matches from the first pending round (sorted by structure)
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

        content += `**${season.name}**\n`;
        for (const { match, team1, team2 } of toShow) {
          const scheduled = match.scheduled_datetime
            ? new Date(match.scheduled_datetime).toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
            : null;
          content += `• **${team1.name}** vs **${team2.name}**`;
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

        // Fetch Challonge match IDs already started/finished in G5API for this season
        const existingChallongeIds: RowDataPacket[] = await db.query(
          "SELECT challonge_id FROM `match` WHERE season_id = ? AND cancelled = 0 AND challonge_id IS NOT NULL",
          [season.id]
        );
        const usedChallongeIds = new Set<number>(existingChallongeIds.map((r: any) => r.challonge_id));

        let seasonHeader = false;

        for (const bracket of brackets) {
          const slug = bracket.challonge_slug as string;
          const label = (bracket.label as string) || slug;
          const headers = challongeHeaders(challongeApiKey);

          // Fetch open matches
          const mRes = await fetch(
            `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`,
            { headers }
          ).catch(() => null);
          if (!mRes?.ok) continue;
          const mData: any = await mRes.json().catch(() => null);
          if (!mData) continue;
          const rawMatches: any[] = Array.isArray(mData.data) ? mData.data : (mData.data ? [mData.data] : []);

          // Fetch participants
          const participantMap = new Map<number, string>();
          const pRes = await fetch(
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

          // Parse, filter already-created, sort by round
          const bracketMatches = rawMatches
            .map(m => parseV2Match(m))
            .filter(m => m.player1_id && m.player2_id && !usedChallongeIds.has(m.id))
            .sort((a, b) => (a.round - b.round) || ((a.suggested_play_order ?? 999) - (b.suggested_play_order ?? 999)));

          // One match per team within this bracket
          const seenParticipants = new Set<number>();
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
            content += `• **${team1Name}** vs **${team2Name}** — Ronde ${m.round}`;
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
              content += ` [➕](${frontendUrl}/season/${season.id}/challonge?${params.toString()})`;
            }
            content += `\n`;
          }
          content += `\n`;
        }
      }
    }

    // Fallback: matches from DB with scheduled_datetime (no Toornament needed)
    if (!content.trim()) {
      const dbMatches: RowDataPacket[] = await db.query(
        `SELECT m.id, m.scheduled_datetime,
                t1.name AS team1_name, t2.name AS team2_name,
                s.name AS season_name
         FROM \`match\` m
         LEFT JOIN team t1 ON t1.id = m.team1_id
         LEFT JOIN team t2 ON t2.id = m.team2_id
         LEFT JOIN season s ON s.id = m.season_id
         WHERE m.cancelled = 0 AND m.end_time IS NULL
           AND m.start_time IS NULL
           AND m.scheduled_datetime IS NOT NULL
           AND m.scheduled_datetime >= NOW() - INTERVAL 1 DAY
         ORDER BY m.scheduled_datetime ASC`,
        []
      );
      if (dbMatches.length > 0) {
        const bySeason = new Map<string, typeof dbMatches>();
        for (const m of dbMatches) {
          const key = m.season_name || "Sans saison";
          if (!bySeason.has(key)) bySeason.set(key, []);
          bySeason.get(key)!.push(m);
        }
        for (const [seasonName, matches] of bySeason) {
          content += `**${seasonName}**\n`;
          for (const m of matches) {
            const scheduled = new Date(m.scheduled_datetime).toLocaleString("fr-FR", {
              timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit",
              day: "2-digit", month: "2-digit"
            });
            content += `• **${m.team1_name}** vs **${m.team2_name}** — \`${scheduled}\`\n`;
          }
          content += "\n";
        }
      }
    }

    if (!content.trim()) content = "🟡 Aucun match disponible actuellement.";

    const channel = await client.channels.fetch(scheduleChannelId) as TextChannel;
    if (scheduleMessageId === "0") {
      const msg = await channel.send(content);
      saveScheduleMessageId(msg.id);
    } else {
      try {
        const msg = await channel.messages.fetch(scheduleMessageId);
        await msg.edit(content);
      } catch {
        const msg = await channel.send(content);
        saveScheduleMessageId(msg.id);
      }
    }
  } catch (err) {
    console.error("Discord updateSchedule error:", (err as Error).message);
  }
}

async function sendToServerEventChannel(embed: EmbedBuilder): Promise<void> {
  if (!client?.isReady() || !serverEventChannelId) return;
  try {
    const channel = await client.channels.fetch(serverEventChannelId) as TextChannel;
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("Discord sendServerEvent error:", (err as Error).message);
  }
}

/**
 * Envoie un embed via le webhook configuré (discord.eventWebhookUrl) si disponible,
 * sinon fallback sur le channel bot serverEventChannelId.
 */
async function sendEmbedToEventTarget(embed: EmbedBuilder): Promise<void> {
  const webhookUrl = getSetting("discord.eventWebhookUrl");
  if (webhookUrl) {
    const payload = { embeds: [embed.toJSON()] };
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } else {
    await sendToServerEventChannel(embed);
  }
}

export async function sendPauseEvent(data: {
  matchid: string;
  matchUrl: string;
  isPaused: boolean;
  teamName: string;
  side: string;
  pauseType: string;
}): Promise<void> {
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
  await sendToServerEventChannel(embed);
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
  await sendToServerEventChannel(embed);
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
  await sendToServerEventChannel(embed);
}

export async function sendVetoCompleteEmbed(matchId: number): Promise<void> {
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

    await sendEmbedToEventTarget(embed);
  } catch (err) {
    console.error("Discord sendVetoCompleteEmbed error:", (err as Error).message);
  }
}

export async function sendDemoReadyEmbed(data: {
  matchId: string;
  mapNumber: number;
  mapName: string | null;
  demoFile: string;
  matchUrl: string;
  downloadUrl: string;
}): Promise<void> {
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
    await sendEmbedToEventTarget(embed);
  } catch (err) {
    console.error("Discord sendDemoReadyEmbed error:", (err as Error).message);
  }
}

/**
 * Calcule le port GOTV depuis l'IP du serveur de jeu.
 * Règle : remplacer le chiffre des centaines du port par (dernier chiffre du dernier octet de l'IP - 1).
 * Ex : IP .243 (dernier digit=3), port 27015 → 3-1=2 → 27215
 */
function computeGotvPort(serverIp: string, serverPort: number): number {
  const lastOctet = parseInt(serverIp.split(".").pop() || "0", 10);
  const lastDigit = lastOctet % 10;
  const hundredsDigit = Math.max(0, lastDigit - 1);
  const portRemainder = serverPort % 100; // garde les unités/dizaines du port d'origine
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
  if (!getSettingBool("discord.gotvWebhookEnabled")) return;
  const webhookUrl = getSetting("discord.eventWebhookUrl");
  if (!webhookUrl) return;
  try {
    const gotvPort = computeGotvPort(data.serverIp, data.serverPort);
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle("📡 Match créé — GOTV disponible")
      .setURL(data.matchUrl)
      .addFields(
        { name: "Match", value: `[#${data.matchId}](${data.matchUrl})`, inline: false },
        { name: "Équipes", value: `**${data.team1Name}** vs **${data.team2Name}**`, inline: false },
        { name: "GOTV", value: `\`connect 54.37.50.33:${gotvPort}\``, inline: false }
      )
      .setTimestamp();
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed.toJSON()] }),
    });
  } catch (err) {
    console.error("Discord sendGotvMatchEmbed error:", (err as Error).message);
  }
}
