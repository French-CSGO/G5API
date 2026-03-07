"use strict";

var dbm;
var type;
var seed;

exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db, callback) {
  return db.runSql(
    "ALTER TABLE game_server ADD COLUMN IF NOT EXISTS pterodactyl_id VARCHAR(36) NULL DEFAULT NULL;"
  );
};

exports.down = function (db, callback) {
  return db.runSql(
    "ALTER TABLE game_server DROP COLUMN IF EXISTS pterodactyl_id;"
  );
};

exports._meta = {
  version: 29,
};
