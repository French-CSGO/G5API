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
  return db.runSql(
    `ALTER TABLE map_stats
      ADD COLUMN team1_score_ct INT NOT NULL DEFAULT 0 AFTER team1_score,
      ADD COLUMN team1_score_t  INT NOT NULL DEFAULT 0 AFTER team1_score_ct,
      ADD COLUMN team2_score_ct INT NOT NULL DEFAULT 0 AFTER team2_score,
      ADD COLUMN team2_score_t  INT NOT NULL DEFAULT 0 AFTER team2_score_ct,
      ADD COLUMN team1_first_side VARCHAR(2) DEFAULT NULL AFTER team2_score_t;`
  );
};

exports.down = function (db) {
  return db.runSql(
    `ALTER TABLE map_stats
      DROP COLUMN team1_score_ct,
      DROP COLUMN team1_score_t,
      DROP COLUMN team2_score_ct,
      DROP COLUMN team2_score_t,
      DROP COLUMN team1_first_side;`
  );
};

exports._meta = {
  version: 33,
};
