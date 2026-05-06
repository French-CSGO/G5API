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
    `ALTER TABLE map_round MODIFY COLUMN reason VARCHAR(30) NOT NULL;`
  );
};

exports.down = function (db) {
  return db.runSql(
    `ALTER TABLE map_round MODIFY COLUMN reason TINYINT NOT NULL;`
  );
};

exports._meta = {
  version: 1,
};
