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
    `CREATE TABLE IF NOT EXISTS season_round_format (
      id            INT NOT NULL AUTO_INCREMENT,
      season_id     INT NOT NULL,
      round_id      VARCHAR(64) NOT NULL,
      max_maps      INT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_season_round (season_id, round_id),
      CONSTRAINT fk_srf_season FOREIGN KEY (season_id)
        REFERENCES season (id) ON DELETE CASCADE ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS season_round_format;");
};

exports._meta = {
  version: 1,
};
