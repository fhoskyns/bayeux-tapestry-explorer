import assert from "node:assert/strict";
import test from "node:test";
import { handleRequest, parsePublicPath } from "../worker/src/index.js";

const uploaded = new Date("2026-01-02T03:04:05.000Z");

function makeObject(body, etag = '"test-etag"') {
  const bytes = new TextEncoder().encode(body);
  return { body: bytes, size: bytes.byteLength, httpEtag: etag, uploaded };
}

class FakeBucket {
  constructor(objects = new Map()) {
    this.objects = objects;
    this.getCalls = [];
    this.headCalls = [];
  }

  async get(key) {
    this.getCalls.push(key);
    return this.objects.get(key) ?? null;
  }

  async head(key) {
    this.headCalls.push(key);
    const object = this.objects.get(key);
    if (!object) return null;
    const { body: _body, ...metadata } = object;
    return metadata;
  }
}

class FakeCache {
  constructor() {
    this.responses = new Map();
  }

  key(request) {
    return `${request.method}:${request.url}`;
  }

  async match(request) {
    const response = this.responses.get(this.key(request));
    return response?.clone() ?? null;
  }

  async put(request, response) {
    this.responses.set(this.key(request), response.clone());
  }
}

function context() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(promise);
    },
  };
}

function environment(bucket) {
  return { TAPESTRY_DERIVATIVES: bucket };
}

test("path parser exposes only canonical v1 DZI derivatives", () => {
  assert.deepEqual(parsePublicPath("/v1/bayeux-tapestry/bayeux-tapestry.dzi"), {
    kind: "descriptor",
    key: "v1/bayeux-tapestry/bayeux-tapestry.dzi",
    contentType: "application/xml; charset=utf-8",
  });
  assert.deepEqual(parsePublicPath("/v1/bayeux-tapestry/bayeux-tapestry_files/18/12_0.webp"), {
    kind: "tile",
    key: "v1/bayeux-tapestry/bayeux-tapestry_files/18/12_0.webp",
    contentType: "image/webp",
  });
  for (const rejected of [
    "/v1/bayeux-tapestry/master.tif",
    "/private/master.tif",
    "/v1/bayeux-tapestry/other.dzi",
    "/v1/bayeux-tapestry/bayeux-tapestry_files/01/0_0.webp",
    "/v1/bayeux-tapestry/bayeux-tapestry_files/1/../master.webp",
    "/v1/bayeux-tapestry/bayeux-tapestry_files/1/%2e%2e_master.webp",
    "/v2/bayeux-tapestry/bayeux-tapestry.dzi",
  ]) {
    assert.equal(parsePublicPath(rejected), null, rejected);
  }
});

test("GET serves and caches a tile with forced public headers", async () => {
  const key = "v1/bayeux-tapestry/bayeux-tapestry_files/12/2_0.webp";
  const bucket = new FakeBucket(new Map([[key, makeObject("lossless-webp")]]));
  const cache = new FakeCache();
  const execution = context();
  const url = `https://tiles.example.org/${key}`;

  const first = await handleRequest(new Request(url), environment(bucket), execution, cache);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "image/webp");
  assert.equal(first.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(first.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.equal(first.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(first.headers.get("Cache-Control"), /immutable/);
  assert.equal(first.headers.get("ETag"), '"test-etag"');
  assert.equal(await first.text(), "lossless-webp");
  await Promise.all(execution.pending);

  const second = await handleRequest(new Request(url), environment(bucket), context(), cache);
  assert.equal(await second.text(), "lossless-webp");
  assert.equal(bucket.getCalls.length, 1, "second GET should be served from cache");
});

test("descriptor MIME is forced and HEAD has no body", async () => {
  const key = "v1/bayeux-tapestry/bayeux-tapestry.dzi";
  const bucket = new FakeBucket(new Map([[key, makeObject("<Image />")]]));
  const response = await handleRequest(
    new Request(`https://tiles.example.org/${key}`, { method: "HEAD" }),
    environment(bucket),
    context(),
    new FakeCache(),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "application/xml; charset=utf-8");
  assert.equal(response.headers.get("Content-Length"), "9");
  assert.equal(await response.text(), "");
  assert.deepEqual(bucket.headCalls, [key]);
  assert.equal(bucket.getCalls.length, 0);
});

test("If-None-Match returns 304 without a body", async () => {
  const key = "v1/bayeux-tapestry/bayeux-tapestry.dzi";
  const bucket = new FakeBucket(new Map([[key, makeObject("<Image />")]]));
  const response = await handleRequest(
    new Request(`https://tiles.example.org/${key}`, {
      headers: { "If-None-Match": 'W/"test-etag"' },
    }),
    environment(bucket),
    context(),
    new FakeCache(),
  );
  assert.equal(response.status, 304);
  assert.equal(response.headers.get("Content-Length"), null);
  assert.equal(await response.text(), "");
});

test("unsupported methods, queries, private paths, and missing keys stay closed", async () => {
  const bucket = new FakeBucket();
  const env = environment(bucket);
  const cache = new FakeCache();
  const cases = [
    [new Request("https://tiles.example.org/v1/a/a.dzi", { method: "POST" }), 405],
    [new Request("https://tiles.example.org/v1/a/a.dzi?download=1"), 404],
    [new Request("https://tiles.example.org/v1/a/master.tif"), 404],
    [new Request("https://tiles.example.org/v1/a/a.dzi"), 404],
  ];
  for (const [request, status] of cases) {
    const response = await handleRequest(request, env, context(), cache);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    if (status === 405) assert.equal(response.headers.get("Allow"), "GET, HEAD");
  }
  assert.equal(bucket.getCalls.length, 0, "invented asset names must never reach R2");
});

test("R2 errors become non-disclosing 500 responses", async () => {
  const bucket = new FakeBucket();
  bucket.get = async () => {
    throw new Error("internal bucket detail");
  };
  const response = await handleRequest(
    new Request("https://tiles.example.org/v1/bayeux-tapestry/bayeux-tapestry.dzi"),
    environment(bucket),
    context(),
    new FakeCache(),
  );
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /bucket detail/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(response.headers.get("X-Request-Id"));
});

test("all 3899 verified pyramid tiles remain accessible, with no extra rows or columns", () => {
  let count = 0;
  for (let level = 0; level <= 19; level++) {
    const scale = 2 ** (19 - level);
    const columns = Math.ceil(Math.ceil(482096 / scale) / 1024);
    const rows = Math.ceil(Math.ceil(5550 / scale) / 1024);
    const tile = (column, row) => `/v1/bayeux-tapestry/bayeux-tapestry_files/${level}/${column}_${row}.webp`;
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) {
        assert.equal(parsePublicPath(tile(column, row))?.kind, "tile");
        count++;
      }
    }
    assert.equal(parsePublicPath(tile(columns, 0)), null);
    assert.equal(parsePublicPath(tile(0, rows)), null);
  }
  assert.equal(count, 3899);
});

test("out-of-bounds requests do not read R2 or pollute the edge cache", async () => {
  const bucket = new FakeBucket();
  const cache = new FakeCache();
  const prefix = "https://tiles.example.org/v1/bayeux-tapestry/bayeux-tapestry_files/";
  for (const suffix of ["20/0_0.webp", "99/0_0.webp", "19/471_0.webp", "19/0_6.webp", "0/1_0.webp", "19/9007199254740993_0.webp", "19/-1_0.webp", "19/01_0.webp"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await handleRequest(new Request(prefix + suffix, { method }), environment(bucket), context(), cache);
      assert.equal(response.status, 404, suffix);
    }
  }
  assert.equal(bucket.getCalls.length + bucket.headCalls.length, 0);
  assert.equal(cache.responses.size, 0);
});

test("missing valid GETs are briefly cached without poisoning HEAD or successful responses", async () => {
  const key = "v1/bayeux-tapestry/bayeux-tapestry.dzi";
  const url = `https://tiles.example.org/${key}`;
  const bucket = new FakeBucket();
  const cache = new FakeCache();
  const execution = context();
  const head = await handleRequest(new Request(url, { method: "HEAD" }), environment(bucket), execution, cache);
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");
  assert.equal(cache.responses.size, 0);
  const first = await handleRequest(new Request(url), environment(bucket), execution, cache);
  assert.equal(first.status, 404);
  assert.equal(first.headers.get("Cache-Control"), "public, max-age=30, s-maxage=30");
  await Promise.all(execution.pending);
  const second = await handleRequest(new Request(url), environment(bucket), context(), cache);
  assert.equal(second.status, 404);
  assert.match(await second.text(), /not_found/);
  assert.equal(bucket.getCalls.length, 1);
  // Simulate cache expiration after an upload/recovery.
  cache.responses.clear();
  bucket.objects.set(key, makeObject("<Image />"));
  const recovered = await handleRequest(new Request(url), environment(bucket), context(), cache);
  assert.equal(recovered.status, 200);
  assert.match(recovered.headers.get("Cache-Control"), /immutable/);
});
