import { Client, GatewayIntentBits, TextChannel, REST, Routes, SlashCommandBuilder } from "discord.js";
import config from "config";
import { db } from "./db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RowDataPacket } from "mysql2/typings/mysql";
import GlobalEmitter from "../utility/emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGE_ID_FILE = path.join(__dirname, "../../../public/discord_scoreboard_id.json");
const SCHEDULE_MESSAGE_ID_FILE = path.join(__dirname, "../../../public/discord_schedule_id.json");

let client: Client | null = null;
let announceChannelId = "";
let scoreboardChannelId = "";
let scoreboardMessageId = "0";
let scheduleChannelId = "";
let scheduleMessageId = "0";

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
    const clientId: string = config.get("toornament.clientId") || "";
    const clientSecret: string = config.get("toornament.clientSecret") || "";
    const apiKey: string = config.get("toornament.apiKey") || "";
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
    const token: string = config.get("discord.token");
    if (!token) return;
    announceChannelId = config.get("discord.announceChannelId");
    scoreboardChannelId = config.get("discord.scoreboardChannelId");
    scheduleChannelId = config.get("discord.scheduleChannelId");
    loadMessageId();
    loadScheduleMessageId();

    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.once("clientReady", async (c) => {
      console.log(`Discord bot connected as ${c.user.tag}`);

      const commands = [
        new SlashCommandBuilder()
          .setName("refresh-schedule")
          .setDescription("Rafraîchit le message des matchs disponibles")
          .toJSON()
      ];
      const rest = new REST().setToken(token);
      const guildId: string = config.get("discord.guildId");
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(c.user.id, guildId), { body: commands });
      } else {
        await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
      }

      updateScoreboard();
      updateSchedule();
      setInterval(updateSchedule, 5 * 60 * 1000);
    });

    client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === "refresh-schedule") {
        await interaction.deferReply({ ephemeral: true });
        await updateSchedule();
        await interaction.editReply("✅ Schedule rafraîchi.");
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
    const apiKey: string = config.get("toornament.apiKey") || "";

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
          if (scheduled) content += ` | 📅 \`${scheduled}\``;
          content += `\n`;
        }
        content += `\n`;
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
