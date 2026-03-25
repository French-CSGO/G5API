/**
 * Route API pour la gestion des paramètres stockés en DB.
 * Accessible uniquement aux super_admins.
 *
 * GET  /settings        → retourne tous les paramètres
 * PUT  /settings        → met à jour un ou plusieurs paramètres
 */

import { Router } from "express";
import Utils from "../utility/utils.js";
import { getAllSettings, setSettings, reloadServices } from "../services/settings.js";
import { Request, Response, NextFunction } from "express";

// Middleware : accessible aux super_admins uniquement
function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !Utils.superAdminCheck(req.user)) {
    return res.status(403).json({ message: "Accès réservé aux super-administrateurs." });
  }
  return next();
}

const router = Router();

/**
 * @swagger
 * /settings:
 *   get:
 *     summary: Retourne tous les paramètres de configuration
 *     tags: [Settings]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Paramètres retournés
 *       403:
 *         description: Accès refusé
 */
router.get("/", Utils.ensureAuthenticated, requireSuperAdmin, async (req: Request, res: Response) => {
  const settings = getAllSettings();
  // Masque les tokens/clés sensibles si demandé avec ?safe=1
  if (req.query.safe === "1") {
    const safe: Record<string, string> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (k.includes("token") || k.includes("apiKey") || k.includes("secret") || k.includes("password")) {
        safe[k] = v ? "****" : "";
      } else {
        safe[k] = v;
      }
    }
    return res.json(safe);
  }
  return res.json(settings);
});

/**
 * @swagger
 * /settings:
 *   put:
 *     summary: Met à jour un ou plusieurs paramètres
 *     tags: [Settings]
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties:
 *               type: string
 *     responses:
 *       200:
 *         description: Paramètres mis à jour
 *       400:
 *         description: Body invalide
 *       403:
 *         description: Accès refusé
 */
router.put("/", Utils.ensureAuthenticated, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ message: "Body invalide : objet attendu." });
    }

    // Filtre les valeurs non-string et protège contre la pollution de prototype
    const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
        entries[k] = String(v);
      }
    }

    await setSettings(entries);

    // Recharge les services en arrière-plan
    reloadServices().catch(err => console.error("[Settings] reloadServices:", err));

    return res.json({ message: "Paramètres mis à jour.", updated: Object.keys(entries) });
  } catch (err: unknown) {
    console.error("[Settings] PUT /settings error:", err);
    if (err instanceof Error) return res.status(500).json({ message: err.message });
    return res.status(500).json({ message: "Erreur interne." });
  }
});

export default router;
