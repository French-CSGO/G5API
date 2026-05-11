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
    `ALTER TABLE user ADD COLUMN IF NOT EXISTS cast TINYINT(1) NOT NULL DEFAULT 0`
  ).then(() => db.runSql(
    `ALTER TABLE game_server ADD COLUMN IF NOT EXISTS ip_cast VARCHAR(45) NULL DEFAULT NULL`
  ));
};

exports.down = function (db) {
  return db.runSql(
    `ALTER TABLE user DROP COLUMN IF EXISTS cast`
  ).then(() => db.runSql(
    `ALTER TABLE game_server DROP COLUMN IF EXISTS ip_cast`
  ));
};

exports._meta = {
  version: 34,
};
