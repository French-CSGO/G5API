import { createCanvas } from "canvas";
import { drawText, drawRoundRect, drawBackground, drawLogoCentered, tryRegisterFont, stripAccents } from "../helpers.js";
import { tryLoadLogo } from "./loaders.js";
import type { ImageSettings, SwissMatch, SwissPositionRow } from "../types.js";

function setScore(m: SwissMatch): [number, number] | null {
  if (!m.score_in_sets || !m.score_in_sets.length) return null;
  return m.score_in_sets.reduce<[number, number]>(
    (acc, [a, b]) => [acc[0] + (a > b ? 1 : 0), acc[1] + (b > a ? 1 : 0)],
    [0, 0]
  );
}

export async function generateSwissImage(
  matches: SwissMatch[],
  positions: SwissPositionRow[],
  s: ImageSettings
): Promise<Buffer> {
  const cfg = s.swiss;
  const W   = s.canvas.width;
  const H   = s.canvas.height;

  tryRegisterFont(cfg.fontFile, [cfg.team_name.font, cfg.score.font]);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  await drawBackground(ctx, cfg.background, W, H);

  const matchById = new Map(matches.map(m => [m.id, m]));
  const box = cfg.box;

  const nameFont  = `${cfg.team_name.bold ? "bold " : ""}${cfg.team_name.size}px ${cfg.team_name.font}`;
  const scoreFont = `${cfg.score.bold   ? "bold " : ""}${cfg.score.size}px ${cfg.score.font}`;
  const vsFont    = `${cfg.vs_label.size}px ${cfg.team_name.font}`;

  for (const pos of positions) {
    const m = matchById.get(pos.challonge_match_id);
    if (!m) continue;

    const x = pos.x - box.width / 2;
    const y = pos.y - box.height / 2;

    const captionH = cfg.team_name.enabled ? Math.round(box.height * 0.22) : 0;
    const slotSize = box.height - captionH;
    const x2 = x + box.width - slotSize;

    const score = setScore(m);
    const isComplete = m.state === "complete" && score !== null;
    const team1Won = isComplete && score![0] > score![1];
    const team2Won = isComplete && score![1] > score![0];

    const slot1Fill = team1Won ? box.fill_win : team2Won ? box.fill_lose : box.fill_default;
    const slot2Fill = team2Won ? box.fill_win : team1Won ? box.fill_lose : box.fill_default;

    drawRoundRect(ctx, x,  y, slotSize, slotSize, box.radius, slot1Fill, box.alpha, box.border, box.border_alpha, box.border_width);
    drawRoundRect(ctx, x2, y, slotSize, slotSize, box.radius, slot2Fill, box.alpha, box.border, box.border_alpha, box.border_width);

    if (cfg.logo.enabled) {
      const [logo1, logo2] = await Promise.all([
        tryLoadLogo(m.player1?.local_team?.logo),
        tryLoadLogo(m.player2?.local_team?.logo),
      ]);
      drawLogoCentered(ctx, logo1, { x: x  + slotSize / 2, y: y + slotSize / 2, size: cfg.logo.size });
      drawLogoCentered(ctx, logo2, { x: x2 + slotSize / 2, y: y + slotSize / 2, size: cfg.logo.size });
    }

    const midX = x + box.width / 2;
    const midY = y + slotSize / 2;
    if (isComplete) {
      drawText(ctx, `${score![0]} - ${score![1]}`, midX, midY, scoreFont, cfg.score.color, "center");
    } else if (cfg.vs_label.enabled) {
      drawText(ctx, cfg.vs_label.text, midX, midY, vsFont, cfg.vs_label.color, "center");
    }

    if (cfg.team_name.enabled) {
      const name1 = m.player1 ? m.player1.name : "TBD";
      const name2 = m.player2 ? m.player2.name : "TBD";
      const captionY = y + slotSize + captionH / 2;
      drawText(ctx, stripAccents(name1), x  + slotSize / 2, captionY, nameFont, cfg.team_name.color, "center");
      drawText(ctx, stripAccents(name2), x2 + slotSize / 2, captionY, nameFont, cfg.team_name.color, "center");
    }
  }

  return canvas.toBuffer("image/png");
}
