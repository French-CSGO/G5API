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
  return db.runSql(`
    CREATE TABLE IF NOT EXISTS map_round (
      id           INT          NOT NULL AUTO_INCREMENT,
      map_stats_id INT          NOT NULL,
      round_number SMALLINT     NOT NULL,
      winner_team  VARCHAR(10)  NOT NULL,
      winner_side  VARCHAR(5)   NOT NULL,
      reason       TINYINT      NOT NULL,
      t1_score     SMALLINT     NOT NULL DEFAULT 0,
      t2_score     SMALLINT     NOT NULL DEFAULT 0,
      team1_side   VARCHAR(5)   NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_map_round (map_stats_id, round_number),
      CONSTRAINT fk_map_round_map FOREIGN KEY (map_stats_id)
        REFERENCES map_stats (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
};

exports.down = function (db) {
  return db.runSql(`DROP TABLE IF EXISTS map_round;`);
};

exports._meta = {
  version: 1,
};
