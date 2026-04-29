/** Express API router for demo uploads in get5.
 * @module routes/v2/demo
 * @requires express
 * @requires db
 */

/**
 * @swagger
 * resourcePath: /v2/demo
 * description: Express API for v2 API calls in G5API.
 */

/** ZIP files.
 * @const
 */
import JSZip from "jszip";
import path from "path";

/** Required to save files.
 * @const
 */
import { writeFile } from "fs";

/** Config to check demo uploads.
 * @const
 */
import config from "config";

import { db } from "../../services/db.js";

import { Request, Response, Router } from "express";
import Utils from "../../utility/utils.js";
import { RowDataPacket } from "mysql2";

/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../../utility/emitter.js";
import { sendDemoReadyEmbed } from "../../services/discord.js";
import { getSetting } from "../../services/settings.js";

/** Express module
 * @const
 */
const router: Router = Router();

/**
 * @swagger
 *
 * /v2/demo:
 *   post:
 *     description: Retrieves the demos from the given match and map, zips and stores them on the server.
 *     produces:
 *       - application/json
 *     tags:
 *       - v2
 *     parameters:
 *      - in: header
 *        name: Get5-FileName
 *        description: Name of the file as defined by get5_demo_name_format
 *        schema:
 *          type: string
 *        required: true
 *      - in: header
 *        name: Get5-MapNumber
 *        description: Zero-indexed map number in the series.
 *        schema:
 *          type: string
 *        required: true
 *      - in: header
 *        name: Authorization
 *        description: The API key provided by the server.
 *        schema:
 *          type: string
 *        required: true
 *      - in: header
 *        name: Get5-MatchId
 *        description: The ID of the match.
 *        schema:
 *          type: string
 *        required: true
 *     requestBody:
 *       content:
 *         application/octet-stream:
 *           schema:
 *             format: binary
 *     responses:
 *       200:
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.post("/", async (req: Request, res: Response) => {
  if (!config.get("server.uploadDemos")) {
    res.status(403).send({ message: "Demo uploads disabled for this server." });
    return;
  }
  try {
    const apiKey: string | undefined = req.get("Authorization");
    const matchId: string | undefined = req.get("Get5-MatchId");
    const mapNumber: string | undefined = req.get("Get5-MapNumber");
    const demoFilename: string | undefined = req.get("Get5-FileName");
    // Check that the values have made it across.
    if (!apiKey || !matchId || !mapNumber || !demoFilename) {
      return res
        .status(401)
        .send({ message: "API key, Match ID, or Map Number not provided." });
    }
    if (!/^\d+$/.test(matchId) || !/^\d+$/.test(mapNumber) || !/^[\w\-. ]+$/.test(demoFilename)) {
      return res.status(400).send({ message: "Invalid Match ID, Map Number, or filename." });
    }
    // Check if our API key is correct.
    const matchApiCheck: number = await Utils.checkApiKey(apiKey, matchId);
    if (matchApiCheck == 1) {
      return res.status(401).send({
        message: "Invalid API key has been given."
      });
    }
    // Begin file compression into public/demos and check time variance of 8 minutes.
    let zip: JSZip = new JSZip();
    let sqlString: string =
      "SELECT id, end_time FROM map_stats WHERE match_id = ? AND map_number = ?";
    const mapInfo: RowDataPacket[] = await db.query(sqlString, [
      matchId,
      mapNumber
    ]);
    if (mapInfo.length == 0) {
      return res.status(404).send({ message: "Failed to find map stats object." });
    }
    let updateStmt: object;
    // Only reject demos if end_time is known and more than 30 minutes old.
    // If end_time is null (race condition: demo uploaded before OnMapResult), allow it.
    if (mapInfo[0].end_time != null) {
      const currentDate: Date = new Date();
      const endTimeMs: Date = new Date(mapInfo[0].end_time);
      const timeDifference: number = Math.abs(currentDate.getTime() - endTimeMs.getTime());
      const minuteDifference = Math.floor(timeDifference / 1000 / 60);
      if (minuteDifference > 30) {
        return res.status(401).json({ message: "Demo can no longer be uploaded." });
      }
    }

    zip.file(demoFilename, req.body, { binary: true });
    zip
      .generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
      .then((buf) => {
        const safeDemoName = path.basename(demoFilename).replace(/[^a-zA-Z0-9._\-]/g, "_").replace(".dem", ".zip");
        // @ts-ignore
        writeFile("public/demos/" + safeDemoName, buf, "binary", function (err) {
          if (err) {
            console.error(err);
          }
        });

        // VPS relay — fire-and-forget
        const relayEnabled = getSetting("vpsRelay.enabled");
        console.log(`[VPS Relay] enabled=${relayEnabled}`);
        if (relayEnabled === "true") {
          const relayUrl = getSetting("vpsRelay.url")?.replace(/\/$/, "");
          const relayApiKey = getSetting("vpsRelay.apiKey");
          console.log(`[VPS Relay] url=${relayUrl} apiKey=${relayApiKey ? "set(" + relayApiKey.length + " chars)" : "MISSING"}`);
          console.log(`[VPS Relay] sending match=${matchId} map=${mapNumber} file=${safeDemoName} size=${buf.length} bytes`);
          if (relayUrl && relayApiKey) {
            fetch(`${relayUrl}/api/demos`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${relayApiKey}`,
                "Get5-MatchId": matchId!,
                "Get5-MapNumber": mapNumber!,
                "Get5-FileName": safeDemoName,
                "Content-Type": "application/octet-stream",
              },
              body: buf,
            }).then(async (r) => {
              const body = await r.text().catch(() => "");
              console.log(`[VPS Relay] response status=${r.status} body=${body}`);
            }).catch((err) => console.error("[VPS Relay] fetch error:", err));
          } else {
            console.warn(`[VPS Relay] skipped — url or apiKey missing`);
          }
        }
      });
    // Update map stats object to include the link to the demo.
    updateStmt = {
      demoFile: demoFilename.replace(".dem", ".zip")
    };
    updateStmt = await db.buildUpdateStatement(updateStmt);

    sqlString = "UPDATE map_stats SET ? WHERE id = ?";
    await db.query(sqlString, [updateStmt, mapInfo[0].id]);
    GlobalEmitter.emit("demoUpdate");

    // Discord notification
    const hostname: string = config.get("server.hostname");
    const matchUrl = `${hostname.replace(/\/$/, "")}/match/${matchId}`;
    const mapNameRow: RowDataPacket[] = await db.query(
      "SELECT map_name FROM map_stats WHERE id = ?", [mapInfo[0].id]
    );
    const safeDemoFilename = path.basename(demoFilename).replace(/[^a-zA-Z0-9._\-]/g, "_").replace(".dem", ".zip");
    sendDemoReadyEmbed({
      matchId,
      mapNumber: parseInt(mapNumber),
      mapName: mapNameRow[0]?.map_name ?? null,
      demoFile: safeDemoFilename,
      matchUrl,
      downloadUrl: `https://ebot.white-gaming.fr/api/demo/${safeDemoFilename}`,
    }).catch(() => {});

    res.status(200).send({message: "Success"});
    return;
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: error });
    return;
  }
});

export { router };
