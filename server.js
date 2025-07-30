import { WebSocketServer } from 'ws';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Get __dirname equivalent in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = './marketplace.db'; // Database file name

// --- Ensure uploads folder exists ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
  console.log(`Created uploads directory: ${UPLOADS_DIR}`);
}

// --- Initialize SQLite Database (using async/await with 'sqlite' package) ---
let db;
(async () => {
  try {
    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database
    });
    console.log('✅ Connected to SQLite database.');

    // Create products table with full schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT,
        category TEXT,
        price REAL, -- Use REAL for price to allow decimals
        description TEXT,
        condition TEXT,
        negotiable INTEGER, -- 0 for false, 1 for true
        location TEXT,
        paymentOption TEXT,
        sellerWhatsApp TEXT,
        sellerId TEXT,
        imageUrl TEXT,
        timestamp INTEGER -- Unix timestamp in milliseconds
      )
    `);
    console.log('✅ Products table ensured.');

    // Start WebSocket Server after DB is ready
    const wss = new WebSocketServer({ port: PORT }, () => {
      console.log(`🚀 WebSocket server running on ws://localhost:${PORT}`);
    });

    // --- WebSocket Clients Set ---
    const clients = new Set(); // Use a Set to store connected clients

    // --- Broadcast Helper ---
    // Sends a message to all connected clients, optionally excluding the sender
    function broadcast(type, payload, excludeWs = null) {
      const message = JSON.stringify({ type, payload });
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
          client.send(message);
        }
      });
      // Also log what's being broadcasted for debugging
      console.log(`📢 Broadcasting [${type}]:`, JSON.stringify(payload).substring(0, 100) + '...');
    }

    // --- WebSocket Handling ---
    wss.on('connection', async (ws) => {
      clients.add(ws);
      console.log('🔌 Client connected. Total clients:', clients.size);

      // Send all products to the newly connected client
      try {
        const products = await db.all('SELECT * FROM products ORDER BY timestamp DESC');
        ws.send(JSON.stringify({ type: 'ALL_PRODUCTS', payload: products }));
        console.log('📦 Sent initial ALL_PRODUCTS to new client.');
      } catch (err) {
        console.error('❌ Error sending initial products:', err.message);
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Failed to load products.' }));
      }


      ws.on('message', async (message) => {
        let parsedMsg;
        try {
          parsedMsg = JSON.parse(message);
          console.log('📡 Received message:', parsedMsg.type, parsedMsg.payload ? JSON.stringify(parsedMsg.payload).substring(0, 50) + '...' : '');
        } catch (err) {
          console.error('❌ Invalid JSON received:', message.toString(), err.message);
          ws.send(JSON.stringify({ type: 'ERROR', payload: 'Invalid message format.' }));
          return;
        }

        const { type, payload } = parsedMsg;

        try {
          switch (type) {
            case 'ADD_PRODUCT': {
              // Ensure all required fields are present and valid
              const requiredFields = ['id', 'name', 'category', 'price', 'description', 'condition', 'location', 'paymentOption', 'sellerWhatsApp', 'sellerId', 'imageUrl', 'timestamp'];
              const missingFields = requiredFields.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === '');

              if (missingFields.length > 0) {
                  ws.send(JSON.stringify({ type: 'ERROR', payload: `Missing required fields: ${missingFields.join(', ')}` }));
                  return;
              }

              // Set negotiable to 0 or 1
              const negotiableValue = payload.negotiable ? 1 : 0;

              await db.run(`
                INSERT INTO products (
                  id, name, category, price, description, condition, negotiable,
                  location, paymentOption, sellerWhatsApp, sellerId, imageUrl, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                payload.id, payload.name, payload.category, payload.price, payload.description,
                payload.condition, negotiableValue, payload.location, payload.paymentOption,
                payload.sellerWhatsApp, payload.sellerId, payload.imageUrl, payload.timestamp
              ]);

              console.log('➕ Product added to DB:', payload.id);
              // Broadcast to all other clients
              broadcast('PRODUCT_ADDED', payload, ws);
              // Optionally send a success confirmation back to the sender
              ws.send(JSON.stringify({ type: 'ADD_PRODUCT_SUCCESS', payload: payload.id }));
              break;
            }

            case 'UPDATE_PRODUCT': { // Frontend likely sends this from 'edit' form submission
              const {
                id, name, category, price, description, condition, negotiable,
                location, paymentOption, sellerWhatsApp, sellerId, imageUrl, timestamp
              } = payload;

              // Basic validation - check if ID exists
              if (!id) {
                  ws.send(JSON.stringify({ type: 'ERROR', payload: 'Product ID is required for update.' }));
                  return;
              }

              const negotiableValue = negotiable ? 1 : 0;

              await db.run(`
                UPDATE products SET
                  name = ?, category = ?, price = ?, description = ?, condition = ?, negotiable = ?,
                  location = ?, paymentOption = ?, sellerWhatsApp = ?, sellerId = ?,
                  imageUrl = ?, timestamp = ?
                WHERE id = ?
              `, [
                name, category, price, description, condition, negotiableValue,
                location, paymentOption, sellerWhatsApp, sellerId,
                imageUrl, timestamp, id
              ]);

              console.log('🔄 Product updated in DB:', id);
              broadcast('PRODUCT_UPDATED', payload, ws);
              // Optionally send a success confirmation back to the sender
              ws.send(JSON.stringify({ type: 'UPDATE_PRODUCT_SUCCESS', payload: id }));
              break;
            }

            case 'DELETE_PRODUCT': {
              const { id } = payload; // Assuming payload is { id: 'some-id' }
              if (!id) {
                  ws.send(JSON.stringify({ type: 'ERROR', payload: 'Product ID is required for deletion.' }));
                  return;
              }
              await db.run('DELETE FROM products WHERE id = ?', [id]);
              console.log('🗑️ Product deleted from DB:', id);
              broadcast('PRODUCT_DELETED', { id }, ws); // Send id in an object
              // Optionally send a success confirmation back to the sender
              ws.send(JSON.stringify({ type: 'DELETE_PRODUCT_SUCCESS', payload: id }));
              break;
            }

            case 'GET_MY_PRODUCTS': {
              const { sellerId } = payload; // Assuming payload is { sellerId: 'some-id' }
              if (!sellerId) {
                  ws.send(JSON.stringify({ type: 'ERROR', payload: 'Seller ID is required to get my products.' }));
                  return;
              }
              const myProducts = await db.all(
                'SELECT * FROM products WHERE sellerId = ? ORDER BY timestamp DESC',
                [sellerId]
              );
              ws.send(JSON.stringify({ type: 'MY_PRODUCTS_LIST', payload: myProducts }));
              console.log(`📦 Sent ${myProducts.length} MY_PRODUCTS_LIST for seller: ${sellerId}`);
              break;
            }

            case 'GET_ALL_PRODUCTS': { // For when the frontend explicitly asks for all products again
                const allProducts = await db.all('SELECT * FROM products ORDER BY timestamp DESC');
                ws.send(JSON.stringify({ type: 'ALL_PRODUCTS', payload: allProducts }));
                console.log('📦 Sent ALL_PRODUCTS on request.');
                break;
            }

            default:
              console.warn('⚠ Unknown message type received:', type);
              ws.send(JSON.stringify({ type: 'ERROR', payload: `Unknown message type: ${type}` }));
          }
        } catch (err) {
          console.error(`❌ Error handling type [${type}]:`, err.message);
          // Send a generic error back to the client that sent the message
          ws.send(JSON.stringify({ type: 'ERROR', payload: `Server error processing ${type} request.` }));
        }
      });

      ws.on('close', () => {
        clients.delete(ws);
        console.log('🔌 Client disconnected. Total clients:', clients.size);
      });
    });

  } catch (err) {
    console.error('Fatal error initializing server or database:', err.message);
    process.exit(1); // Exit if DB connection fails
  }
})();
