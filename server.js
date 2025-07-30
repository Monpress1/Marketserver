import { WebSocketServer } from 'ws'; // For creating the WebSocket server
import sqlite3 from 'sqlite3';       // The SQLite database driver
import { open } from 'sqlite';        // The 'sqlite' package for async/await DB operations
import path from 'path';            // Node.js built-in for path manipulation
import { fileURLToPath } from 'url';  // For getting __dirname in ES Modules
import fs from 'fs';                // Node.js built-in for file system operations
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs (if needed on backend)

// --- Helper for __dirname in ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Configuration ---
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = './marketplace.db'; // SQLite database file name

// --- Ensure uploads folder exists (for images) ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
  console.log(`[INIT] Created uploads directory: ${UPLOADS_DIR}`);
}

// --- Initialize SQLite Database (using async/await with 'sqlite' package) ---
let db;
(async () => {
  try {
    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database
    });
    console.log('[DB] ✅ Connected to SQLite database.');

    // Create products table with the full schema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        description TEXT,
        condition TEXT,
        negotiable INTEGER, -- 0 for false, 1 for true
        location TEXT,
        paymentOption TEXT,
        sellerWhatsApp TEXT,
        sellerId TEXT NOT NULL,
        imageUrl TEXT,
        timestamp INTEGER NOT NULL -- Unix timestamp in milliseconds
      )
    `);
    console.log('[DB] ✅ Products table ensured.');

    // --- Start WebSocket Server after DB is ready ---
    const wss = new WebSocketServer({ port: PORT }, () => {
      console.log(`[WS] 🚀 WebSocket server running on ws://localhost:${PORT}`);
    });

    // --- WebSocket Clients Set ---
    const clients = new Set(); // To keep track of all connected WebSocket clients

    // --- Broadcast Helper Function ---
    // Sends a message to all connected clients, optionally excluding the sender
    function broadcast(type, payload, excludeWs = null) {
      const message = JSON.stringify({ type, payload });
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
          client.send(message);
        }
      });
      // Log what's being broadcasted for debugging purposes
      console.log(`[WS] 📢 Broadcasting [${type}]: ${JSON.stringify(payload).substring(0, 100)}...`);
    }

    // --- WebSocket Connection Handling ---
    wss.on('connection', async (ws) => {
      clients.add(ws); // Add new client to the set
      console.log(`[WS] 🔌 Client connected. Total clients: ${clients.size}`);

      // Send all existing products to the newly connected client
      try {
        const products = await db.all('SELECT * FROM products ORDER BY timestamp DESC');
        ws.send(JSON.stringify({ type: 'ALL_PRODUCTS', payload: products }));
        console.log(`[WS] 📦 Sent ${products.length} initial ALL_PRODUCTS to new client.`);
      } catch (err) {
        console.error('[DB] ❌ Error sending initial products:', err.message);
        ws.send(JSON.stringify({ type: 'ERROR', payload: 'Failed to load products.' }));
      }

      // --- WebSocket Message Handling from Clients ---
      ws.on('message', async (message) => {
        let parsedMsg;
        try {
          parsedMsg = JSON.parse(message);
          console.log(`[WS] 📡 Received message type: [${parsedMsg.type}] from client.`);
          // console.log('Payload:', parsedMsg.payload); // Uncomment for full payload debug
        } catch (err) {
          console.error('[WS] ❌ Invalid JSON received:', message.toString().substring(0, 100) + '...', err.message);
          ws.send(JSON.stringify({ type: 'ERROR', payload: 'Invalid message format.' }));
          return;
        }

        const { type, payload } = parsedMsg;

        try {
          switch (type) {
            case 'ADD_PRODUCT': {
              // Basic validation for required fields
              const requiredFields = ['name', 'category', 'price', 'description', 'condition', 'location', 'paymentOption', 'sellerWhatsApp', 'sellerId', 'imageUrl'];
              for (const field of requiredFields) {
                  if (payload[field] === undefined || payload[field] === null || String(payload[field]).trim() === '') {
                      ws.send(JSON.stringify({ type: 'ERROR', payload: `Missing or empty required field: ${field}` }));
                      return;
                  }
              }

              // Assign a new unique ID and timestamp if not provided by frontend (or always assign on backend for control)
              const newProductId = payload.id || uuidv4();
              const newTimestamp = payload.timestamp || Date.now(); // Use current time if not provided

              const negotiableValue = payload.negotiable ? 1 : 0; // Convert boolean to integer

              await db.run(`
                INSERT INTO products (
                  id, name, category, price, description, condition, negotiable,
                  location, paymentOption, sellerWhatsApp, sellerId, imageUrl, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `, [
                newProductId, payload.name, payload.category, payload.price, payload.description,
                payload.condition, negotiableValue, payload.location, payload.paymentOption,
                payload.sellerWhatsApp, payload.sellerId, payload.imageUrl, newTimestamp
              ]);

              // Construct the product object as it is stored in DB (with generated id/timestamp)
              const addedProduct = {
                ...payload,
                id: newProductId,
                negotiable: negotiableValue, // Send back 0/1 or convert to boolean for frontend
                timestamp: newTimestamp
              };

              console.log(`[DB] ➕ Product added to DB: ${addedProduct.id}`);
              broadcast('PRODUCT_ADDED', addedProduct, ws); // Broadcast to others
              ws.send(JSON.stringify({ type: 'ADD_PRODUCT_SUCCESS', payload: addedProduct.id })); // Confirm to sender
              break;
            }

            case 'UPDATE_PRODUCT': {
              const { id } = payload;
              if (!id) {
                ws.send(JSON.stringify({ type: 'ERROR', payload: 'Product ID is required for update.' }));
                return;
              }

              const negotiableValue = payload.negotiable ? 1 : 0;
              const updatedTimestamp = payload.timestamp || Date.now(); // Update timestamp on edit too

              await db.run(`
                UPDATE products SET
                  name = ?, category = ?, price = ?, description = ?, condition = ?, negotiable = ?,
                  location = ?, paymentOption = ?, sellerWhatsApp = ?, sellerId = ?,
                  imageUrl = ?, timestamp = ?
                WHERE id = ?
              `, [
                payload.name, payload.category, payload.price, payload.description, payload.condition, negotiableValue,
                payload.location, payload.paymentOption, payload.sellerWhatsApp, payload.sellerId,
                payload.imageUrl, updatedTimestamp, id
              ]);

              // Construct the product object as it is updated in DB (with updated timestamp)
              const updatedProduct = {
                ...payload,
                negotiable: negotiableValue,
                timestamp: updatedTimestamp
              };

              console.log(`[DB] 🔄 Product updated in DB: ${id}`);
              broadcast('PRODUCT_UPDATED', updatedProduct, ws); // Broadcast to others
              ws.send(JSON.stringify({ type: 'UPDATE_PRODUCT_SUCCESS', payload: id })); // Confirm to sender
              break;
            }

            case 'DELETE_PRODUCT': {
              const { id } = payload;
              if (!id) {
                ws.send(JSON.stringify({ type: 'ERROR', payload: 'Product ID is required for deletion.' }));
                return;
              }
              await db.run('DELETE FROM products WHERE id = ?', [id]);
              console.log(`[DB] 🗑️ Product deleted from DB: ${id}`);
              broadcast('PRODUCT_DELETED', { id }, ws); // Send id in a payload object
              ws.send(JSON.stringify({ type: 'DELETE_PRODUCT_SUCCESS', payload: id })); // Confirm to sender
              break;
            }

            case 'GET_MY_PRODUCTS': {
              const { sellerId } = payload;
              if (!sellerId) {
                ws.send(JSON.stringify({ type: 'ERROR', payload: 'Seller ID is required to get my products.' }));
                return;
              }
              const myProducts = await db.all(
                'SELECT * FROM products WHERE sellerId = ? ORDER BY timestamp DESC',
                [sellerId]
              );
              ws.send(JSON.stringify({ type: 'MY_PRODUCTS_LIST', payload: myProducts }));
              console.log(`[DB] 📦 Sent ${myProducts.length} MY_PRODUCTS_LIST for seller: ${sellerId}`);
              break;
            }

            case 'GET_ALL_PRODUCTS': {
                const allProducts = await db.all('SELECT * FROM products ORDER BY timestamp DESC');
                ws.send(JSON.stringify({ type: 'ALL_PRODUCTS', payload: allProducts }));
                console.log(`[DB] 📦 Sent ${allProducts.length} ALL_PRODUCTS on explicit request.`);
                break;
            }

            default:
              console.warn(`[WS] ⚠ Unknown message type received: ${type}`);
              ws.send(JSON.stringify({ type: 'ERROR', payload: `Unknown message type: ${type}` }));
          }
        } catch (err) {
          console.error(`[DB] ❌ Error processing message type [${type}]:`, err.message);
          // Send a generic error back to the client that sent the message
          ws.send(JSON.stringify({ type: 'ERROR', payload: `Server error processing ${type} request.` }));
        }
      });

      // --- WebSocket Connection Close Handling ---
      ws.on('close', () => {
        clients.delete(ws); // Remove client from the set
        console.log(`[WS] 🔌 Client disconnected. Total clients: ${clients.size}`);
      });
    });

  } catch (err) {
    console.error('[FATAL] ❌ Fatal error initializing server or database:', err.message);
    process.exit(1); // Exit the process if DB connection fails
  }
})();
