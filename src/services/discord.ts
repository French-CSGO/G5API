import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import config from "config";
import { db } from "./db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { RowDataPacket } from "mysql2/typings/mysql";
import GlobalEmitter from "../utility/emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGE_ID_FILE = path.join(__dirname, "../../data/discord_scoreboard_id.json");

let client: Client | null = null;
let announceChannelId = "";
let scoreboardChannelId = "";
let scoreboardMessageId = "0";

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

export async function initDiscord(): Promise<void> {
  try {
    const token: string = config.get("discord.token");
    if (!token) return;
    announceChannelId = config.get("discord.announceChannelId");
    scoreboardChannelId = config.get("discord.scoreboardChannelId");
    loadMessageId();

    client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.once("ready", () => {
      console.log(`Discord bot connected as ${client!.user!.tag}`);
      updateScoreboard();
    });
    await client.login(token);

    GlobalEmitter.on("matchUpdate", updateScoreboard);
    GlobalEmitter.on("mapStatUpdate", updateScoreboard);
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
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
      "SELECT m.id, m.team1_string, m.team2_string, m.team1_series_score, m.team2_series_score, " +
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
          ` | Série: **${match.team1_series_score}-${match.team2_series_score}**` +
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
