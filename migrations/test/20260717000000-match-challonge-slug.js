"use strict";

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  return db
    .runSql(
      `ALTER TABLE \`match\`
        ADD COLUMN challonge_slug VARCHAR(100) DEFAULT NULL AFTER challonge_id;`
    )
    .then(() =>
      // Backfill: seasons with exactly one registered bracket are unambiguous.
      db.runSql(
        `UPDATE \`match\` m
         JOIN (
           SELECT season_id, MIN(challonge_slug) AS challonge_slug
           FROM season_challonge_tournament
           GROUP BY season_id
           HAVING COUNT(*) = 1
         ) sct ON sct.season_id = m.season_id
         SET m.challonge_slug = sct.challonge_slug
         WHERE m.challonge_id IS NOT NULL AND m.challonge_slug IS NULL;`
      )
    )
    .then(() =>
      // Backfill: legacy seasons using season.challonge_url with no season_challonge_tournament rows.
      db.runSql(
        `UPDATE \`match\` m
         JOIN season s ON s.id = m.season_id
         SET m.challonge_slug = s.challonge_url
         WHERE m.challonge_id IS NOT NULL
           AND m.challonge_slug IS NULL
           AND s.challonge_url IS NOT NULL AND s.challonge_url != ''
           AND s.challonge_url NOT LIKE 't:%'
           AND NOT EXISTS (
             SELECT 1 FROM season_challonge_tournament sct2 WHERE sct2.season_id = m.season_id
           );`
      )
    );
};

exports.down = function (db) {
  return db.runSql(`ALTER TABLE \`match\` DROP COLUMN challonge_slug;`);
};

exports._meta = {
  version: 1,
};
