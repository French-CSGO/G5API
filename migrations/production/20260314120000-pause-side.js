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
    "ALTER TABLE match_pause ADD COLUMN side VARCHAR(10) DEFAULT NULL AFTER team_paused;"
  );
};

exports.down = function (db) {
  return db.runSql("ALTER TABLE match_pause DROP COLUMN side;");
};

exports._meta = {
  version: 31,
};
