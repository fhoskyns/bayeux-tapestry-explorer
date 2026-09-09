const PUBLIC_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
});

const IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, s-maxage=31536000, immutable";
// This immutable version contains exactly one verified image. Reject invented
// asset names and tile coordinates before touching either the cache or R2.
const DESCRIPTOR_PATH = "/v1/bayeux-tapestry/bayeux-tapestry.dzi";
const TILE_PATH = /^\/v1\/bayeux-tapestry\/bayeux-tapestry_files\/(0|[1-9][0-9]?)\/(0|[1-9][0-9]{0,2})_(0|[1-9])\.webp$/;
const PYRAMID = Array.from({ length: 20 }, (_, level) => {
  const scale = 2 ** (19 - level);
  return {
    columns: Math.ceil(Math.ceil(482096 / scale) / 1024),
    rows: Math.ceil(Math.ceil(5550 / scale) / 1024),
  };
});

export function parsePublicPath(pathname) {
  if (pathname === DESCRIPTOR_PATH) {
    return {
      kind: "descriptor",
      key: pathname.slice(1),
      contentType: "application/xml; charset=utf-8",
    };
  }

  const tile = TILE_PATH.exec(pathname);
  const bounds = tile && PYRAMID[Number(tile[1])];
  if (bounds && Number(tile[2]) < bounds.columns && Number(tile[3]) < bounds.rows) {
    return {
      kind: "tile",
      key: pathname.slice(1),
      contentType: "image/webp",
    };
  }

  return null;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.() ?? `fallback-${Date.now()}`;
}

function errorResponse(status, code, message, method = "GET", extraHeaders = {}) {
  const headers = new Headers({
    ...PUBLIC_HEADERS,
    ...extraHeaders,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  const body = method === "HEAD" ? null : JSON.stringify({ error: { code, message } });
  return new Response(body, { status, headers });
}

function normaliseEtag(value) {
  return value.trim().replace(/^W\//i, "");
}

function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const wanted = normaliseEtag(etag);
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || normaliseEtag(candidate) === wanted);
}

function immutableHeaders(object, contentType) {
  const headers = new Headers(PUBLIC_HEADERS);
  headers.set("Accept-Ranges", "none");
  headers.set("Cache-Control", IMMUTABLE_CACHE_CONTROL);
  headers.set("Content-Type", contentType);

  if (Number.isSafeInteger(object.size) && object.size >= 0) {
    headers.set("Content-Length", String(object.size));
  }
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  if (object.uploaded instanceof Date && !Number.isNaN(object.uploaded.valueOf())) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }

  return headers;
}

function responseFromCached(cached, request) {
  const headers = new Headers(cached.headers);
  if (etagMatches(request.headers.get("If-None-Match"), headers.get("ETag"))) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : cached.body, {
    status: cached.status,
    headers,
  });
}

async function readCache(cache, key, request, id) {
  if (!cache) return null;
  try {
    const cached = await cache.match(key);
    return cached ? responseFromCached(cached, request) : null;
  } catch (error) {
    console.error("Tile cache read failed", {
      requestId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function storeInCache(cache, key, response, context, id) {
  if (!cache || !context?.waitUntil) return;
  const operation = cache.put(key, response.clone()).catch((error) => {
    console.error("Tile cache write failed", {
      requestId: id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  context.waitUntil(operation);
}

export async function handleRequest(
  request,
  env,
  context,
  cache = globalThis.caches?.default,
) {
  const id = requestId();

  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "method_not_allowed", "Only GET and HEAD are allowed.", request.method, {
      Allow: "GET, HEAD",
    });
  }

  try {
    const url = new URL(request.url);
    if (url.search || url.hash) {
      return errorResponse(404, "not_found", "The requested public derivative was not found.", request.method);
    }

    const route = parsePublicPath(url.pathname);
    if (!route) {
      return errorResponse(404, "not_found", "The requested public derivative was not found.", request.method);
    }
    if (!env?.TAPESTRY_DERIVATIVES) {
      throw new Error("The TAPESTRY_DERIVATIVES binding is unavailable.");
    }

    // Cache keys are canonical GET requests without client headers. Queries are
    // rejected above, so each immutable /v1 object has exactly one cache key.
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await readCache(cache, cacheKey, request, id);
    if (cached) return cached;

    const object =
      request.method === "HEAD"
        ? await env.TAPESTRY_DERIVATIVES.head(route.key)
        : await env.TAPESTRY_DERIVATIVES.get(route.key);

    if (!object) {
      const missing = errorResponse(404, "not_found", "The requested public derivative was not found.", request.method);
      // Only a finite, valid derivative can get here. Briefly cache missing GETs
      // so a temporary object outage cannot turn retries into repeated R2 reads.
      // Never cache a HEAD response under the shared GET key.
      missing.headers.set("Cache-Control", "public, max-age=30, s-maxage=30");
      if (request.method === "GET") storeInCache(cache, cacheKey, missing, context, id);
      return missing;
    }

    const headers = immutableHeaders(object, route.contentType);
    if (etagMatches(request.headers.get("If-None-Match"), headers.get("ETag"))) {
      headers.delete("Content-Length");
      return new Response(null, { status: 304, headers });
    }

    const response = new Response(request.method === "HEAD" ? null : object.body, {
      status: 200,
      headers,
    });

    // Cache only complete GET responses. HEAD metadata is inexpensive and a
    // partial/range response is never constructed by this Worker.
    if (request.method === "GET") {
      storeInCache(cache, cacheKey, response, context, id);
    }
    return response;
  } catch (error) {
    console.error("Derivative request failed", {
      requestId: id,
      message: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      500,
      "internal_error",
      "The derivative could not be read.",
      request.method,
      { "X-Request-Id": id },
    );
  }
}

export default {
  fetch(request, env, context) {
    return handleRequest(request, env, context);
  },
};
