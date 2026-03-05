"use strict";

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db) {
  return db.changeColumn("team", "challonge_team_id", {
    type: "string",
    length: 100,
    notNull: false,
    defaultValue: null
  });
};

exports.down = function (db) {
  return db.changeColumn("team", "challonge_team_id", {
    type: "int",
    length: 11,
    notNull: false,
    defaultValue: null
  });
};

exports._meta = {
  version: 28 
};