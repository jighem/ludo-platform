import mysql, { type PoolConnection, type RowDataPacket } from "mysql2/promise";
export function createDatabase(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "mysql:")
    throw new Error("MySQL connection required");
  return mysql.createPool({
    socketPath: process.env.MYSQL_SOCKET_PATH,
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
    connectionLimit: 10,
    timezone: "+00:00",
    dateStrings: true,
    multipleStatements: false,
  });
}
export type Database = ReturnType<typeof createDatabase>;
export async function transaction<T>(
  db: Database,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await db.getConnection();
  try {
    // Each statement sees committed rows after waiting on an aggregate lock.
    // Critical decisions still use explicit row locks.
    await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
export async function rows<T extends RowDataPacket>(
  db: Pick<Database, "query">,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const [result] = await db.query<T[]>(sql, params);
  return result;
}
