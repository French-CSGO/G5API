/**
 * @swagger
 * resourcePath: /obs-slots
 * description: Gestion des "slots OBS" — des liens fixes (par slug) que l'on peut
 *   réassigner à un match différent depuis le panel, sans jamais changer l'URL
 *   configurée côté OBS Studio. Plusieurs slots indépendants peuvent chacun
 *   pointer vers un match différent, pour supporter plusieurs streams en parallèle.
 */
import { Router, Request, Response, NextFunction } from "express";
import { generate } from "randomstring";
import { RowDataPacket } from "mysql2";

import { db } from "../services/db.js";
import Utils from "../utility/utils.js";
import { ObsSlot } from "../types/ObsSlot.js";

const router = Router();

/** Réservé aux utilisateurs avec le rôle cast ou admin. */
function requireCastOrAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (!Utils.castCheck(req.user) && !Utils.adminCheck(req.user))) {
    res.status(403).json({ message: "Accès réservé aux utilisateurs avec le rôle cast." });
    return;
  }
  next();
}

router.use(Utils.ensureAuthenticated, requireCastOrAdmin);

const SLOT_LIST_SQL = `
  SELECT
    s.id, s.slug, s.label, s.match_id, s.user_id, s.created_at, s.updated_at,
    m.team1_string, m.team2_string, m.end_time, m.cancelled, m.max_maps
  FROM obs_slot s
  LEFT JOIN \`match\` m ON m.id = s.match_id
  ORDER BY s.created_at ASC
`;

/**
 * @swagger
 *
 * /obs-slots/:
 *   get:
 *     description: Liste tous les slots OBS.
 *     tags:
 *       - obs-slots
 *     responses:
 *       200:
 *         description: Liste des slots.
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const slots: RowDataPacket[] = await db.query(SLOT_LIST_SQL);
    res.json({ slots });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /obs-slots/:
 *   post:
 *     description: Crée un nouveau slot OBS (lien fixe, non assigné à un match).
 *     tags:
 *       - obs-slots
 *     responses:
 *       200:
 *         description: Slot créé.
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const label: string | null = req.body?.label ?? null;
    let slug = "";
    // Collision extrêmement improbable (10 caractères alphanumériques), mais on
    // vérifie tout de même avant insertion.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = generate({ length: 10, charset: "alphanumeric", capitalization: "lowercase" });
      const existing: RowDataPacket[] = await db.query("SELECT id FROM obs_slot WHERE slug = ?", [candidate]);
      if (!existing.length) { slug = candidate; break; }
    }
    if (!slug) { res.status(500).json({ message: "Impossible de générer un slug unique." }); return; }

    const insertResult: RowDataPacket[] = await db.query(
      "INSERT INTO obs_slot SET ?",
      [{ slug, label, user_id: req.user?.id ?? null }]
    );
    //@ts-ignore
    const insertId: number = insertResult.insertId;
    const slots: RowDataPacket[] = await db.query(SLOT_LIST_SQL);
    const created = slots.find((s: any) => s.id === insertId);
    res.json({ slot: created ?? { id: insertId, slug, label, match_id: null } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /obs-slots/:id:
 *   put:
 *     description: Met à jour un slot OBS (label et/ou match assigné). Passer
 *       match_id à null retire l'assignation du slot.
 *     tags:
 *       - obs-slots
 *     responses:
 *       200:
 *         description: Slot mis à jour.
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const slotId = parseInt(req.params.id);
    if (isNaN(slotId)) { res.status(400).json({ message: "Invalid slot id." }); return; }

    const existing: RowDataPacket[] = await db.query("SELECT id FROM obs_slot WHERE id = ?", [slotId]);
    if (!existing.length) { res.status(404).json({ message: "Slot introuvable." }); return; }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "label")) {
      sets.push("label = ?");
      params.push(req.body.label ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "match_id")) {
      const matchId = req.body.match_id;
      if (matchId !== null) {
        const matchExists: RowDataPacket[] = await db.query("SELECT id FROM `match` WHERE id = ?", [matchId]);
        if (!matchExists.length) { res.status(404).json({ message: "Match introuvable." }); return; }
      }
      sets.push("match_id = ?");
      params.push(matchId);
    }
    if (!sets.length) { res.status(412).json({ message: "Rien à mettre à jour." }); return; }

    params.push(slotId);
    await db.query(`UPDATE obs_slot SET ${sets.join(", ")} WHERE id = ?`, params);

    const slots: RowDataPacket[] = await db.query(SLOT_LIST_SQL);
    const updated = slots.find((s: any) => s.id === slotId);
    res.json({ slot: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /obs-slots/:id:
 *   delete:
 *     description: Supprime un slot OBS.
 *     tags:
 *       - obs-slots
 *     responses:
 *       200:
 *         description: Slot supprimé.
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const slotId = parseInt(req.params.id);
    if (isNaN(slotId)) { res.status(400).json({ message: "Invalid slot id." }); return; }
    await db.query("DELETE FROM obs_slot WHERE id = ?", [slotId]);
    res.json({ message: "Slot supprimé." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

export default router;
export type { ObsSlot };
