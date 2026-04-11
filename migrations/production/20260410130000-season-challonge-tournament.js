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
    `CREATE TABLE IF NOT EXISTS season_challonge_tournament (
      id            INT NOT NULL AUTO_INCREMENT,
      season_id     INT NOT NULL,
      challonge_slug VARCHAR(100) NOT NULL,
      label         VARCHAR(60)  NOT NULL DEFAULT 'Main',
      display_order INT          NOT NULL DEFAULT 0,
      PRIMARY KEY (id),
      UNIQUE KEY uq_season_slug (season_id, challonge_slug),
      CONSTRAINT fk_sct_season FOREIGN KEY (season_id)
        REFERENCES season (id) ON DELETE CASCADE ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS season_challonge_tournament;");
};

exports._meta = {
  version: 36,
};
