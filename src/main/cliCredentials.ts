import { execFile } from 'node:child_process'

/** One transaction for the token, registration and removal of competing CLI keys. */
export async function writeCliCredentials(dbPath: string, statements: string[]): Promise<void> {
  const sql = `BEGIN IMMEDIATE;\n${statements.join('\n')}\nCOMMIT;`
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3',
        ['-bail', dbPath],
        { timeout: 10000, windowsHide: true },
        (error) => (error ? reject(error) : resolve())
      )
      child.stdin?.on('error', () => {}) // execFile reports a missing/exited child through its callback.
      child.stdin?.end(sql)
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Older installations may have no sqlite3 executable. Keep the existing native fallback.
    const { DatabaseSync } = await import('node:sqlite').catch((error) => {
      throw new Error(
        `未找到 sqlite3，且当前运行环境不支持内置 SQLite；请安装 sqlite3。${String(error)}`
      )
    })
    const db = new DatabaseSync(dbPath)
    try {
      db.exec(sql)
    } catch (failure) {
      try {
        db.exec('ROLLBACK;')
      } catch {
        /* BEGIN may itself have failed. */
      }
      throw failure
    } finally {
      db.close()
    }
  }
}
