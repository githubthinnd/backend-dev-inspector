import { describe, expect, it } from "vitest"
import { analyzeSql, fingerprintOf, formatSql, maskLiterals } from "../src/sql-analyzer"

describe("analyzeSql", () => {
  it.each([
    ["select `id` from `users` where `id` = 1", "select"],
    ["  (select 1) union (select 2)", "select"],
    ["with t as (select 1) select * from t", "select"],
    ["insert into `users` (`id`) values (1)", "insert"],
    ["update `users` set `name` = 'x'", "update"],
    ["delete from `users` where id = 1", "delete"],
    ["begin", "tx-begin"],
    ["START TRANSACTION", "tx-begin"],
    ["commit", "tx-commit"],
    ["rollback", "tx-rollback"],
    ["savepoint sp1", "savepoint"],
    ["release savepoint sp1", "savepoint-release"],
    ["rollback to savepoint sp1", "savepoint-rollback"],
    ["set transaction isolation level read committed", "tx-config"],
    ["show tables", "other"]
  ])("classifies %s as %s", (sql, kind) => {
    expect(analyzeSql(sql).kind).toBe(kind)
  })

  it("reads the savepoint name", () => {
    expect(analyzeSql("savepoint sp3").savepoint).toBe("sp3")
    expect(analyzeSql("release savepoint sp3").savepoint).toBe("sp3")
    expect(analyzeSql("rollback to savepoint sp3").savepoint).toBe("sp3")
    expect(analyzeSql("select 1").savepoint).toBeNull()
  })

  it("finds tables across joins, writes and schemas, but not keywords or literals", () => {
    expect(analyzeSql("select * from `a` left join `b` on a.id = b.a_id inner join c on c.id = b.c_id").tables).toEqual(["a", "b", "c"])
    expect(analyzeSql("insert into `db`.`users` (`id`) values (1)").tables).toEqual(["db.users"])
    expect(analyzeSql("update users set a = 1 where id = 1").tables).toEqual(["users"])
    expect(analyzeSql("select 'from fake_table' as x from real").tables).toEqual(["real"])
    expect(analyzeSql("select * from t where id = 1 for update").tables).toEqual(["t"])
    expect(analyzeSql("insert into t (a) values (1) on duplicate key update a = 2").tables).toEqual(["t"])
  })

  it("measures subquery nesting, not plain parentheses", () => {
    expect(analyzeSql("select count(*) from t where id in (1, 2, 3)")).toMatchObject({ subqueryDepth: 0, subqueryCount: 0 })
    expect(analyzeSql("select * from t where id in (select id from u)")).toMatchObject({ subqueryDepth: 1, subqueryCount: 1 })
    expect(analyzeSql("select (select max(x) from (select x from y) z) from t")).toMatchObject({ subqueryDepth: 2, subqueryCount: 2 })
    expect(analyzeSql("select * from t where a in (select a from u where b in (select b from v where c in (select c from w)))")).toMatchObject({ subqueryDepth: 3, subqueryCount: 3 })
    expect(analyzeSql("select * from t where a in (select a from u) and b in (select b from v)")).toMatchObject({ subqueryDepth: 1, subqueryCount: 2 })
  })

  it("ignores parens and keywords inside string literals", () => {
    expect(analyzeSql("select * from t where name = '(select 1)' and x = 'it''s (select'").subqueryDepth).toBe(0)
  })

  it("detects select *", () => {
    expect(analyzeSql("select * from t").selectStar).toBe(true)
    expect(analyzeSql("select t.* from t").selectStar).toBe(true)
    expect(analyzeSql("select count(*) from t").selectStar).toBe(false)
    expect(analyzeSql("select `id` from t").selectStar).toBe(false)
  })

  it("never throws on junk", () => {
    expect(() => analyzeSql("")).not.toThrow()
    expect(() => analyzeSql("))) ((( 'unterminated")).not.toThrow()
  })
})

describe("fingerprint", () => {
  it("is the same for calls that differ only in values", () => {
    expect(fingerprintOf("select * from t where id = 1 and name = 'a'")).toBe(fingerprintOf("select * from t where id = 22 and name = 'b c'"))
    expect(fingerprintOf("select * from t where id in (1, 2, 3)")).toBe(fingerprintOf("select * from t where id in (9)"))
    expect(fingerprintOf("insert into t (a, b) values (1, 'x'), (2, 'y')")).toBe(fingerprintOf("insert into t (a, b) values (3, 'z')"))
  })

  it("differs for a different shape", () => {
    expect(fingerprintOf("select a from t")).not.toBe(fingerprintOf("select b from t"))
    expect(fingerprintOf("select * from t where id = 1")).not.toBe(fingerprintOf("select * from t where id > 1"))
  })

  it("masks literals and comments only", () => {
    expect(maskLiterals("select 'a', \"b\", `c` /* x */ from t -- tail")).toBe("select ?, ?, `c`   from t  ")
  })
})

describe("formatSql", () => {
  it("indents each subquery one level deeper and breaks at clauses", () => {
    const out = formatSql("select a, (select max(b) from u where u.a = t.a) as m from t left join v on v.a = t.a where t.x = 1 and t.y = 2 order by a limit 5")
    expect(out.split("\n")).toEqual([
      "select a, (",
      "  select max(b)",
      "  from u",
      "  where u.a = t.a",
      ") as m",
      "from t",
      "left join v on v.a = t.a",
      "where t.x = 1",
      "  and t.y = 2",
      "order by a",
      "limit 5"
    ])
  })

  it("keeps string literals intact", () => {
    expect(formatSql("select 'a  from  b' from t")).toBe("select 'a  from  b'\nfrom t")
  })
})
