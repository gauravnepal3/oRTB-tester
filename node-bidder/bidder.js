// bidder.js (ESM)
import express from "express";
import zlib from "zlib";

// --- Defaults tuned for ~90% on-time replies ---
const DEF_MIN_DELAY_MS = Number(process.env.MIN_DELAY_MS ?? 15);   // must be < typical tmax
const DEF_HEADROOM_MS = Number(process.env.HEADROOM_MS ?? 5);    // cushion so "on-time" < tmax
const DEF_LATE_FRACTION = Number(process.env.LATE_FRACTION ?? 0.10);// 10% late by design
const DEF_BLOB_BYTES = Number(process.env.BLOB_BYTES ?? 256);  // small payload for perf
const GZIP_ENABLED = String(process.env.GZIP ?? "0") === "1";  // enable only if needed

function sniffId(s) { return /"id"\s*:\s*"([^"]*)"/.exec(s)?.[1] ?? ""; }
function sniffTmax(s, fallback) {
    const m = /"tmax"\s*:\s*(\d+)/.exec(s);
    const v = m ? parseInt(m[1], 10) : fallback;
    return Number.isFinite(v) ? v : fallback;
}

function decideDelay(tmax, {
    minDelay = DEF_MIN_DELAY_MS,
    headroomMs = DEF_HEADROOM_MS,
    lateFrac = DEF_LATE_FRACTION,
    lateSpanMs // if undefined, computed from tmax below
} = {}) {
    const maxOnTime = Math.max(0, tmax - headroomMs);

    // Make sure we still have an on-time window even if tmax is tiny
    let effMin = minDelay;
    if (effMin >= maxOnTime) {
        // shrink just for this request (keep at least 1ms window if we can)
        effMin = Math.max(0, Math.min(minDelay, Math.max(0, maxOnTime - 1)));
    }

    const roll = Math.random();
    if (!Number.isFinite(lateSpanMs)) {
        lateSpanMs = Math.max(20, Math.floor(tmax * 0.5));
    }

    if (roll < lateFrac || effMin >= maxOnTime) {
        // Intentionally late: start just beyond tmax
        const base = Math.max(effMin, tmax + 1);
        return base + Math.floor(Math.random() * Math.max(1, lateSpanMs));
    }

    // On-time uniform in [effMin, maxOnTime]
    const span = Math.max(0, maxOnTime - effMin);
    return effMin + Math.floor(Math.random() * (span + 1));
}

function makeApp() {
    const app = express(); // no global body parser to avoid buffering

    app.get("/ping", (_req, res) => res.status(204).end());

    app.post("/bid", (req, res) => {
    let aborted = false;
    req.on("aborted", () => { aborted = true; });

        // Drain the body but only keep a small prefix to sniff id/tmax
    let first = Buffer.alloc(0);
    req.on("data", (chunk) => {
        if (first.length < 8192) {
            first = Buffer.concat([first, chunk]).slice(0, 8192);
        }
    });

      req.on("end", () => {
          if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;

          const s = first.toString("utf8");
          const tmax = sniffTmax(s, 300); // fallback tmax if not provided
          const delay = decideDelay(tmax, {
              minDelay: DEF_MIN_DELAY_MS,
              headroomMs: DEF_HEADROOM_MS,
              lateFrac: DEF_LATE_FRACTION,
              lateSpanMs: Number.isFinite(+process.env.LATE_SPAN_MS) ? +process.env.LATE_SPAN_MS : undefined
          });

        setTimeout(() => {
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;

          const payload = JSON.stringify({
              id: sniffId(s),
              upstream: "node",
              ts: Date.now(),
              took_ms: delay,
              echo_tmax: tmax,
              blob: "x".repeat(DEF_BLOB_BYTES)
        });

            const acceptsGzip = String(req.headers["accept-encoding"] || "").includes("gzip");

            if (GZIP_ENABLED && acceptsGzip) {
                zlib.gzip(Buffer.from(payload, "utf8"), (err, gz) => {
                    if (err) {
                        res.status(200)
                            .set("Content-Type", "application/json")
                            .set("Connection", "keep-alive")
                            .send(payload);
                    } else {
              res.status(200)
                  .set("Content-Type", "application/json")
                  .set("Content-Encoding", "gzip")
                  .set("Connection", "keep-alive")
                  .send(gz);
                  }
              });
        } else {
                res.status(200)
                    .set("Content-Type", "application/json")
                    .set("Connection", "keep-alive")
                    .send(payload);
          }
      }, delay);
    });
  });

    return app;
}

// Multi-port support: comma-separated list in PORTS (default 9100..9104)
const ports = (process.env.PORTS || "9100,9101,9102,9103,9104")
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(Number.isFinite);

const app = makeApp();

console.log("[BIDDER] starting with:");
console.log(`  PORTS=${ports.join(",")}`);
console.log(`  MIN_DELAY_MS=${DEF_MIN_DELAY_MS}`);
console.log(`  HEADROOM_MS=${DEF_HEADROOM_MS}`);
console.log(`  LATE_FRACTION=${DEF_LATE_FRACTION}`);
console.log(`  LATE_SPAN_MS=${process.env.LATE_SPAN_MS ?? "(auto ~ tmax*0.5, min 20)"}`);
console.log(`  BLOB_BYTES=${DEF_BLOB_BYTES}`);
console.log(`  GZIP=${GZIP_ENABLED ? "on" : "off"}`);

ports.forEach(p => {
    app.listen(p, "0.0.0.0", () => console.log(`[BIDDER] listening on :${p}`));
});