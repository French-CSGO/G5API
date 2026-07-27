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
    `CREATE TABLE IF NOT EXISTS season_challonge_match_position (
      id                  INT NOT NULL AUTO_INCREMENT,
      tournament_id       INT NOT NULL,
      challonge_match_id  BIGINT NOT NULL,
      x                   INT NOT NULL,
      y                   INT NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_scmp_tournament_match (tournament_id, challonge_match_id),
      CONSTRAINT fk_scmp_tournament FOREIGN KEY (tournament_id)
        REFERENCES season_challonge_tournament (id) ON DELETE CASCADE ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS season_challonge_match_position;");
};

exports._meta = {
  version: 1,
};
