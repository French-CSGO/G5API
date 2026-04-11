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
    `ALTER TABLE \`match\`
      ADD COLUMN toornament_id VARCHAR(64) DEFAULT NULL AFTER season_id,
      ADD COLUMN challonge_id  BIGINT      DEFAULT NULL AFTER toornament_id;`
  );
};

exports.down = function (db) {
  return db.runSql(
    `ALTER TABLE \`match\`
      DROP COLUMN challonge_id,
      DROP COLUMN toornament_id;`
  );
};

exports._meta = {
  version: 35,
};
