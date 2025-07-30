// server.js
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'marketplace.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
    console.log(`Created uploads directory at: ${UPLOADS_DIR}`);
}

// Initialize SQLite Database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            category TEXT,
            condition TEXT,
            negotiable BOOLEAN,
            location TEXT,
            paymentOption TEXT,
            sellerWhatsApp TEXT,
            imageUrl TEXT,
            timestamp INTEGER,
            sellerId TEXT
        )`, (createErr) => {
            if (createErr) {
                console.error('Error creating products table:', createErr.message);
            } else {
                console.log('Products table checked/created.');
                // Optional: Seed initial data if table is empty
                db.get("SELECT COUNT(*) AS count FROM products", (err, row) => {
                    if (err) {
                        console.error('Error checking product count:', err.message);
                        return;
                    }
                    if (row.count === 0) {
                        console.log('No products found, seeding demo data...');
                        seedDemoProducts();
                    }
                });
            }
        });
    }
});

// Seed Demo Products (imageUrl points to /uploads/ paths, timestamp set to Date.now())
const demoProducts = [
    {
        name: "Premium Leather Handbag", description: "Crafted from genuine Italian leather...",
        price: 75000, category: "Fashion & Accessories", condition: "New", negotiable: true,
        location: "Lagos", paymentOption: "Full Payment", sellerWhatsApp: "2348012345678",
        imageUrl: "/uploads/handbag.jpg", timestamp: Date.now(), sellerId: "user_demo_1"
    },
    {
        name: "Smart Fitness Watch Pro", description: "Track your health and fitness...",
        price: 45000, category: "Electronics & Gadgets", condition: "Used - Like New", negotiable: false,
        location: "Abuja", paymentOption: "Full Payment", sellerWhatsApp: "2349098765432",
        imageUrl: "/uploads/watch.jpg", timestamp: Date.now(), sellerId: "user_demo_2"
    },
    {
        name: "Organic Arabica Coffee Beans (1kg)", description: "Ethically sourced, freshly roasted...",
        price: 12500, category: "Foodstuff", condition: "New", negotiable: true,
        location: "Port Harcourt", paymentOption: "Down Payment Accepted", sellerWhatsApp: "2347011223344",
        imageUrl: "/uploads/coffee.jpg", timestamp: Date.now(), sellerId: "user_demo_1"
    },
    {
        name: "Vintage Decorative Camera", description: "A beautifully preserved vintage wooden camera...",
        price: 98000, category: "Collectibles", condition: "Used - Good", negotiable: true,
        location: "Ibadan", paymentOption: "Full Payment", sellerWhatsApp: "2348055667788",
        imageUrl: "/uploads/camera.jpg", timestamp: Date.now(), sellerId: "user_demo_3"
    },
    {
        name: "Unisex Ray-Ban Sunglasses", description: "Original Ray-Ban Wayfarer sunglasses...",
        price: 32000, category: "Fashion & Accessories", condition: "Used - Excellent", negotiable: true,
        location: "Enugu", paymentOption: "Full Payment", sellerWhatsApp: "2347067890123",
        imageUrl: "/uploads/sunglasses.jpg", timestamp: Date.now(), sellerId: "user_demo_1"
    },
    {
        name: "Gaming Laptop (RTX 4070)", description: "High-performance gaming laptop with NVIDIA RTX 4070 GPU...",
        price: 1200000, category: "Electronics & Gadgets", condition: "Used - Very Good", negotiable: false,
        location: "Lagos", paymentOption: "Full Payment", sellerWhatsApp: "2348123456789",
        imageUrl: "/uploads/laptop.jpg", timestamp: Date.now(), sellerId: "user_demo_2"
    },
    {
        name: "Fresh Tomatoes (Basket)", description: "A full basket of fresh, ripe, organic tomatoes...",
        price: 8000, category: "Foodstuff", condition: "New", negotiable: true,
        location: "Kano", paymentOption: "Full Payment", sellerWhatsApp: "2349011223344",
        imageUrl: "/uploads/tomatoes.jpg", timestamp: Date.now(), sellerId: "user_demo_1"
    },
    {
        name: "Elegant Pearl Earrings", description: "Handcrafted freshwater pearl earrings with sterling silver settings...",
        price: 15000, category: "Fashion & Accessories", condition: "New", negotiable: false,
        location: "Benin City", paymentOption: "Full Payment", sellerWhatsApp: "2348033445566",
        imageUrl: "/uploads/earrings.jpg", timestamp: Date.now(), sellerId: "user_demo_4"
    },
    {
        name: "iPhone 15 Pro Max (256GB)", description: "Latest iPhone 15 Pro Max, 256GB, Pacific Blue...",
        price: 1150000, category: "Phones & Tablets", condition: "Used - Pristine", negotiable: false,
        location: "Lagos", paymentOption: "Down Payment Accepted", sellerWhatsApp: "2348077889900",
        imageUrl: "/uploads/iphone.jpg", timestamp: Date.now(), sellerId: "user_demo_1"
    },
    {
        name: "Android Tablet (10-inch)", description: "Lightly used 10-inch Android tablet...",
        price: 60000, category: "Phones & Tablets", condition: "Used - Good", negotiable: true,
        location: "Enugu", paymentOption: "Full Payment", sellerWhatsApp: "2349022334455",
        imageUrl: "/uploads/tablet.jpg", timestamp: Date.now(), sellerId: "user_demo_2"
    }
];

function seedDemoProducts() {
    db.serialize(() => {
        const stmt = db.prepare(`INSERT INTO products (name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp, sellerId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        demoProducts.forEach(p => {
            stmt.run(p.name, p.description, p.price, p.category, p.condition, p.negotiable, p.location, p.paymentOption, p.sellerWhatsApp, p.imageUrl, p.timestamp, p.sellerId, (err) => {
                if (err) {
                    console.error("Error inserting demo product:", err.message);
                }
            });
        });
        stmt.finalize(() => {
            console.log("Demo products seeded.");
        });
    });
}

// Function to get MIME type based on file extension
const getContentType = (filePath) => {
    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.ico': 'image/x-icon'
    };
    return mimeTypes[extname] || 'application/octet-stream';
};

// Create HTTP server to serve static files
const httpServer = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html'; // Serve index.html by default
    } else if (filePath.startsWith('./uploads/')) {
        // Ensure that requests for /uploads are served from the correct directory
        filePath = path.join(__dirname, filePath);
    } else {
        // Serve other files from the root directory
        filePath = path.join(__dirname, filePath);
    }

    const contentType = getContentType(filePath);

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/html' });
                res.end(`<h1>500 Internal Server Error: ${error.code}</h1>`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

// WebSocket Server
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', ws => {
    console.log('Client connected via WebSocket.');

    // Send all current products to the newly connected client
    db.all("SELECT * FROM products ORDER BY timestamp DESC", [], (err, rows) => {
        if (err) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to retrieve products from database.' }));
            return;
        }
        ws.send(JSON.stringify({ type: 'ALL_PRODUCTS', products: rows }));
    });

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data.type, data);

            if (data.type === 'ADD_PRODUCT') {
                const { name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, sellerId } = data.product;
                const timestamp = Date.now(); // Always use current time for new products

                let savedImageUrl = imageUrl;
                if (imageUrl && imageUrl.startsWith('data:image/')) {
                    const base64Data = imageUrl.split(',')[1];
                    const extension = imageUrl.substring(imageUrl.indexOf('/') + 1, imageUrl.indexOf(';'));
                    const filename = `product_${timestamp}_${Math.random().toString(36).substring(2, 8)}.${extension}`;
                    const filePath = path.join(UPLOADS_DIR, filename);
                    fs.writeFile(filePath, base64Data, 'base64', (err) => {
                        if (err) {
                            console.error('Error saving image:', err.message);
                            savedImageUrl = 'https://placehold.co/400x300/E0E0E0/666666?text=Image+Error'; // Fallback
                        } else {
                            savedImageUrl = `/uploads/${filename}`; // Store relative path
                            console.log('Image saved to:', savedImageUrl);
                        }
                        // Now save product to DB and broadcast
                        saveProductToDb(data.product, savedImageUrl, timestamp);
                    });
                } else {
                    saveProductToDb(data.product, imageUrl, timestamp); // Use original imageUrl if not base64
                }

            } else if (data.type === 'UPDATE_PRODUCT') {
                const { id, name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl } = data.product;
                const updateTimestamp = Date.now(); // Update timestamp on product modification

                let updatedImageUrl = imageUrl;
                if (imageUrl && imageUrl.startsWith('data:image/')) {
                    const base64Data = imageUrl.split(',')[1];
                    const extension = imageUrl.substring(imageUrl.indexOf('/') + 1, imageUrl.indexOf(';'));
                    const filename = `product_update_${updateTimestamp}_${id}.${extension}`;
                    const filePath = path.join(UPLOADS_DIR, filename);
                    fs.writeFile(filePath, base64Data, 'base64', (err) => {
                        if (err) {
                            console.error('Error saving updated image:', err.message);
                            updatedImageUrl = 'https://placehold.co/400x300/E0E0E0/666666?text=Image+Error';
                        } else {
                            updatedImageUrl = `/uploads/${filename}`;
                            console.log('Updated image saved to:', updatedImageUrl);
                        }
                        updateProductInDb(id, name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, updatedImageUrl, updateTimestamp);
                    });
                } else {
                    updateProductInDb(id, name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, updateTimestamp);
                }

            } else if (data.type === 'DELETE_PRODUCT') {
                const { productId } = data;
                db.run("DELETE FROM products WHERE id = ?", productId, function(err) {
                    if (err) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: `Failed to delete product: ${err.message}` }));
                        return;
                    }
                    if (this.changes > 0) {
                        console.log(`Product ${productId} deleted.`);
                        wss.clients.forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'PRODUCT_DELETED', productId }));
                            }
                        });
                    } else {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Product not found.' }));
                    }
                });
            } else if (data.type === 'GET_ALL_PRODUCTS') {
                 db.all("SELECT * FROM products ORDER BY timestamp DESC", [], (err, rows) => {
                    if (err) {
                        ws.send(JSON.stringify({ type: 'ERROR', message: 'Failed to retrieve products.' }));
                        return;
                    }
                    ws.send(JSON.stringify({ type: 'ALL_PRODUCTS', products: rows }));
                });
            }

        } catch (e) {
            console.error('Error parsing WebSocket message or processing:', e);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid message format or server error.' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected.');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Helper function to save product to DB and broadcast
function saveProductToDb(productData, imageUrl, timestamp) {
    const { name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, sellerId } = productData;
    db.run(`INSERT INTO products (name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp, sellerId)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp, sellerId,
        function(err) {
            if (err) {
                console.error("Error inserting product:", err.message);
                return;
            }
            const newProduct = { id: this.lastID, name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp, sellerId };
            console.log(`A new product was added with ID: ${newProduct.id}`);

            // Broadcast the new product to all connected clients
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'NEW_PRODUCT', product: newProduct }));
                }
            });
        }
    );
}

// Helper function to update product in DB and broadcast
function updateProductInDb(id, name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp) {
    db.run(`UPDATE products SET name = ?, description = ?, price = ?, category = ?, condition = ?, negotiable = ?, location = ?, paymentOption = ?, sellerWhatsApp = ?, imageUrl = ?, timestamp = ? WHERE id = ?`,
        name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp, id,
        function(err) {
            if (err) {
                console.error("Error updating product:", err.message);
                return;
            }
            if (this.changes > 0) {
                const updatedProduct = { id, name, description, price, category, condition, negotiable, location, paymentOption, sellerWhatsApp, imageUrl, timestamp };
                console.log(`Product ${id} updated.`);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'PRODUCT_UPDATED', product: updatedProduct }));
                    }
                });
            } else {
                console.warn(`Attempted to update product ${id}, but it was not found.`);
            }
        }
    );
}

// Start the HTTP server
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
