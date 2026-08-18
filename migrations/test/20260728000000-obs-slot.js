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
    `CREATE TABLE IF NOT EXISTS obs_slot (
      id         INT NOT NULL AUTO_INCREMENT,
      user_id    INT NOT NULL,
      label      VARCHAR(100) DEFAULT NULL,
      slug       VARCHAR(32) NOT NULL,
      match_id   INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_obs_slot_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS obs_slot;");
};

exports._meta = {
  version: 1,
};
