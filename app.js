// app.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const util = require('util'); // For memory size calculation

const app = express();
const port = 3000;

const LIMIT_OUTSTANDING_INVOICES = 100;
const LIMIT_PURCHASE_REQUESTS = 5; // per minute
const LIMIT_ALL_REQUESTS = 240;

const config = require('./config.json');

// Import sqlite3 and Set Up the Database Connection
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./data/database.sqlite');
// Create the Necessary Tables
db.serialize(() => {
  // Create invoices table
  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      payment_hash TEXT PRIMARY KEY,
      file_id INTEGER,
      paid INTEGER,
      payment_request TEXT,
      created_at INTEGER,
      expires_at INTEGER,
      ip_address TEXT
    )
  `);

  // Create download_tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS download_tokens (
      token TEXT PRIMARY KEY,
      file_id INTEGER,
      expires INTEGER
    )
  `);
});

app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

const rateLimit = require('express-rate-limit');

// Apply to /purchase endpoint
const purchaseLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: LIMIT_PURCHASE_REQUESTS, // limit each IP to LIMIT_PURCHASE_REQUESTS requests per windowMs
  message: {
    error: 'Too many requests, please try again later.',
  },
});

// Apply rate limiting to all API routes
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: LIMIT_ALL_REQUESTS, // limit each IP to LIMIT_ALL_REQUESTS requests per windowMs
  message: {
    error: 'Too many requests, please try again later.',
  },
});

// API route to get the list of files
app.get('/files', (req, res) => {
  res.json(config.files);
});

// API route to create a purchase invoice
app.post('/purchase', purchaseLimiter, async (req, res) => {

  const userKey = req.ip; // Or use user ID if authenticated
  const fileId = req.body.fileId;
  const file = config.files.find((f) => f.id === fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Get the current timestamp
  const now = Date.now();

  // Query the database to count outstanding invoices for the IP
  db.get(
    `SELECT COUNT(*) AS count FROM invoices WHERE ip_address = ? AND paid = 0 AND expires_at > ?`,
    [req.ip, now],
    (err, row) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Database error' });
      }

      const outstandingInvoices = row.count;

      if (outstandingInvoices >= LIMIT_OUTSTANDING_INVOICES) {
        return res.status(429).json({ error: 'Too many outstanding invoices.' });
      }

      // Proceed to create the invoice
      createInvoice(file.priceSats, `Purchase of ${file.name}`)
        .then((invoice) => {
          // Save the invoice in the database
          db.run(
            `INSERT INTO invoices (payment_hash, file_id, paid, payment_request, created_at, expires_at, ip_address)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              invoice.payment_hash,
              fileId,
              0, // paid is false (0)
              invoice.payment_request,
              now,
              now + (invoice.expiry || 3600) * 1000,
              req.ip,
            ],
            function (err) {
              if (err) {
                console.error(err.message);
                return res.status(500).json({ error: 'Failed to save invoice' });
              }

              res.json({
                payment_request: invoice.payment_request,
                payment_hash: invoice.payment_hash,
              });
            }
          );
        })
        .catch((error) => {
          console.error(error.response ? error.response.data : error.message);
          res.status(500).json({ error: 'Failed to create invoice' });
        });
    }
  );
});

// API route to check payment status
app.post('/check-payment', (req, res) => {
  const payment_hash = req.body.payment_hash;

  // Retrieve the invoice from the database
  db.get(
    `SELECT * FROM invoices WHERE payment_hash = ?`,
    [payment_hash],
    (err, invoice) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Failed to retrieve invoice' });
      }

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      if (invoice.paid) {
        generateDownloadToken(invoice.file_id, (err, downloadToken) => {
          if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Failed to generate download token' });
          }

          res.json({ paid: true, downloadToken });
        });
      } else {
        // Check payment status
        checkPaymentStatus(payment_hash)
          .then((paymentStatus) => {
            if (paymentStatus.paid) {
              // Update the invoice as paid
              db.run(
                `UPDATE invoices SET paid = 1 WHERE payment_hash = ?`,
                [payment_hash],
                (err) => {
                  if (err) {
                    console.error(err.message);
                    return res.status(500).json({ error: 'Failed to update invoice' });
                  }

                  generateDownloadToken(invoice.file_id, (err, downloadToken) => {
                    if (err) {
                      console.error(err.message);
                      return res.status(500).json({ error: 'Failed to generate download token' });
                    }

                    res.json({ paid: true, downloadToken });
                  });
                }
              );
            } else {
              res.json({ paid: false });
            }
          })
          .catch((error) => {
            console.error(error.response ? error.response.data : error.message);
            res.status(500).json({ error: 'Failed to check payment status' });
          });
      }
    }
  );
});

// API route to handle file downloads
app.get('/download', apiLimiter, (req, res) => {
  const token = req.query.token;

  // Retrieve the token data from the database
  db.get(
    `SELECT * FROM download_tokens WHERE token = ?`,
    [token],
    (err, tokenData) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Failed to retrieve download token' });
      }

      if (!tokenData) {
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      if (tokenData.expires < Date.now()) {
        // Delete the expired token
        db.run(`DELETE FROM download_tokens WHERE token = ?`, [token], (err) => {
          if (err) {
            console.error(err.message);
          }
        });
        return res.status(403).json({ error: 'Token expired' });
      }

      const file = config.files.find((f) => f.id === tokenData.file_id);

      if (!file) {
        return res.status(404).json({ error: 'File not found' });
      }

      const filePath = path.join(__dirname, 'files', file.name);
      res.download(filePath, file.name, (err) => {
        if (err) {
          console.error(err);
          res.status(500).end();
        } else {
          // Optionally delete the token after download
          db.run(`DELETE FROM download_tokens WHERE token = ?`, [token], (err) => {
            if (err) {
              console.error(err.message);
            }
          });
        }
      });
    }
  );
});

// New Endpoint: /stats
app.get('/stats', (req, res) => {
  db.serialize(() => {
    db.get(`SELECT COUNT(*) AS invoicesCount FROM invoices`, (err, invoicesRow) => {
      if (err) {
        console.error(err.message);
        return res.status(500).json({ error: 'Failed to retrieve invoices count' });
      }

      db.get(`SELECT COUNT(*) AS tokensCount FROM download_tokens`, (err, tokensRow) => {
        if (err) {
          console.error(err.message);
          return res.status(500).json({ error: 'Failed to retrieve tokens count' });
        }

        res.json({
          invoicesCount: invoicesRow.invoicesCount,
          tokensCount: tokensRow.tokensCount,
        });
      });
    });
  });
});

// Helper functions

const createInvoice = async (amountSats, memo) => {
  const apiKey = process.env.ALBY_API_KEY;

  const response = await axios.post(
    'https://api.getalby.com/invoices',
    { amount: amountSats, memo },
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );

  return response.data;
};

const checkPaymentStatus = async (payment_hash) => {
  const apiKey = process.env.ALBY_API_KEY;

  const response = await axios.get(
    `https://api.getalby.com/invoices/${payment_hash}`,
    {
    headers: { Authorization: `Bearer ${apiKey}` },
    }
  );

  const invoiceData = response.data;

  // Check if the invoice is settled
  const isPaid = invoiceData.settled === true && invoiceData.state === 'SETTLED';

  return { paid: isPaid };
};

const generateDownloadToken = (fileId, callback) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 60 * 60 * 1000; // Token valid for 1 hour

  db.run(
    `INSERT INTO download_tokens (token, file_id, expires)
     VALUES (?, ?, ?)`,
    [token, fileId, expires],
    function (err) {
      if (err) {
        console.error(err.message);
        return callback(err);
      }
      callback(null, token);
    }
  );
};

// Function to estimate the memory size of an object
function roughSizeOfObject(object) {
  const objectList = [];
  const stack = [object];
  let bytes = 0;

  while (stack.length) {
    const value = stack.pop();

    if (typeof value === 'boolean') {
      bytes += 4;
    } else if (typeof value === 'string') {
      bytes += value.length * 2;
    } else if (typeof value === 'number') {
      bytes += 8;
    } else if (typeof value === 'object' && value !== null && !objectList.includes(value)) {
      objectList.push(value);
      for (const i in value) {
        stack.push(value[i]);
      }
    }
  }
  return bytes;
}

function convertTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date.toISOString();
}

// Function to clean up expired invoices
function cleanUpExpiredData() {
  const now = Date.now();

  // Delete expired unpaid invoices
  db.run(`DELETE FROM invoices WHERE paid = 0 AND expires_at < ?`, [now], (err) => {
    if (err) {
      console.error(err.message);
    }
  });

  // Delete expired download tokens
  db.run(`DELETE FROM download_tokens WHERE expires < ?`, [now], (err) => {
    if (err) {
      console.error(err.message);
    }
  });
}

// Catch-all route to serve 'index.html' for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Schedule the cleanup to run periodically
setInterval(cleanUpExpiredData, 60 * 60 * 1000); // Every hour

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

