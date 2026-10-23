import { describe, expect, test } from "bun:test"
import { sqlRisk, sqlRiskKeyword, sqlStatementCount } from "./sql-guard"

describe("sql risk", () => {
  test("treats reads as safe", () => {
    expect(sqlRisk("SELECT * FROM users LIMIT 10")).toBe("safe")
    expect(sqlRisk("select count(*) from orders")).toBe("safe")
    expect(sqlRisk("  ")).toBe("safe")
  })

  test("flags writes", () => {
    expect(sqlRisk("INSERT INTO t VALUES (1)")).toBe("write")
    expect(sqlRisk("update t set a = 1")).toBe("write")
    expect(sqlRisk("CREATE TABLE t (id int)")).toBe("write")
  })

  test("flags destructive statements", () => {
    expect(sqlRisk("DELETE FROM users")).toBe("destructive")
    expect(sqlRisk("drop table users")).toBe("destructive")
    expect(sqlRisk("TRUNCATE TABLE logs")).toBe("destructive")
    expect(sqlRisk("ALTER TABLE users ADD COLUMN x int")).toBe("destructive")
  })

  test("ignores keywords inside comments and string literals", () => {
    expect(sqlRisk("SELECT '-- drop table users' AS note")).toBe("safe")
    expect(sqlRisk("SELECT 1 -- delete later")).toBe("safe")
    expect(sqlRisk("SELECT /* truncate */ 1")).toBe("safe")
  })

  test("takes the highest risk across multiple statements", () => {
    expect(sqlRisk("SELECT 1; DELETE FROM t")).toBe("destructive")
  })

  test("covers Redis and MongoDB commands", () => {
    expect(sqlRisk("GET user:1")).toBe("safe")
    expect(sqlRisk("SET user:1 alice")).toBe("write")
    expect(sqlRisk("FLUSHALL")).toBe("destructive")
    expect(sqlRisk('EVAL "return 1" 0')).toBe("destructive")
    expect(sqlRisk("db.users.find({})")).toBe("safe")
    expect(sqlRisk("db.users.insertMany([{ name: 'a' }])")).toBe("write")
    expect(sqlRisk("db.users.drop()")).toBe("destructive")
  })

  test("reports the matched keyword", () => {
    expect(sqlRiskKeyword("delete from t")).toBe("DELETE")
    expect(sqlRiskKeyword("insert into t values (1)")).toBe("INSERT")
    expect(sqlRiskKeyword("select 1")).toBeUndefined()
  })

  test("counts statements", () => {
    expect(sqlStatementCount("SELECT 1")).toBe(1)
    expect(sqlStatementCount("SELECT 1; SELECT 2;")).toBe(2)
    expect(sqlStatementCount("   ")).toBe(0)
  })
})
