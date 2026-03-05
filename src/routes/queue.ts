/**
 * @swagger
 * resourcePath: /queue
 * description: Express API router for queue management in G5API.
 */
import config from "config";
import { Router } from "express";
import Utils from "../utility/utils.js";
import { QueueService } from "../services/queue.js";
import GlobalEmitter from "../utility/emitter.js";

const router = Router();

/**
 * @swagger
 *
 * components:
 *  schemas:
 *    QueueDescriptor:
 *      type: object
 *      properties:
 *        name:
 *          type: string
 *          description: Unique identifier for the queue
 *          example: "clutch-karambit"
 *        createdAt:
 *          type: integer
 *          format: int64
 *          description: Timestamp (ms) when the queue was created
 *        expiresAt:
 *          type: integer
 *          format: int64
 *          description: Timestamp (ms) when the queue will expire
 *        ownerId:
 *          type: string
 *          nullable: true
 *          description: Steam ID of the queue creator
 *        maxSize:
 *          type: integer
 *          description: Max number of players allowed
 *          example: 10
 *        isPrivate:
 *          type: boolean
 *          description: Whether the queue is private
 *        currentPlayers:
 *          type: integer
 *          description: Current number of players in queue
 */

/**
 * @swagger
 * /queue/:
 *   get:
 *     description: Get all available queues to the authenticated user.
 *     produces:
 *       - application/json
 *     tags:
 *       - queue
 *     responses:
 *       200:
 *         description: List of queues.
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", Utils.ensureAuthenticated, async (req, res) => {
  try {
    let role: string = "user";
    if (req.user?.super_admin) role = "super_admin";
    else if (req.user?.admin) role = "admin";
    const queues = await QueueService.listQueues(req.user?.steam_id!, role);
    res.status(200).json(queues);
  } catch (error) {
    console.error("Error listing queues:", error);
    res.status(500).json({ error: "Failed to list queues." });
  }
});

/**
 * @swagger
 * /queue/:slug:
 *   get:
 *     description: Get a specific queue by its slug.
 *     tags:
 *       - queue
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Queue descriptor.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:slug", async (req, res) => {
  const slug: string = req.params.slug;
  try {
    let role: string = "user";
    if (req.user?.super_admin) role = "super_admin";
    else if (req.user?.admin) role = "admin";
    const queue = await QueueService.getQueue(slug, role, req.user?.steam_id ?? "");
    res.status(200).json(queue);
  } catch (error: any) {
    if (error.message?.includes("does not exist")) {
      return res.status(404).json({ error: "Queue not found." });
    }
    console.error("Error fetching queue:", error);
    res.status(500).json({ error: "Failed to fetch queue." });
  }
});

/**
 * @swagger
 * /queue/:slug/players:
 *   get:
 *     description: List all players in a specific queue.
 *     tags:
 *       - queue
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of players.
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:slug/players", Utils.ensureAuthenticated, async (req, res) => {
  const slug: string = req.params.slug;
  if (!req.user?.steam_id) {
    return res.status(401).json({ error: "Unauthorized: Steam ID missing." });
  }
  try {
    const users = await QueueService.listUsersInQueue(slug);
    res.status(200).json(users);
  } catch (error) {
    console.error("Error listing players in queue:", error);
    res.status(500).json({ error: "Failed to list players in queue." });
  }
});

/**
 * @swagger
 * /queue/:slug/stream:
 *   get:
 *     description: Server-sent event stream for real-time queue updates.
 *     produces:
 *       - text/event-stream
 *     tags:
 *       - queue
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SSE stream of queue events (playerJoined, playerLeft, full).
 *       404:
 *         $ref: '#/components/responses/NotFound'
 */
router.get("/:slug/stream", async (req, res) => {
  const slug: string = req.params.slug;

  try {
    // Verify queue exists before opening stream
    let role: string = "user";
    if (req.user?.super_admin) role = "super_admin";
    else if (req.user?.admin) role = "admin";
    await QueueService.getQueue(slug, role, req.user?.steam_id ?? "");
  } catch (error: any) {
    if (error.message?.includes("does not exist")) {
      return res.status(404).json({ error: "Queue not found." });
    }
    // If permission error, still allow streaming public queues
  }

  res.set({
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Send initial queue state
  try {
    const players = await QueueService.listUsersInQueue(slug);
    const meta = await QueueService.getQueue(slug, "user", req.user?.steam_id ?? "").catch(() => null);
    res.write(`event: queueInit\ndata: ${JSON.stringify({ slug, players, meta })}\n\n`);
  } catch {
    // Queue may have expired
  }

  const onPlayerJoined = (data: any) => {
    if (data.slug !== slug) return;
    res.write(`event: playerJoined\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onPlayerLeft = (data: any) => {
    if (data.slug !== slug) return;
    res.write(`event: playerLeft\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onQueueFull = (data: any) => {
    if (data.slug !== slug) return;
    res.write(`event: queueFull\ndata: ${JSON.stringify(data)}\n\n`);
  };

  (GlobalEmitter as any).on("queue:playerJoined", onPlayerJoined);
  (GlobalEmitter as any).on("queue:playerLeft", onPlayerLeft);
  (GlobalEmitter as any).on("queue:full", onQueueFull);

  const cleanup = () => {
    (GlobalEmitter as any).removeListener("queue:playerJoined", onPlayerJoined);
    (GlobalEmitter as any).removeListener("queue:playerLeft", onPlayerLeft);
    (GlobalEmitter as any).removeListener("queue:full", onQueueFull);
    res.end();
  };

  req.on("close", cleanup);
  req.on("disconnect", cleanup);
});

/**
 * @swagger
 * /queue/:
 *   post:
 *     description: Create a new queue.
 *     tags:
 *       - queue
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 maxPlayers:
 *                   type: integer
 *                   example: 10
 *                 private:
 *                   type: boolean
 *                   example: false
 *     responses:
 *       200:
 *         description: Queue created successfully.
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.post("/", Utils.ensureAuthenticated, async (req, res) => {
  const maxPlayers: number = req.body[0]?.maxPlayers ?? 10;
  const isPrivate: boolean = req.body[0]?.private ? true : false;

  try {
    const { queue, matchId } = await QueueService.createQueue(
      req.user?.steam_id!,
      req.user?.name!,
      maxPlayers,
      isPrivate
    );
    res.json({
      message: "Queue created successfully!",
      queue,
      matchId: matchId ?? null,
      url: `${config.get("server.apiURL")}/queue/${queue.name}`,
    });
  } catch (error) {
    console.error("Error creating queue:", error);
    res.status(500).json({ error: "Failed to create queue." });
  }
});

/**
 * @swagger
 * /queue/:slug:
 *   put:
 *     description: Join or leave a queue.
 *     tags:
 *       - queue
 *     parameters:
 *       - name: slug
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 action:
 *                   type: string
 *                   enum: [join, leave]
 *                   default: join
 *     responses:
 *       200:
 *         description: Action performed successfully.
 *       400:
 *         description: Invalid action.
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.put("/:slug", Utils.ensureAuthenticated, async (req, res) => {
  const slug: string = req.params.slug;
  const action: string = req.body[0]?.action ?? "join";

  try {
    if (action === "join") {
      const { matchId } = await QueueService.addUserToQueue(
        slug,
        req.user?.steam_id!,
        req.user?.name!
      );

      if (matchId) {
        return res.status(200).json({
          success: true,
          matchId,
          message: "Match created successfully from full queue.",
        });
      }

      return res.status(200).json({ success: true });
    } else if (action === "leave") {
      let role: string = "user";
      if (req.user?.super_admin) role = "super_admin";
      else if (req.user?.admin) role = "admin";

      await QueueService.removeUserFromQueue(
        slug,
        req.user?.steam_id!,
        req.user?.steam_id!,
        role
      );

      const currentQueueCount = await QueueService.getCurrentQueuePlayerCount(slug).catch(() => 0);
      if (currentQueueCount === 0) {
        await QueueService.deleteQueue(slug, req.user?.steam_id!, role).catch(() => {});
      }

      return res.status(200).json({ success: true });
    } else {
      return res.status(400).json({ error: 'Invalid action. Must be "join" or "leave".' });
    }
  } catch (error: any) {
    console.error(`Error processing ${action} for queue ${slug}:`, error);
    res.status(500).json({ error: `Failed to ${action} queue.` });
  }
});

/**
 * @swagger
 * /queue/:
 *   delete:
 *     description: Delete a specific queue. Only the owner or admins can delete.
 *     tags:
 *       - queue
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 slug:
 *                   type: string
 *     responses:
 *       200:
 *         description: Queue deleted.
 *       403:
 *         description: Permission denied.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.delete("/", Utils.ensureAuthenticated, async (req, res) => {
  const slug: string = req.body[0]?.slug;

  try {
    let role: string = "user";
    if (req.user?.super_admin) role = "super_admin";
    else if (req.user?.admin) role = "admin";
    await QueueService.deleteQueue(slug, req.user?.steam_id!, role);
    res
      .status(200)
      .json({ message: "Queue deleted successfully.", success: true });
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return res.status(403).json({ error: error.message });
    }
    if (error.message?.includes("not found") || error.message?.includes("does not exist")) {
      return res.status(404).json({ error: "Queue not found." });
    }
    console.error("Error deleting queue:", error);
    res.status(500).json({ error: "Failed to delete queue." });
  }
});

export default router;
