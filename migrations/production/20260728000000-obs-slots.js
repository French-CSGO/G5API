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
      id           INT NOT NULL AUTO_INCREMENT,
      slug         VARCHAR(32) NOT NULL,
      label        VARCHAR(100) DEFAULT NULL,
      match_id     INT DEFAULT NULL,
      user_id      INT DEFAULT NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_obs_slot_slug (slug),
      CONSTRAINT fk_obs_slot_match FOREIGN KEY (match_id)
        REFERENCES \`match\` (id) ON DELETE SET NULL ON UPDATE RESTRICT,
      CONSTRAINT fk_obs_slot_user FOREIGN KEY (user_id)
        REFERENCES user (id) ON DELETE SET NULL ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  );
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS obs_slot;");
};

exports._meta = {
  version: 1,
};
