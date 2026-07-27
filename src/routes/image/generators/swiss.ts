import { createCanvas } from "canvas";
import { drawText, drawRoundRect, drawBackground, tryRegisterFont, stripAccents } from "../helpers.js";
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

  for (const pos of positions) {
    const m = matchById.get(pos.challonge_match_id);
    if (!m) continue;

    const x = pos.x - box.width / 2;
    const y = pos.y - box.height / 2;

    drawRoundRect(
      ctx, x, y, box.width, box.height, box.radius,
      box.fill, box.alpha, box.border, box.border_alpha, box.border_width
    );

    const score = setScore(m);
    const isComplete = m.state === "complete" && score !== null;
    const team1Won = isComplete && score![0] > score![1];
    const team2Won = isComplete && score![1] > score![0];

    const name1 = m.player1 ? m.player1.name : "TBD";
    const name2 = m.player2 ? m.player2.name : "TBD";

    const nameFont  = `${cfg.team_name.bold ? "bold " : ""}${cfg.team_name.size}px ${cfg.team_name.font}`;
    const scoreFont = `${cfg.score.bold   ? "bold " : ""}${cfg.score.size}px ${cfg.score.font}`;

    const rowH = box.height / 2;
    const nameX = x + 14;
    const scoreX = x + box.width - 14;

    drawText(ctx, stripAccents(name1), nameX, y + rowH * 0.5, nameFont,
      team1Won ? cfg.team_name.winner_color : cfg.team_name.color, "left");
    drawText(ctx, stripAccents(name2), nameX, y + rowH * 1.5, nameFont,
      team2Won ? cfg.team_name.winner_color : cfg.team_name.color, "left");

    if (isComplete) {
      drawText(ctx, String(score![0]), scoreX, y + rowH * 0.5, scoreFont, cfg.score.color, "right");
      drawText(ctx, String(score![1]), scoreX, y + rowH * 1.5, scoreFont, cfg.score.color, "right");
    } else if (cfg.vs_label.enabled) {
      drawText(ctx, cfg.vs_label.text, scoreX, y + rowH, `${cfg.vs_label.size}px ${cfg.team_name.font}`, cfg.vs_label.color, "right");
    }
  }

  return canvas.toBuffer("image/png");
}
