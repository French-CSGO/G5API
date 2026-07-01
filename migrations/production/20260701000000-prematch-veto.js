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
      "ALTER TABLE `match` ADD COLUMN pending_veto BOOLEAN DEFAULT false NOT NULL AFTER skip_veto;"
    )
    .then(() =>
      db.runSql(
        `CREATE TABLE IF NOT EXISTS veto_session (
          id                   INT NOT NULL AUTO_INCREMENT,
          match_id             INT NOT NULL,
          status               VARCHAR(20) NOT NULL DEFAULT 'awaiting_start',
          map_pool             TEXT NOT NULL,
          num_maps             INT NOT NULL,
          side_type            VARCHAR(32) NOT NULL DEFAULT 'standard',
          starting_team        VARCHAR(5) NOT NULL DEFAULT 'team1',
          plan                 TEXT NOT NULL,
          current_step_index   INT NOT NULL DEFAULT 0,
          pending_side_map     VARCHAR(64) DEFAULT NULL,
          pending_side_team    VARCHAR(5) DEFAULT NULL,
          last_acting_team     VARCHAR(5) DEFAULT NULL,
          timer_enabled        BOOLEAN NOT NULL DEFAULT true,
          timer_seconds        INT NOT NULL DEFAULT 30,
          step_deadline        DATETIME DEFAULT NULL,
          team1_token          VARCHAR(64) NOT NULL,
          team2_token          VARCHAR(64) NOT NULL,
          tablet_token         VARCHAR(64) NOT NULL,
          admin_token          VARCHAR(64) NOT NULL,
          created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_veto_session_match (match_id),
          UNIQUE KEY uq_veto_session_team1_token (team1_token),
          UNIQUE KEY uq_veto_session_team2_token (team2_token),
          UNIQUE KEY uq_veto_session_tablet_token (tablet_token),
          UNIQUE KEY uq_veto_session_admin_token (admin_token),
          CONSTRAINT fk_veto_session_match FOREIGN KEY (match_id)
            REFERENCES \`match\` (id) ON DELETE CASCADE ON UPDATE RESTRICT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
      )
    );
};

exports.down = function (db) {
  return db
    .runSql("DROP TABLE IF EXISTS veto_session;")
    .then(() => db.removeColumn("match", "pending_veto"));
};

exports._meta = {
  version: 1,
};
