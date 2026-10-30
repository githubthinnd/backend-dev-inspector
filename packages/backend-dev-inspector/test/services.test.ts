import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildReport, createRecorder, getInspector, type RequestTrace, resetInspectorForTests, runInRequest, startInspector } from "sql-dev-inspector"
import { awsDriver, instrumentAws } from "../src/drivers/aws"
import { bullmqDriver, instrumentBullmq } from "../src/drivers/bullmq"
import { d1Driver, instrumentD1 } from "../src/drivers/d1"
import { elasticsearchDriver, instrumentElasticsearch } from "../src/drivers/elasticsearch"
import { instrumentNeon, neonDriver } from "../src/drivers/neon"

const load = createRequire(import.meta.url)
const uninstalls: Array<() => void> = []
const request = (url: string): RequestTrace => getInspector().store.startRequest("GET", url)
const rec = () => createRecorder(getInspector().store)

beforeEach(() => {
  startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_REDACT: "off" }, { drivers: [] })
})
afterEach(() => {
  uninstalls.splice(0).forEach(fn => fn())
  getInspector().store.clear()
  resetInspectorForTests()
})

describe("AWS SDK v3", () => {
  const { SQSClient, SendMessageCommand, ReceiveMessageCommand } = load("@aws-sdk/client-sqs") as typeof import("@aws-sdk/client-sqs")
  const { HttpResponse } = load("@smithy/core/protocols") as { HttpResponse: new (init: object) => unknown }

  /** A real client whose transport is a function: nothing leaves the process. */
  const client = (answers: Array<{ status: number, body?: string }>) => {
    let calls = 0
    const handler = {
      handle: async () => {
        const answer = answers[Math.min(calls++, answers.length - 1)]!
        return { response: new HttpResponse({ statusCode: answer.status, headers: { "x-amzn-requestid": `req-${calls}`, "content-type": "application/x-amz-json-1.0" }, body: Buffer.from(answer.body ?? "{}") }) }
      },
      destroy() {},
      updateHttpClientConfig() {},
      httpHandlerConfigs: () => ({})
    }
    return new SQSClient({ region: "us-east-1", credentials: { accessKeyId: "a", secretAccessKey: "b" }, requestHandler: handler as never, maxAttempts: 3, retryStrategy: undefined })
  }

  it("lists each command with the resource it names, its status and its request id, and never the message body", async () => {
    uninstalls.push(awsDriver.install(rec())!)
    const sqs = instrumentAws(client([{ status: 200, body: JSON.stringify({ MessageId: "m1", MD5OfMessageBody: createHash("md5").update("SECRET-BODY").digest("hex") }) }]))
    const trace = request("/queue")
    await runInRequest(trace, async () => {
      await sqs.send(new SendMessageCommand({ QueueUrl: "https://sqs.us-east-1.amazonaws.com/1/jobs", MessageBody: "SECRET-BODY" }))
    })
    const [call] = trace.queries
    expect(call).toMatchObject({ driver: "aws", api: "SendMessage", sql: "SQS SendMessage QueueUrl='https://sqs.us-east-1.amazonaws.com/1/jobs'" })
    expect(call!.analysis).toMatchObject({ kind: "insert", label: "SQS SENDMESSAGE" })
    expect(call!.details).toMatchObject({ status: 200 })
    expect(call!.details!.requestId).toBeTruthy()
    expect(JSON.stringify(trace)).not.toContain("SECRET-BODY")
  })

  it("lists a command once however many times the SDK retried it, and says how many attempts it took", async () => {
    uninstalls.push(awsDriver.install(rec())!)
    const sqs = instrumentAws(client([{ status: 500, body: "{\"__type\":\"ServiceUnavailable\"}" }, { status: 200 }]))
    const trace = request("/retry")
    await runInRequest(trace, async () => {
      await sqs.send(new ReceiveMessageCommand({ QueueUrl: "q" }))
    })
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]!.error).toBeNull()
    expect(trace.queries[0]!.details).toMatchObject({ status: 200, attempts: 2 })
  })

  it("records a failing command with its error, and is an N+1 in a loop", async () => {
    uninstalls.push(awsDriver.install(rec())!)
    const sqs = instrumentAws(client([{ status: 400, body: "{\"__type\":\"com.amazon.sqs#QueueDoesNotExist\",\"message\":\"gone\"}" }]))
    const trace = request("/fail")
    await runInRequest(trace, async () => {
      for (const queue of ["https://sqs.us-east-1.amazonaws.com/1/a", "https://sqs.us-east-1.amazonaws.com/1/b", "https://sqs.us-east-1.amazonaws.com/1/c"]) {
        await sqs.send(new ReceiveMessageCommand({ QueueUrl: queue })).catch(() => undefined)
      }
    })
    expect(trace.queries[0]!.error).toMatch(/QueueDoesNotExist|gone/)
    expect(buildReport(trace).insights.map(i => i.type)).toContain("n-plus-one")
  })

  it("does nothing to a client when the inspector is off, and twice is harmless", () => {
    const plain = client([{ status: 200 }])
    expect(instrumentAws(plain)).toBe(plain)
    uninstalls.push(awsDriver.install(rec())!)
    expect(() => instrumentAws(instrumentAws(plain))).not.toThrow()
  })
})

describe("Elasticsearch", () => {
  const { Client } = load("@elastic/elasticsearch") as typeof import("@elastic/elasticsearch")
  const { BaseConnection } = load("@elastic/transport") as typeof import("@elastic/transport")

  const connection = (status: number, body: object) => class extends BaseConnection {
    async request(params: { method: string }) {
      void params
      const text = JSON.stringify(body)
      return { statusCode: status, headers: { "content-type": "application/json", "x-elastic-product": "Elasticsearch" }, body: Buffer.from(text) } as never
    }
  }

  it("lists a search as its method and path, with the query as a hidden parameter", async () => {
    uninstalls.push(elasticsearchDriver.install(rec())!)
    const es = instrumentElasticsearch(new Client({ node: "http://es.test:9200", Connection: connection(200, { hits: { hits: [{}, {}, {}] } }) as never }))
    const trace = request("/search")
    await runInRequest(trace, async () => {
      await es.search({ index: "orders", query: { match: { status: "paid" } } })
    })
    const [call] = trace.queries
    expect(call).toMatchObject({ driver: "elasticsearch", sql: expect.stringMatching(/^POST \/orders\/_search/), rowCount: 3 })
    expect(call!.analysis.kind).toBe("select")
    expect(call!.params).toEqual([JSON.stringify({ query: { match: { status: "paid" } } })])
    expect(call!.details).toMatchObject({ status: 200 })
  })

  it("records an error answer, and a document write as an insert", async () => {
    uninstalls.push(elasticsearchDriver.install(rec())!)
    const bad = instrumentElasticsearch(new Client({ node: "http://es.test:9200", Connection: connection(503, { error: "down" }) as never, maxRetries: 0 }))
    const trace = request("/es-fail")
    await runInRequest(trace, async () => {
      await bad.index({ index: "orders", document: { a: 1 } }).catch(() => undefined)
    })
    expect(trace.queries[0]!.analysis.kind).toBe("insert")
    expect(trace.queries[0]!.error).toBeTruthy()
  })
})

describe("Neon over HTTP", () => {
  const { neon, neonConfig } = load("@neondatabase/serverless") as typeof import("@neondatabase/serverless")

  /** Neon takes its transport from `neonConfig`: nothing leaves the process. */
  const sql = (rows: unknown[], fail = false) => {
    neonConfig.fetchFunction = async () => fail
      ? new Response(JSON.stringify({ message: "relation does not exist", code: "42P01" }), { status: 400, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({
        fields: Object.keys((rows[0] ?? {}) as object).map(name => ({ name, dataTypeID: 23 })),
        rows: rows.map(row => Object.values(row as object)),
        command: "SELECT",
        rowCount: rows.length,
        rowAsArray: true
      }), { status: 200, headers: { "content-type": "application/json" } })
    return neon("postgres://u:p@ep-test.neon.tech/db")
  }

  it("records a tagged query when it is awaited, with its parameters", async () => {
    uninstalls.push(neonDriver.install(rec())!)
    const db = instrumentNeon(sql([{ id: 1 }, { id: 2 }]))
    const trace = request("/neon")
    const rows = await runInRequest(trace, async () => await db`select * from users where id = ${7}`)
    expect(rows).toHaveLength(2)
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]).toMatchObject({ driver: "neon", sql: "select * from users where id = $1", params: [7], rowCount: 2 })
  })

  it("records a query that is used with .catch() or .finally() instead of await", async () => {
    uninstalls.push(neonDriver.install(rec())!)
    const ok = instrumentNeon(sql([{ n: 1 }]))
    const trace = request("/neon-catch")
    const seen: string[] = []
    await runInRequest(trace, async () => {
      await ok`select 1`.catch(() => seen.push("caught"))
      await ok`select 2`.finally(() => seen.push("finally"))
    })
    expect(seen).toEqual(["finally"])
    expect(trace.queries.map(q => q.sql)).toEqual(["select 1", "select 2"])
    const bad = instrumentNeon(sql([], true))
    const failing = request("/neon-catch-fail")
    await runInRequest(failing, async () => {
      await bad`select * from nope`.catch(() => seen.push("caught"))
    })
    expect(seen).toEqual(["finally", "caught"])
    expect(failing.queries[0]!.error).toMatch(/does not exist/)
  })

  it("records sql.query(), a failure, and nothing for a query that is never awaited", async () => {
    uninstalls.push(neonDriver.install(rec())!)
    const ok = instrumentNeon(sql([{ n: 1 }]))
    const trace = request("/neon2")
    await runInRequest(trace, async () => {
      await ok.query("select $1::int as n", [1])
      void ok`select 1`
    })
    expect(trace.queries.map(q => q.sql)).toEqual(["select $1::int as n"])
    const bad = instrumentNeon(sql([], true))
    const failing = request("/neon3")
    await runInRequest(failing, async () => {
      await expect(bad`select * from nope`).rejects.toThrow()
    })
    expect(failing.queries[0]!.error).toMatch(/does not exist/)
  })
})

describe("Cloudflare D1", () => {
  /** The documented shape of a D1 binding: prepare → bind → first / all / run / raw, batch, exec. */
  function fakeD1(rows: unknown[] = [{ id: 1 }, { id: 2 }]) {
    const statement = (sql: string, params: unknown[] = []) => ({
      sql,
      params,
      bind: (...values: unknown[]) => statement(sql, values),
      first: async () => rows[0] ?? null,
      all: async () => ({ results: rows, success: true, meta: { changes: 0 } }),
      run: async () => ({ results: [], success: true, meta: { changes: 3 } }),
      raw: async () => rows.map(row => Object.values(row as object))
    })
    return {
      prepare: (sql: string) => statement(sql),
      batch: async (statements: Array<{ all: () => Promise<unknown> }>) => await Promise.all(statements.map(item => item.all())),
      exec: async (sql: string) => ({ count: sql.split(";").length, duration: 1 })
    }
  }

  it("records first / all / run with the bound values, the rows and the changes", async () => {
    uninstalls.push(d1Driver.install(rec())!)
    const db = instrumentD1(fakeD1())
    const trace = request("/d1")
    await runInRequest(trace, async () => {
      expect(await db.prepare("select * from users where id = ?").bind(7).first()).toEqual({ id: 1 })
      await db.prepare("select * from users").all()
      await db.prepare("update users set a = ?").bind(1).run()
    })
    expect(trace.queries.map(q => [q.driver, q.sql, q.params, q.rowCount, q.affectedRows, q.analysis.kind])).toEqual([
      ["d1", "select * from users where id = ?", [7], 1, null, "select"],
      ["d1", "select * from users", null, 2, null, "select"],
      ["d1", "update users set a = ?", [1], null, 3, "update"]
    ])
  })

  it("lists every statement of a batch, and an exec once", async () => {
    uninstalls.push(d1Driver.install(rec())!)
    const db = instrumentD1(fakeD1())
    const trace = request("/d1-batch")
    await runInRequest(trace, async () => {
      await db.batch([db.prepare("select 1").bind(), db.prepare("select ? ").bind(2)])
      await db.exec("create table t (a int)")
    })
    expect(trace.queries.map(q => q.sql)).toEqual(["select 1", "select ? ", "create table t (a int)"])
    expect(trace.queries.every(q => q.durationMs !== null)).toBe(true)
  })
})

describe("BullMQ", () => {
  /** The documented shape of a queue: `name`, `add(name, data, opts)`, `addBulk(jobs)`. Its Redis commands are made from inside. */
  function fakeQueue(onRedis?: () => void) {
    return {
      name: "emails",
      add: async (name: string, data: unknown) => {
        onRedis?.()
        return { id: "1", name, data }
      },
      addBulk: async (jobs: Array<{ name: string }>) => jobs.map((job, index) => ({ id: String(index), name: job.name })),
      getJobCounts: async () => ({ waiting: 1 })
    }
  }

  it("lists add and addBulk with the queue and the job names, and hides the job data", async () => {
    uninstalls.push(bullmqDriver.install(rec())!)
    const queue = instrumentBullmq(fakeQueue())
    const trace = request("/jobs")
    await runInRequest(trace, async () => {
      await queue.add("welcome", { userId: "SECRET" })
      await queue.addBulk([{ name: "a" }, { name: "b" }])
      expect(await queue.getJobCounts()).toEqual({ waiting: 1 })
    })
    expect(trace.queries.map(q => [q.driver, q.sql, q.analysis.kind, q.rowCount])).toEqual([
      ["bullmq", "BULLMQ emails add 'welcome'", "insert", 1],
      ["bullmq", "BULLMQ emails addBulk 'a', 'b'", "insert", 2]
    ])
    expect(trace.queries[0]!.params).toEqual([{ userId: "SECRET" }])
  })

  it("keeps the Redis commands made to add the job under it, not as calls of their own", async () => {
    uninstalls.push(bullmqDriver.install(rec())!)
    const recorder = rec()
    const queue = instrumentBullmq(fakeQueue(() => {
      recorder.begin({ driver: "ioredis", api: "evalsha", text: "EVALSHA ? 1 bull:emails:id", connectionId: 9, analysis: { kind: "other" } as never })?.end()
    }))
    const trace = request("/jobs2")
    await runInRequest(trace, () => queue.add("welcome", {}))
    expect(trace.queries).toHaveLength(1)
    expect(trace.queries[0]!.statements?.map(s => s.sql)).toEqual(["EVALSHA ? 1 bull:emails:id"])
  })
})

describe("wrapping before the inspector starts", () => {
  /** The usual layout: the client is wrapped at the top of a module, the application starts the inspector later. */
  it("every wrapper reports to the recorder that exists when the call is made", async () => {
    resetInspectorForTests()
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = "development" // what a dev server runs under; the test runner's own value switches the inspector off
    const queue = instrumentBullmq({ name: "emails", add: async (name: string) => ({ name }) })
    const db = instrumentD1({ prepare: (sql: string) => ({ bind: () => ({ first: async () => ({ sql }) }), first: async () => ({ sql }) }) })
    const wrapped = [queue, db]
    expect(wrapped.every(w => w !== undefined)).toBe(true)
    // only now is the inspector started and a driver installed
    startInspector({ NODE_ENV: "development", SQL_INSPECTOR_LOG: "0", SQL_INSPECTOR_NOTICE: "0", SQL_INSPECTOR_REDACT: "off" }, { drivers: [] })
    uninstalls.push(bullmqDriver.install(rec())!, d1Driver.install(rec())!)
    const trace = request("/late")
    await runInRequest(trace, async () => {
      await queue.add("welcome")
      await db.prepare("select 1").first()
    })
    process.env.NODE_ENV = previous
    expect(trace.queries.map(q => q.driver)).toEqual(["bullmq", "d1"])
  })

  it("leaves a client untouched when the inspector is off for this process", () => {
    resetInspectorForTests()
    const original = { name: "q", add: async () => 1 }
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
      expect(instrumentBullmq(original)).toBe(original)
      expect(instrumentD1(original)).toBe(original)
    } finally {
      process.env.NODE_ENV = previous
    }
  })
})

describe("BullMQ with a queue whose methods are not promises", () => {
  it("is still one call, and does not turn the application's call into a TypeError", async () => {
    uninstalls.push(bullmqDriver.install(rec())!)
    const queue = instrumentBullmq({ name: "plain", add: (name: string) => ({ name }) as unknown as Promise<unknown> })
    const trace = request("/plain")
    const job = await runInRequest(trace, async () => await queue.add("x"))
    expect(job).toEqual({ name: "x" })
    expect(trace.queries.map(q => [q.sql, q.error])).toEqual([["BULLMQ plain add 'x'", null]])
  })
})

describe("recorders shared between copies of the package", () => {
  it("are kept under one key, so a second copy sees the recorder the first installed", async () => {
    const { wrapperDriver } = await import("../src/drivers/wrapper")
    const first = wrapperDriver("shared-test")
    const second = wrapperDriver("shared-test")
    const release = first.driver.install(rec(), { explicit: false })!
    const trace = request("/shared")
    runInRequest(trace, () => {
      second.recorder()!.begin({ driver: "x", api: "q", text: "select 1", connectionId: 1, analysis: { kind: "select", tables: [], subqueryDepth: 0, subqueryCount: 0, fingerprint: "select ?", selectStar: false, savepoint: null } })?.end()
    })
    expect(trace.queries.map(q => q.sql)).toEqual(["select 1"])
    release()
    // once the first copy's install is released nothing is left, and (the test runner is not a dev server) the inspector is off
    expect(second.recorder()).toBeNull()
  })
})

describe("what is a read", () => {
  it("counts multi-reads of Elasticsearch and DynamoDB as reads, so a loop of them is an N+1", async () => {
    const { kindOfVerb } = await import("../src/drivers/verbs")
    for (const name of ["mget", "msearch", "mtermvectors", "TransactGetItems", "GetObject", "BatchGetItem", "Scan", "ListObjectsV2"]) {
      expect(kindOfVerb(name), name).toBe("select")
    }
    expect(kindOfVerb("PutItem")).toBe("update")
    expect(kindOfVerb("SendMessage")).toBe("insert")
    expect(kindOfVerb("DeleteObject")).toBe("delete")
  })
})

describe("wrapped objects with accessors", () => {
  it("are read with the object itself as `this`, as a platform object requires", () => {
    class Native {
      #secret = "inside"
      get secret() {
        return this.#secret // throws on any receiver that is not a real Native
      }

      prepare() {
        return { first: async () => this.#secret }
      }
    }
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = "development" // the inspector is off under the test runner's own value, and a wrapper then returns the object untouched
    try {
      const raw = new Native()
      const db = instrumentD1(raw as never) as unknown as Native
      expect(db).not.toBe(raw)
      expect(db.secret).toBe("inside")
      const queue = instrumentBullmq(new Native() as never) as unknown as Native
      expect(queue.secret).toBe("inside")
    } finally {
      process.env.NODE_ENV = previous
    }
  })
})
