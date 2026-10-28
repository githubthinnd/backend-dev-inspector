import { describe, expect, it } from "vitest"
import { analyzeSql, fingerprintOf, formatSql, maskLiterals } from "../src/sql-analyzer"

describe("PostgreSQL", () => {
  const pg = (sql: string) => analyzeSql(sql, "postgres")

  it("keeps double-quoted names as identifiers, not strings", () => {
    expect(maskLiterals(`select "id" from "users" where name = 'bob'`, "postgres")).toBe(`select "id" from "users" where name = ?`)
    expect(pg(`select "u"."id" from "public"."users" "u" join "orders" on "orders"."user_id" = "u"."id"`).tables).toEqual(["public.users", "orders"])
  })

  it("masks E'' strings, doubled quotes and dollar-quoted bodies", () => {
    expect(maskLiterals(`select E'it\\'s', 'it''s', $$a ' b$$, $tag$ x $tag$`, "postgres")).toBe("select ?, ?, ?, ?")
  })

  it("treats $1 as a placeholder, so the same call with different values shares a fingerprint", () => {
    expect(fingerprintOf(`select * from users where id = $1 and age > $2`, "postgres")).toBe(fingerprintOf(`select * from users where id = $7 and age > $8`, "postgres"))
    expect(fingerprintOf(`select * from users where id = $1`, "postgres")).toBe("select * from users where id = ?")
  })

  it("does not read -- inside a string as a comment, and # is not a comment", () => {
    expect(maskLiterals(`select 'a -- b', 1 # 2`, "postgres")).toBe("select ?, 1 # 2")
  })

  it.each([
    ["begin", "tx-begin"],
    ["BEGIN ISOLATION LEVEL SERIALIZABLE", "tx-begin"],
    ["start transaction", "tx-begin"],
    ["commit", "tx-commit"],
    ["END", "tx-commit"],
    ["end transaction", "tx-commit"],
    ["rollback", "tx-rollback"],
    ["ABORT", "tx-rollback"],
    ["savepoint sp1", "savepoint"],
    ["release sp1", "savepoint-release"],
    ["release savepoint sp1", "savepoint-release"],
    ["rollback to savepoint sp1", "savepoint-rollback"],
    ["rollback to sp1", "savepoint-rollback"],
    ["set transaction isolation level read committed", "tx-config"],
    ["insert into t (a) values ($1) returning id", "insert"],
    ["with moved as (delete from a returning *) insert into b select * from moved", "insert"],
    ["with t as (select 1) select * from t", "select"],
    ["with recursive r as (select 1 union all select n + 1 from r) update t set a = 1", "update"],
    ["copy t from stdin", "other"],
    ["explain select 1", "other"]
  ])("classifies %s as %s", (sql, kind) => {
    expect(pg(sql).kind).toBe(kind)
  })

  it("reads savepoint names", () => {
    expect(pg("savepoint Sp1").savepoint).toBe("sp1")
    expect(pg(`release savepoint "Sp1"`).savepoint).toBe("sp1")
    expect(pg("rollback to savepoint sp1;").savepoint).toBe("sp1")
  })

  it("finds the tables of writes, ON CONFLICT and ONLY", () => {
    expect(pg("insert into audit.log (a) values ($1) on conflict (a) do update set a = excluded.a").tables).toEqual(["audit.log"])
    expect(pg(`delete from only "t" where id = $1`).tables).toEqual(["t"])
    expect(pg("select * from t for update").tables).toEqual(["t"])
    expect(pg("select * from t for no key update").tables).toEqual(["t"])
  })

  it("measures subqueries and finds select *", () => {
    const a = pg(`select * from "a" where id in (select id from "b" where x in (select x from "c"))`)
    expect(a).toMatchObject({ subqueryDepth: 2, subqueryCount: 2, selectStar: true })
  })

  it("formats with the dialect's own quoting", () => {
    expect(formatSql(`select "a", 'x from y' from "t" where "b" = $1 returning "a"`, "postgres").split("\n")).toEqual([
      `select "a", 'x from y'`,
      `from "t"`,
      `where "b" = $1`,
      `returning "a"`
    ])
  })
})

describe("SQLite", () => {
  const lite = (sql: string) => analyzeSql(sql, "sqlite")

  it("reads backtick, double-quote and [bracket] identifiers", () => {
    expect(lite("select 1 from `a` join \"b\" on 1 join [c d] on 1").tables).toEqual(["a", "b", "c d"])
  })

  it("normalises ?, ?NNN, :name, @name and $name placeholders", () => {
    const shape = "select * from t where a = ? and b = ?2 and c = :c and d = @d and e = $e"
    expect(fingerprintOf(shape, "sqlite")).toBe("select * from t where a = ? and b = ? and c = ? and d = ? and e = ?")
  })

  it.each([
    ["BEGIN IMMEDIATE", "tx-begin"],
    ["begin deferred transaction", "tx-begin"],
    ["END TRANSACTION", "tx-commit"],
    ["commit", "tx-commit"],
    ["rollback transaction to savepoint a", "savepoint-rollback"],
    ["release a", "savepoint-release"],
    ["pragma foreign_keys = on", "other"],
    ["replace into t values (1)", "replace"]
  ])("classifies %s as %s", (sql, kind) => {
    expect(lite(sql).kind).toBe(kind)
  })

  it("does not treat # or double quotes as strings", () => {
    expect(maskLiterals(`select "a" from t where b = 'x' # y`, "sqlite")).toBe(`select "a" from t where b = ? # y`)
  })
})

describe("MySQL stays as it was", () => {
  it("masks double-quoted strings, keeps backtick identifiers, reads # comments", () => {
    expect(maskLiterals("select `a` from t where b = \"x\" # tail", "mysql")).toBe("select `a` from t where b = ?  ")
  })

  it("is the default dialect", () => {
    expect(analyzeSql("select 1")).toEqual(analyzeSql("select 1", "mysql"))
  })

  it("sees through a CTE to the statement it feeds", () => {
    expect(analyzeSql("with c as (select 1) delete from t").kind).toBe("delete")
    expect(analyzeSql("with c as (select 1) select * from c").kind).toBe("select")
  })

  it("still requires SAVEPOINT after RELEASE, and does not mistake release_lock for it", () => {
    expect(analyzeSql("release savepoint a").kind).toBe("savepoint-release")
    expect(analyzeSql("select release_lock('x')").kind).toBe("select")
  })
})
