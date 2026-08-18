/**
 * @swagger
 * resourcePath: /obs-slots
 * description: Express API for OBS browser-source slots — stable overlay links that can be reassigned to any match.
 */
import { Router, Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { RowDataPacket } from "mysql2";
import { db } from "../services/db.js";
import Utils from "../utility/utils.js";

const router = Router();

function requireCastOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (!Utils.castCheck(req.user) && !Utils.adminCheck(req.user))) {
    res.status(403).json({ message: "Accès réservé aux utilisateurs avec le rôle cast." });
    return;
  }
  next();
}

router.use(Utils.ensureAuthenticated, requireCastOrAdmin);

const SLOT_SELECT =
  "SELECT s.id, s.label, s.slug, s.match_id, " +
  "m.team1_string, m.team2_string, m.cancelled, m.end_time, m.max_maps " +
  "FROM obs_slot s LEFT JOIN `match` m ON m.id = s.match_id ";

async function generateUniqueSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = randomBytes(4).toString("hex");
    const existing: RowDataPacket[] = await db.query("SELECT id FROM obs_slot WHERE slug = ?", [slug]);
    if (!existing.length) return slug;
  }
  throw new Error("Impossible de générer un identifiant de slot unique.");
}

/** GET /obs-slots — liste tous les slots OBS */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "ORDER BY s.id ASC");
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** POST /obs-slots — crée un nouveau slot */
router.post("/", async (req: Request, res: Response) => {
  try {
    const label = req.body?.label ? String(req.body.label).slice(0, 100) : null;
    const slug = await generateUniqueSlug();
    const insert: RowDataPacket[] = await db.query(
      "INSERT INTO obs_slot (user_id, label, slug) VALUES (?, ?, ?)",
      [req.user!.id, label, slug]
    );
    // @ts-ignore
    const insertId = insert.insertId;
    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "WHERE s.id = ?", [insertId]);
    res.json({ slot: slots[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** PUT /obs-slots/:id — renomme le slot et/ou lui assigne un match */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "ID invalide." }); return; }
    const existing: RowDataPacket[] = await db.query("SELECT id FROM obs_slot WHERE id = ?", [id]);
    if (!existing.length) { res.status(404).json({ message: "Slot introuvable." }); return; }

    const body = req.body ?? {};
    const updates: string[] = [];
    const params: (string | number | null)[] = [];

    if (Object.prototype.hasOwnProperty.call(body, "label")) {
      updates.push("label = ?");
      params.push(body.label ? String(body.label).slice(0, 100) : null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "match_id")) {
      const matchId = body.match_id === null || body.match_id === "" ? null : parseInt(body.match_id);
      if (matchId !== null) {
        if (isNaN(matchId)) { res.status(400).json({ message: "match_id invalide." }); return; }
        const matchRows: RowDataPacket[] = await db.query("SELECT id FROM `match` WHERE id = ?", [matchId]);
        if (!matchRows.length) { res.status(404).json({ message: "Match introuvable." }); return; }
      }
      updates.push("match_id = ?");
      params.push(matchId);
    }

    if (updates.length) {
      params.push(id);
      await db.query(`UPDATE obs_slot SET ${updates.join(", ")} WHERE id = ?`, params);
    }

    const slots: RowDataPacket[] = await db.query(SLOT_SELECT + "WHERE s.id = ?", [id]);
    res.json({ slot: slots[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** DELETE /obs-slots/:id — supprime un slot */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ message: "ID invalide." }); return; }
    await db.query("DELETE FROM obs_slot WHERE id = ?", [id]);
    res.json({ message: "Slot supprimé." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

export default router;
