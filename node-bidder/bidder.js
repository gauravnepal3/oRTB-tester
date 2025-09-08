// server.js
import express from "express";
import zlib from "zlib";
import http from "http";

const PORT = Number(process.env.PORT || 9100);
const app = express();

// NO app.use(express.json()) — we drain manually

app.post("/bid", (req, res) => {
    let aborted = false;
    req.on("aborted", () => { aborted = true; });

    // Drain body; keep a small prefix to sniff tmax/id
    let first = Buffer.alloc(0);
    req.on("data", (chunk) => {
        if (first.length < 4096) {
            first = Buffer.concat([first, chunk]).slice(0, 4096);
        }
    });

    req.on("end", () => {
        // Parse tiny bits without full JSON parse
        const s = first.toString("utf8");
        const tmax = (() => {
            const m = /"tmax"\s*:\s*(\d+)/.exec(s);
            const v = m ? parseInt(m[1], 10) : 300;
            return Number.isFinite(v) ? v : 300;
        })();
        const id = /"id"\s*:\s*"([^"]*)"/.exec(s)?.[1] ?? "";

        // Random delay up to tmax, but cap it so manual tests never hang forever
        const delay = Math.min(Math.floor(Math.random() * Math.max(1, tmax)), 800);

        setTimeout(() => {
            if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;

            const payload = JSON.stringify({
                id,
                upstream: `node:${PORT}`,
                ts: Date.now(),
                took_ms: delay,
                echo_tmax: tmax,
                blob: "x".repeat(2048)
            });

            const accept = (req.headers["accept-encoding"] || "");
            if (accept.includes("gzip")) {
                // ASYNC gzip so we don’t block the event loop
                zlib.gzip(Buffer.from(payload, "utf8"), (err, gz) => {
                    if (aborted || res.headersSent || res.writableEnded || res.destroyed) return;
                    if (err) return res.status(500).end();
                    res.status(200)
                        .set("Content-Type", "application/json")
                        .set("Content-Encoding", "gzip")
                        .set("Content-Length", String(gz.length))
                        .end(gz);
                });
            } else {
                res.status(200)
                    .set("Content-Type", "application/json")
                    .set("Content-Length", String(Buffer.byteLength(payload)))
                    .end(payload);
            }
        }, delay);
    });
});

// A quick liveness route
app.get("/ping", (_, res) => res.status(204).end());

// Create server with sane timeouts for high-QPS testing
const server = http.createServer(app);
server.keepAliveTimeout = 5000;   // keep-alive lifetime
server.headersTimeout = 7000;   // must be > keepAliveTimeout
server.requestTimeout = 0;      // don’t auto-timeout active requests

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Stub bidder listening on :${PORT}`);
});