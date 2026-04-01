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
      `ALTER TABLE map_stats
        ADD COLUMN team1_reg_score_ct INT DEFAULT NULL AFTER team1_score_t,
        ADD COLUMN team1_reg_score_t  INT DEFAULT NULL AFTER team1_reg_score_ct,
        ADD COLUMN team2_reg_score_ct INT DEFAULT NULL AFTER team2_score_t,
        ADD COLUMN team2_reg_score_t  INT DEFAULT NULL AFTER team2_reg_score_ct;`
    )
    .then(() =>
      db.runSql(
        `CREATE TABLE IF NOT EXISTS map_stats_ot (
          id              INT NOT NULL AUTO_INCREMENT,
          map_stats_id    INT NOT NULL,
          ot_number       INT NOT NULL,
          team1_first_side VARCHAR(2) DEFAULT NULL,
          -- per-OT scores (delta from OT start)
          team1_score_ct  INT NOT NULL DEFAULT 0,
          team1_score_t   INT NOT NULL DEFAULT 0,
          team2_score_ct  INT NOT NULL DEFAULT 0,
          team2_score_t   INT NOT NULL DEFAULT 0,
          -- cumulative totals at the START of this OT (used to compute delta)
          offset_t1_ct    INT NOT NULL DEFAULT 0,
          offset_t1_t     INT NOT NULL DEFAULT 0,
          offset_t2_ct    INT NOT NULL DEFAULT 0,
          offset_t2_t     INT NOT NULL DEFAULT 0,
          PRIMARY KEY (id),
          UNIQUE KEY uq_map_stats_ot (map_stats_id, ot_number),
          CONSTRAINT fk_map_stats_ot FOREIGN KEY (map_stats_id)
            REFERENCES map_stats (id) ON DELETE CASCADE ON UPDATE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
      )
    );
};

exports.down = function (db) {
  return db
    .runSql("DROP TABLE IF EXISTS map_stats_ot;")
    .then(() =>
      db.runSql(
        `ALTER TABLE map_stats
          DROP COLUMN team1_reg_score_ct,
          DROP COLUMN team1_reg_score_t,
          DROP COLUMN team2_reg_score_ct,
          DROP COLUMN team2_reg_score_t;`
      )
    );
};

exports._meta = {
  version: 34,
};
