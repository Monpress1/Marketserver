const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const WebSocket = require("ws");
const http = require("http");

// --- Server & WebSocket Setup ---
const server = http.createServer();
const wss = new WebSocket.Server({ server });

// --- SQLite Setup ---
const db = new sqlite3.Database("./marketplace.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT,
    category TEXT,
    price INTEGER,
    condition TEXT,
    negotiable INTEGER,
    location TEXT,
    paymentOption TEXT,
    sellerWhatsApp TEXT,
    sellerId TEXT,
    imageUrl TEXT,
    timestamp INTEGER
  )`);
});

// --- Seed Demo Products (optional) ---
const seedProducts = [
  {
    id: "p001",
    name: "Nikon Camera",
    category: "Electronics",
    price: 180000,
    condition: "New",
    negotiable: 1,
    location: "Abuja",
    paymentOption: "On Delivery",
    sellerWhatsApp: "08034567891",
    sellerId: "user_demo_3",
    imageUrl: "/uploads/camera.jpg",
    timestamp: Date.now() - 86400000 * 3, // ✅ fixed typo here
  },
  {
    id: "p002",
    name: "iPhone X",
    category: "Phones",
    price: 150000,
    condition: "Used",
    negotiable: 0,
    location: "Lagos",
    paymentOption: "Bank Transfer",
    sellerWhatsApp: "08123456789",
    sellerId: "user_demo_1",
    imageUrl: "/uploads/iphonex.jpg",
    timestamp: Date.now() - 86400000 * 1,
  },
];

seedProducts.forEach((product) => {
  db.run(
    `INSERT OR IGNORE INTO products (
      id, name, category, price, condition, negotiable, location,
      paymentOption, sellerWhatsApp, sellerId, imageUrl, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      product.id,
      product.name,
      product.category,
      product.price,
      product.condition,
      product.negotiable,
      product.location,
      product.paymentOption,
      product.sellerWhatsApp,
      product.sellerId,
      product.imageUrl,
      product.timestamp,
    ]
  );
});

// --- WebSocket Handling ---
wss.on("connection", (ws) => {
  console.log("Client connected ✅");

  // Send all products on connect
  db.all("SELECT * FROM products ORDER BY timestamp DESC", [], (err, rows) => {
    if (!err) {
      ws.send(JSON.stringify({ type: "all_products", data: rows }));
    }
  });

  ws.on("message", (msg) => {
    try {
      const parsed = JSON.parse(msg);

      // --- Add Product ---
      if (parsed.type === "add_product") {
        const p = parsed.data;
        db.run(
          `INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id,
            p.name,
            p.category,
            p.price,
            p.condition,
            p.negotiable ? 1 : 0,
            p.location,
            p.paymentOption,
            p.sellerWhatsApp,
            p.sellerId,
            p.imageUrl,
            p.timestamp,
          ],
          () => {
            broadcast({ type: "product_added", data: p });
          }
        );
      }

      // --- Edit/Update Product ---
      else if (parsed.type === "update_product") {
        const p = parsed.data;
        db.run(
          `UPDATE products SET
            name = ?, category = ?, price = ?, condition = ?, negotiable = ?,
            location = ?, paymentOption = ?, sellerWhatsApp = ?, imageUrl = ?, timestamp = ?
           WHERE id = ?`,
          [
            p.name,
            p.category,
            p.price,
            p.condition,
            p.negotiable ? 1 : 0,
            p.location,
            p.paymentOption,
            p.sellerWhatsApp,
            p.imageUrl,
            p.timestamp,
            p.id,
          ],
          () => {
            broadcast({ type: "product_updated", data: p });
          }
        );
      }

      // --- Delete Product ---
      else if (parsed.type === "delete_product") {
        const productId = parsed.data;
        db.run(`DELETE FROM products WHERE id = ?`, [productId], () => {
          broadcast({ type: "product_deleted", data: productId });
        });
      }

      // --- Seller's Products ---
      else if (parsed.type === "get_my_products") {
        const sellerId = parsed.data;
        db.all(
          `SELECT * FROM products WHERE sellerId = ? ORDER BY timestamp DESC`,
          [sellerId],
          (err, rows) => {
            if (!err) {
              ws.send(
                JSON.stringify({ type: "my_products", data: rows })
              );
            }
          }
        );
      }

    } catch (e) {
      console.error("Invalid message", e);
    }
  });

  ws.on("close", () => console.log("Client disconnected ❌"));
});

// --- Broadcast Helper ---
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on port ${PORT}`);
});
