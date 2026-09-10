from pathlib import Path

p = Path('backend/server.js')
s = p.read_text(encoding='utf-8')

old = '''// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
let server;
(async () => {
  try {
    await ensureAffiliateSchema();
  } catch (migrationError) {
    console.error('Affiliate schema repair failed:', migrationError.message);
  }
  server = app.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`),
  );
})();
const wss = new WebSocket.Server({ server, path: "/ws" });

setInterval(() => {
  if (global.prices && Object.keys(global.prices).length > 0) {
    const msg = JSON.stringify({ type: "price", data: global.prices });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }
}, 1000);

wss.on("connection", (client) => {
  console.log("Frontend WebSocket connected");
  client.send(JSON.stringify({ type: "price", data: global.prices || {} }));
});
'''

new = '''// ========== WEBSOCKET SERVER ==========
const PORT = process.env.PORT || 3000;
let server;
let wss;

(async () => {
  try {
    await ensureAffiliateSchema();
  } catch (migrationError) {
    console.error('Affiliate schema repair failed:', migrationError.message);
  }

  server = app.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`),
  );

  // WebSocketServer MUST receive the actual HTTP server after app.listen().
  wss = new WebSocket.Server({ server, path: "/ws" });

  wss.on("connection", (client) => {
    console.log("Frontend WebSocket connected");
    client.send(JSON.stringify({ type: "price", data: global.prices || {} }));
  });
})();

setInterval(() => {
  if (wss && global.prices && Object.keys(global.prices).length > 0) {
    const msg = JSON.stringify({ type: "price", data: global.prices });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
  }
}, 1000);
'''

if old in s:
    s = s.replace(old, new, 1)
elif 'wss = new WebSocket.Server({ server, path: "/ws" });' in s and 'let wss;' in s:
    print('WebSocket startup already fixed.')
else:
    raise SystemExit('WebSocket startup block not found')

p.write_text(s, encoding='utf-8')
print('WebSocket startup ordering fixed.')
