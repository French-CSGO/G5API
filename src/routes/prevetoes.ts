/**
 * @swagger
 * resourcePath: /prevetoes
 * description: Express API router for the pre-match web veto (token-authenticated, no login required).
 */
import { Router } from "express";

const router = Router();

import GlobalEmitter from "../utility/emitter.js";
import {
  getPublicState,
  submitReady,
  submitStartChoice,
  submitAction,
  submitSide,
  adminForce,
  adminReset
} from "../services/prevetoservice.js";

/**
 * @swagger
 *
 * /prevetoes/{token}:
 *   get:
 *     description: Get the current state of a pre-match veto session for a given team/tablet/admin token.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: token
 *         required: true
 *         schema:
 *            type: string
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Current pre-match veto state.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get("/:token", async (req, res) => {
  try {
    const state = await getPublicState(req.params.token);
    if (!state) {
      res.status(404).json({ message: "Session de veto introuvable." });
      return;
    }
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/stream:
 *   get:
 *     description: Get live updates of a pre-match veto session, via SSE.
 *     produces:
 *       - text/event-stream
 *     parameters:
 *       - name: token
 *         required: true
 *         schema:
 *            type: string
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Live pre-match veto state.
 */
router.get("/:token/stream", async (req, res) => {
  try {
    const token = req.params.token;
    const initialState = await getPublicState(token);
    if (!initialState) {
      res.status(404).json({ message: "Session de veto introuvable." });
      return;
    }

    res.set({
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();

    const writeState = async () => {
      const state = await getPublicState(token);
      if (state) res.write(`event: prevetodata\ndata: ${JSON.stringify(state)}\n\n`);
    };

    await writeState();

    // We don't know the session id ahead of a token lookup, so we listen
    // broadly and just re-fetch/re-check on every pre-veto mutation.
    const onUpdate: () => Promise<void> = async () => {
      await writeState();
    };
    GlobalEmitter.on("prevetoUpdateAny", onUpdate);

    req.on("close", () => {
      GlobalEmitter.removeListener("prevetoUpdateAny", onUpdate);
      res.end();
    });
    req.on("disconnect", () => {
      GlobalEmitter.removeListener("prevetoUpdateAny", onUpdate);
      res.end();
    });
  } catch (err) {
    console.error(err);
    res.status(500).write(`event: error\ndata: ${(err as Error).toString()}\n\n`);
    res.end();
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/ready:
 *   post:
 *     description: Mark a team ready. Both teams must be ready before the veto (and its timer) starts.
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Ready state applied.
 */
router.post("/:token/ready", async (req, res) => {
  try {
    const team = req.body?.team === "team2" ? "team2" : req.body?.team === "team1" ? "team1" : undefined;
    const result = await submitReady(req.params.token, team);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/start-choice:
 *   post:
 *     description: Team1 chooses to start the veto as generated, or swap first pick to team2.
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Choice applied.
 */
router.post("/:token/start-choice", async (req, res) => {
  try {
    const choice = req.body?.choice === "swap" ? "swap" : "start";
    const result = await submitStartChoice(req.params.token, choice);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/action:
 *   post:
 *     description: Submit a ban or pick for the current step.
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Action applied.
 */
router.post("/:token/action", async (req, res) => {
  try {
    const type = req.body?.type === "pick" ? "pick" : "ban";
    const map = req.body?.map;
    if (typeof map !== "string" || !map.length) {
      res.status(400).json({ ok: false, message: "Aucune map fournie." });
      return;
    }
    const result = await submitAction(req.params.token, type, map);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/side:
 *   post:
 *     description: Submit a side choice (ct/t) for the pending map.
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Side applied.
 */
router.post("/:token/side", async (req, res) => {
  try {
    const side = req.body?.side === "t" ? "t" : "ct";
    const result = await submitSide(req.params.token, side);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/admin/force:
 *   post:
 *     description: Admin-only. Force-resolve the current pending step at random, as if its timer had expired.
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Step forced.
 */
router.post("/:token/admin/force", async (req, res) => {
  try {
    const result = await adminForce(req.params.token);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /prevetoes/{token}/admin/reset:
 *   post:
 *     description: Admin-only. Reset the veto session back to its starting state.
 *     tags:
 *       - prevetoes
 *     responses:
 *       200:
 *         description: Session reset.
 */
router.post("/:token/admin/reset", async (req, res) => {
  try {
    const result = await adminReset(req.params.token);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

export default router;
