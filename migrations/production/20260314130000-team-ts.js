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
  return db.runSql(`
    ALTER TABLE team
      ADD COLUMN ts_server VARCHAR(128) DEFAULT NULL AFTER tag,
      ADD COLUMN ts_channel_id INT DEFAULT NULL AFTER ts_server;
  `);
};

exports.down = function (db) {
  return db.runSql(`
    ALTER TABLE team
      DROP COLUMN ts_channel_id,
      DROP COLUMN ts_server;
  `);
};

exports._meta = {
  version: 32,
};
