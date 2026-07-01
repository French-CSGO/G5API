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
  return db
    .runSql(
      "ALTER TABLE veto_session ADD COLUMN team1_ready BOOLEAN NOT NULL DEFAULT false AFTER last_acting_team;"
    )
    .then(() =>
      db.runSql(
        "ALTER TABLE veto_session ADD COLUMN team2_ready BOOLEAN NOT NULL DEFAULT false AFTER team1_ready;"
      )
    );
};

exports.down = function (db) {
  return db
    .removeColumn("veto_session", "team1_ready")
    .then(() => db.removeColumn("veto_session", "team2_ready"));
};

exports._meta = {
  version: 1,
};
