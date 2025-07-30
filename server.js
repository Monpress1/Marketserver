import { WebSocketServer } from 'ws';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const wss = new WebSocketServer({ port: 3000 });
console.log('🟢 WebSocket server running on ws://localhost:3000');

const db = await open({
  filename: './products.db',
  driver: sqlite3.Database
});

// Initialize the DB with full schema
await db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT,
    category TEXT,
    price REAL,
    image TEXT,
    description TEXT,
    condition TEXT,
    negotiable INTEGER,
    location TEXT,
    paymentOption TEXT,
    sellerId TEXT,
    sellerWhatsApp TEXT,
    timestamp TEXT
  )
`);

// Broadcast helper
function broadcast(type, payload, exclude = null) {
  for (const client of wss.clients) {
    if (client.readyState === 1 && client !== exclude) {
      client.send(JSON.stringify({ type, payload }));
    }
  }
}

wss.on('connection', async (ws) => {
  console.log('🔌 Client connected');

  // Send all products on connection
  const products = await db.all('SELECT * FROM products');
  ws.send(JSON.stringify({ type: 'initial_data', payload: products }));

  ws.on('message', async (message) => {
    try {
      const { type, payload } = JSON.parse(message);

      switch (type) {
        case 'add_product': {
          const {
            id, name, category, price, image, description,
            condition, negotiable, location, paymentOption,
            sellerId, sellerWhatsApp, timestamp
          } = payload;

          await db.run(`
            INSERT INTO products (
              id, name, category, price, image, description,
              condition, negotiable, location, paymentOption,
              sellerId, sellerWhatsApp, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            id, name, category, price, image, description,
            condition, negotiable ? 1 : 0, location, paymentOption,
            sellerId, sellerWhatsApp, timestamp
          ]);

          broadcast('product_added', payload, ws);
          break;
        }

        case 'update_product': {
          const {
            id, name, category, price, image, description,
            condition, negotiable, location, paymentOption,
            sellerId, sellerWhatsApp, timestamp
          } = payload;

          await db.run(`
            UPDATE products SET
              name = ?, category = ?, price = ?, image = ?, description = ?,
              condition = ?, negotiable = ?, location = ?, paymentOption = ?,
              sellerId = ?, sellerWhatsApp = ?, timestamp = ?
            WHERE id = ?
          `, [
            name, category, price, image, description,
            condition, negotiable ? 1 : 0, location, paymentOption,
            sellerId, sellerWhatsApp, timestamp, id
          ]);

          broadcast('product_updated', payload, ws);
          break;
        }

        case 'delete_product': {
          const { id } = payload;
          await db.run('DELETE FROM products WHERE id = ?', [id]);
          broadcast('product_deleted', { id }, ws);
          break;
        }

        case 'get_my_products': {
          const { sellerId } = payload;
          const myProducts = await db.all(
            'SELECT * FROM products WHERE sellerId = ?',
            [sellerId]
          );
          ws.send(JSON.stringify({ type: 'my_products', payload: myProducts }));
          break;
        }

        default:
          console.warn('⚠ Unknown message type:', type);
      }
    } catch (err) {
      console.error('❌ Message handling error:', err);
      ws.send(JSON.stringify({ type: 'error', payload: 'Invalid message or server error' }));
    }
  });
});
