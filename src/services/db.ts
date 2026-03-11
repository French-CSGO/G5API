/*Database driver.*/
import { createPool } from 'mysql2/promise';
import config from 'config';
import { FieldPacket, PoolOptions, RowDataPacket } from 'mysql2/typings/mysql';
interface IStringIndex {
  [key: string]: any;
}
const dbCfg = {
  host: config.get(process.env.NODE_ENV+".host"),
  port: config.get(process.env.NODE_ENV+".port"),
  user: config.get(process.env.NODE_ENV+".user"),
  password: config.get(process.env.NODE_ENV+".password"),
  database: config.get(process.env.NODE_ENV+".database"),
  connectionLimit: config.get(process.env.NODE_ENV+".connectionLimit")
} as PoolOptions;
const connPool = createPool(dbCfg);

class Database {
  async query(sql: string, args?: object): Promise<RowDataPacket[]> {
    try {
      let result: [RowDataPacket[], FieldPacket[]];
      result = await connPool.query<RowDataPacket[]>(sql, args);
      return result[0];
    } catch (error) {
      console.error("SQL ERROR SQL ERROR SQL ERROR SQL ERROR SQL ERROR\n" + error);
      throw error;
    }
  }

  async buildUpdateStatement(objValues: IStringIndex): Promise<IStringIndex> {
    for (let key in objValues) {
      if (objValues[key] == null || objValues[key] == undefined) delete objValues[key];
    }
    return objValues;
  }
}
let db = new Database();
export {db};
