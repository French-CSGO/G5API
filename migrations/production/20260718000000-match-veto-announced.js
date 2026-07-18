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
    "ALTER TABLE `match` ADD COLUMN veto_announced BOOLEAN NOT NULL DEFAULT false AFTER pending_veto;"
  );
};

exports.down = function (db) {
  return db.removeColumn("match", "veto_announced");
};

exports._meta = {
  version: 1,
};
