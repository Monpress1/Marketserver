const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// Initialize SQLite database
const db = new sqlite3.Database('./marketplace.db');

// Create products table with full schema
db.run(`
  CREATE TABLE IF NOT EXISTS products (
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
  )
`);

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected');

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (err) {
      console.error('Invalid JSON:', data);
      return;
    }

    if (msg.type === 'add_product') {
      const p = msg.data;
      db.run(
        `INSERT INTO products (
          id, name, category, price, condition, negotiable,
          location, paymentOption, sellerWhatsApp, sellerId,
          imageUrl, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, p.name, p.category, p.price, p.condition,
          p.negotiable ? 1 : 0, p.location, p.paymentOption,
          p.sellerWhatsApp, p.sellerId, p.imageUrl, p.timestamp
        ],
        (err) => {
          if (err) {
            console.error('DB insert error:', err.message);
            return;
          }
          broadcast({ type: 'product_added', data: p });
        }
      );
    }

    else if (msg.type === 'edit_product') {
      const p = msg.data;
      db.run(
        `UPDATE products SET
          name = ?, category = ?, price = ?, condition = ?, negotiable = ?,
          location = ?, paymentOption = ?, sellerWhatsApp = ?, sellerId = ?,
          imageUrl = ?, timestamp = ?
         WHERE id = ?`,
        [
          p.name, p.category, p.price, p.condition, p.negotiable ? 1 : 0,
          p.location, p.paymentOption, p.sellerWhatsApp, p.sellerId,
          p.imageUrl, p.timestamp, p.id
        ],
        (err) => {
          if (err) {
            console.error('DB update error:', err.message);
            return;
          }
          broadcast({ type: 'product_updated', data: p });
        }
      );
    }

    else if (msg.type === 'delete_product') {
      const id = msg.id;
      db.run(`DELETE FROM products WHERE id = ?`, [id], (err) => {
        if (err) {
          console.error('DB delete error:', err.message);
          return;
        }
        broadcast({ type: 'product_deleted', id });
      });
    }

    else if (msg.type === 'get_products') {
      db.all(`SELECT * FROM products ORDER BY timestamp DESC`, (err, rows) => {
        if (err) {
          console.error('DB read error:', err.message);
          return;
        }
        ws.send(JSON.stringify({ type: 'products_list', data: rows }));
      });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected');
  });
});

// Helper function to broadcast messages to all clients
function broadcast(msg) {
  const json = JSON.stringify(msg);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  });
        }
