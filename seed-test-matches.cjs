/**
 * Seed script — génère des matchs de test pour la saison 18
 * avec des maps finies + quelques maps en OT.
 *
 * Usage: node seed-test-matches.js
 */

const mysql = require('./node_modules/mysql2/promise.js');

const DB = {
  host: 'cubi.infra.local',
  port: 3306,
  user: 'get5',
  password: 'get5',
  database: 'get5',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function apiKey() { return Math.random().toString(36).slice(2, 18).padEnd(16, '0'); }
function tsAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const MAPS = [
  'de_dust2', 'de_mirage', 'de_inferno', 'de_ancient',
  'de_anubis', 'de_nuke', 'de_overpass', 'de_vertigo',
];
const SIDES = ['CT', 'T'];

// MR12: 13 rounds per half  →  regulation goes up to 24 total
// OT MR3: 6 rounds per OT
function genMap(withOT = false) {
  const firstSide = pick(SIDES);

  if (!withOT) {
    // Normal map: one team reaches 13
    const t1ct = rnd(3, 12);
    const t1t  = rnd(13 - t1ct, 13);  // sum ≥ 13 for a winner
    const t2ct = 12 - t1t;
    const t2t  = 12 - t1ct;
    const t1score = t1ct + t1t;
    const t2score = t2ct + t2t;
    return { firstSide, t1ct, t1t, t2ct, t2t, t1score, t2score, ot: [] };
  }

  // Regulation: tie at 12-12
  const t1regCt = rnd(4, 8);
  const t1regT  = 12 - t1regCt;
  const t2regCt = 12 - t1regT;
  const t2regT  = 12 - t1regCt;

  // Generate OTs (1 or 2)
  const numOT = rnd(1, 2);
  const ots = [];
  let cumT1ct = t1regCt, cumT1t = t1regT, cumT2ct = t2regCt, cumT2t = t2regT;

  for (let o = 1; o <= numOT; o++) {
    const otFirstSide = pick(SIDES);
    // Each OT: MR3 per half → 6 rounds total
    // Tie OT (not last): 3-3
    // Last OT: one side wins 4-2 or 3-... pick a winner
    let ot1ct, ot1t, ot2ct, ot2t;
    if (o < numOT) {
      // tie OT
      ot1ct = 3; ot1t = 3; ot2ct = 3; ot2t = 3;
    } else {
      // deciding OT
      ot1ct = rnd(1, 3); ot1t = rnd(1, 3);
      ot2ct = 3 - ot1t;  ot2t = 3 - ot1ct;
      // ensure one side gets 4 total
      if (ot1ct + ot1t === ot2ct + ot2t) { ot1ct++; }
    }

    ots.push({
      ot_number:      o,
      firstSide:      otFirstSide,
      team1_score_ct: ot1ct,
      team1_score_t:  ot1t,
      team2_score_ct: ot2ct,
      team2_score_t:  ot2t,
      offset_t1_ct:   cumT1ct,
      offset_t1_t:    cumT1t,
      offset_t2_ct:   cumT2ct,
      offset_t2_t:    cumT2t,
    });

    cumT1ct += ot1ct; cumT1t += ot1t;
    cumT2ct += ot2ct; cumT2t += ot2t;
  }

  const t1score = cumT1ct + cumT1t;
  const t2score = cumT2ct + cumT2t;

  return {
    firstSide, t1regCt, t1regT, t2regCt, t2regT,
    t1ct: cumT1ct, t1t: cumT1t, t2ct: cumT2ct, t2t: cumT2t,
    t1score, t2score,
    ot: ots,
  };
}

async function main() {
  const db = await mysql.createConnection(DB);
  console.log('Connecté à la DB.');

  try {
    // Récupère season_id=18 et user/teams disponibles
    const [[season]] = await db.execute('SELECT id FROM season WHERE id = 18');
    if (!season) { console.error('Saison 18 introuvable.'); process.exit(1); }

    const [users] = await db.execute('SELECT id FROM user LIMIT 1');
    if (!users.length) { console.error('Aucun user.'); process.exit(1); }
    const userId = users[0].id;

    const [teams] = await db.execute('SELECT id, name FROM team ORDER BY id LIMIT 10');
    if (teams.length < 2) { console.error('Pas assez d\'équipes.'); process.exit(1); }

    console.log(`Season 18 ✓ | user ${userId} | ${teams.length} équipes disponibles`);

    // Génère 5 matchs BO1, 2 matchs BO3
    const matchDefs = [
      { maxMaps: 1 }, { maxMaps: 1 }, { maxMaps: 1 },
      { maxMaps: 1 }, { maxMaps: 1 },
      { maxMaps: 3 }, { maxMaps: 3 },
    ];

    for (const [mi, def] of matchDefs.entries()) {
      const shuffled = [...teams].sort(() => Math.random() - 0.5);
      const t1 = shuffled[0], t2 = shuffled[1];
      const daysAgo = rnd(5, 60);
      const startTime = tsAgo(daysAgo + 1);
      const endTime   = tsAgo(daysAgo);
      const numMaps   = def.maxMaps === 1 ? 1 : rnd(2, 3);

      // Insert match
      const [matchRes] = await db.execute(
        `INSERT INTO \`match\`
          (user_id, team1_id, team2_id, season_id, max_maps, api_key,
           start_time, end_time, cancelled, team1_string, team2_string,
           team1_score, team2_score, veto_mappool)
         VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?)`,
        [
          userId, t1.id, t2.id, 18, def.maxMaps, apiKey(),
          startTime, endTime,
          t1.name, t2.name,
          0, 0,  // updated after maps
          MAPS.slice(0, 7).join(' '),
        ]
      );
      const matchId = matchRes.insertId;
      let t1Series = 0, t2Series = 0;

      for (let mn = 0; mn < numMaps; mn++) {
        const useOT = Math.random() < 0.3; // 30% chance d'OT
        const m = genMap(useOT);

        const t1wins = m.t1score > m.t2score;
        const winner = t1wins ? t1.id : t2.id;
        if (t1wins) t1Series++; else t2Series++;

        const mapName = pick(MAPS);

        const [msRes] = await db.execute(
          `INSERT INTO map_stats
            (match_id, map_number, map_name, start_time, end_time, winner,
             team1_score, team1_score_ct, team1_score_t,
             team2_score, team2_score_ct, team2_score_t,
             team1_first_side,
             team1_reg_score_ct, team1_reg_score_t,
             team2_reg_score_ct, team2_reg_score_t)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            matchId, mn, mapName, startTime, endTime, winner,
            m.t1score, m.t1ct, m.t1t,
            m.t2score, m.t2ct, m.t2t,
            m.firstSide,
            m.t1regCt ?? null, m.t1regT ?? null,
            m.t2regCt ?? null, m.t2regT ?? null,
          ]
        );
        const mapStatsId = msRes.insertId;

        for (const ot of m.ot) {
          await db.execute(
            `INSERT INTO map_stats_ot
              (map_stats_id, ot_number, team1_first_side,
               team1_score_ct, team1_score_t, team2_score_ct, team2_score_t,
               offset_t1_ct, offset_t1_t, offset_t2_ct, offset_t2_t)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              mapStatsId, ot.ot_number, ot.firstSide,
              ot.team1_score_ct, ot.team1_score_t,
              ot.team2_score_ct, ot.team2_score_t,
              ot.offset_t1_ct, ot.offset_t1_t,
              ot.offset_t2_ct, ot.offset_t2_t,
            ]
          );
        }
        console.log(`  map ${mn} [${mapName}] ${m.t1score}-${m.t2score}${m.ot.length ? ` (${m.ot.length} OT)` : ''}`);
      }

      // Update match series scores + winner
      const seriesWinner = t1Series > t2Series ? t1.id : t2.id;
      await db.execute(
        'UPDATE `match` SET team1_score=?, team2_score=?, winner=? WHERE id=?',
        [t1Series, t2Series, seriesWinner, matchId]
      );

      console.log(`Match #${matchId} BO${def.maxMaps}: ${t1.name} ${t1Series}-${t2Series} ${t2.name}`);
    }

    console.log('\n✓ Seed terminé.');
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
