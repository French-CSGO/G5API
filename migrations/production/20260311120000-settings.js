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
    CREATE TABLE IF NOT EXISTS settings (
      id INT PRIMARY KEY AUTO_INCREMENT,
      setting_key VARCHAR(128) NOT NULL UNIQUE,
      setting_value TEXT DEFAULT NULL,
      updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
    );
  `);
};

exports.down = function (db) {
  return db.runSql("DROP TABLE IF EXISTS settings;");
};

exports._meta = {
  version: 30,
};
