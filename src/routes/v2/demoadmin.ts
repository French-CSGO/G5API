import multer from "multer";
import path from "path";
import { writeFile, unlink, existsSync, mkdirSync } from "fs";
import { db } from "../../services/db.js";
import { Request, Response, Router } from "express";
import Utils from "../../utility/utils.js";
import { RowDataPacket } from "mysql2";
import GlobalEmitter from "../../utility/emitter.js";
import { sendDemoReadyEmbed } from "../../services/discord.js";
import { getSetting } from "../../services/settings.js";
import config from "config";

const router: Router = Router();

const TEMP_DIR = "public/demos/_tmp";
mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
      cb(null, safe);
    }
  }),
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith(".zip")) cb(null, true);
    else cb(new Error("Only .zip files are allowed (client-side compression required)"));
  },
  limits: { fileSize: 600 * 1024 * 1024 }
});

// Parse match_id and map_name from get5 filename
// e.g. 2026-04-25_20-32-28_822_de_overpass_Lambda_vs_23H.zip
function parseDemoFilename(filename: string): { matchId: string | null; mapName: string | null } {
  const m = filename.match(/_(\d+)_((?:de|cs|ar)_[a-z0-9]+)(?:_|\.)/i);
  if (!m) return { matchId: null, mapName: null };
  return { matchId: m[1], mapName: m[2].toLowerCase() };
}

function deleteTempFile(filePath: string) {
  unlink(filePath, () => {});
}

// Buffer → Uint8Array<ArrayBuffer> (strict TS compliance)
function toView(buf: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer) as Uint8Array<ArrayBuffer>;
}

router.post(
  "/",
  Utils.ensureAuthenticated,
  upload.array("demos"),
  async (req: Request, res: Response) => {
    if (!req.user || !Utils.superAdminCheck(req.user)) {
      if (req.files) {
        for (const f of req.files as Express.Multer.File[]) deleteTempFile(f.path);
      }
      return res.status(403).json({ message: "Forbidden: super admin only." });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No .zip files provided." });
    }

    const { readFile } = await import("fs/promises");
    const results: Array<{ file: string; status: "ok" | "skipped" | "error"; message: string }> = [];

    for (const file of files) {
      const zipFilename = file.filename;
      const destPath = `public/demos/${zipFilename}`;

      try {
        // Already exists → skip
        if (existsSync(destPath)) {
          deleteTempFile(file.path);
          results.push({ file: zipFilename, status: "skipped", message: "Zip already exists, skipped." });
          continue;
        }

        // Parse match and map from filename
        const { matchId, mapName } = parseDemoFilename(zipFilename);
        if (!matchId || !mapName) {
          deleteTempFile(file.path);
          results.push({ file: zipFilename, status: "error", message: "Cannot parse match ID or map name from filename." });
          continue;
        }

        // Find map_stats by match_id + map_name
        const mapStats: RowDataPacket[] = await db.query(
          "SELECT ms.id, ms.map_number FROM map_stats ms WHERE ms.match_id = ? AND ms.map_name = ? LIMIT 1",
          [matchId, mapName]
        );
        if (!mapStats.length) {
          deleteTempFile(file.path);
          results.push({ file: zipFilename, status: "error", message: `No map_stats found for match ${matchId} / ${mapName}.` });
          continue;
        }

        // Move zip to final destination
        const content = await readFile(file.path);
        await new Promise<void>((resolve, reject) => {
          writeFile(destPath, toView(content), (err) => err ? reject(err) : resolve());
        });

        // Update map_stats
        await db.query("UPDATE map_stats SET demoFile = ? WHERE id = ?", [zipFilename, mapStats[0].id]);
        GlobalEmitter.emit("demoUpdate");

        // Discord notification
        const hostname: string = config.get("server.hostname");
        const matchUrl = `${hostname.replace(/\/$/, "")}/match/${matchId}`;
        sendDemoReadyEmbed({
          matchId,
          mapNumber: mapStats[0].map_number ?? 0,
          mapName,
          demoFile: zipFilename,
          matchUrl,
          downloadUrl: `${hostname.replace(/\/$/, "")}/api/demo/${zipFilename}`,
        }).catch(() => {});

        // VPS relay
        if (getSetting("vpsRelay.enabled") === "true") {
          const relayUrl = getSetting("vpsRelay.url")?.replace(/\/$/, "");
          const relayApiKey = getSetting("vpsRelay.apiKey");
          if (relayUrl && relayApiKey) {
            fetch(`${relayUrl}/api/demos`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${relayApiKey}`,
                "Get5-MatchId": matchId,
                "Get5-MapNumber": String(mapStats[0].map_number ?? 0),
                "Get5-FileName": zipFilename,
                "Content-Type": "application/octet-stream",
              },
              body: new Blob([toView(content)]),
            }).catch(() => {});
          }
        }

        results.push({ file: zipFilename, status: "ok", message: `Saved → ${zipFilename}` });
      } catch (err: any) {
        results.push({ file: zipFilename, status: "error", message: err.message ?? "Unknown error" });
      } finally {
        deleteTempFile(file.path);
      }
    }

    res.json({ results });
  }
);

export { router };
