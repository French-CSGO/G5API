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
    `CREATE TABLE IF NOT EXISTS swiss_board (
      id         INT NOT NULL AUTO_INCREMENT,
      season_id  INT NOT NULL,
      data       LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_swiss_board_season (season_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS swiss_board;");
};

exports._meta = {
  version: 1,
};
