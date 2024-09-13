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

// In-memory storage (replace with a database in production)
let invoices = {}; // payment_hash => { fileId, paid, payment_request }
let downloadTokens = {}; // token => { fileId, expires }

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

  // Limit outstanding invoices per IP
  const userInvoices = Object.values(invoices).filter(
    (inv) => inv.userKey === req.ip && !inv.paid && inv.expiresAt > Date.now()
  );

  if (userInvoices.length >= LIMIT_OUTSTANDING_INVOICES) {
    return res.status(429).json({ error: 'Too many outstanding invoices.' });
  }

  try {
    const invoice = await createInvoice(file.priceSats, `Purchase of ${file.name}`);

    const new_invoice = {
      fileId,
      paid: false,
      payment_request: invoice.payment_request,
      createdAt: Date.now(),
      expiresAt: Date.now() + invoice.expiry * 1000, // expiry in milliseconds
      userKey,
    };

    invoices[invoice.payment_hash] = new_invoice;

    res.json({
      payment_request: invoice.payment_request,
      payment_hash: invoice.payment_hash,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

// API route to check payment status
app.post('/check-payment', apiLimiter, async (req, res) => {
  const payment_hash = req.body.payment_hash;
  const invoice = invoices[payment_hash];

  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  if (invoice.paid) {
    const downloadToken = generateDownloadToken(invoice.fileId);
    return res.json({ paid: true, downloadToken });
  }

  try {
    const paymentStatus = await checkPaymentStatus(payment_hash);

    if (paymentStatus.paid) {
      invoice.paid = true;
      const downloadToken = generateDownloadToken(invoice.fileId);
      res.json({ paid: true, downloadToken });
    } else {
      res.json({ paid: false });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to check payment status' });
  }
});

// API route to handle file downloads
app.get('/download', apiLimiter, (req, res) => {
  const token = req.query.token;
  const tokenData = downloadTokens[token];

  if (!tokenData) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  if (tokenData.expires < Date.now()) {
    delete downloadTokens[token];
    return res.status(403).json({ error: 'Token expired' });
  }

  const file = config.files.find((f) => f.id === tokenData.fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  const filePath = path.join(__dirname, 'files', file.name);
  res.download(filePath, file.name, (err) => {
    if (err) {
      console.error(err);
      res.status(500).end();
    } else {
      delete downloadTokens[token]; // Optionally delete the token after download
    }
  });
});

// New Endpoint: /stats
app.get('/stats', apiLimiter, (req, res) => {
  const invoicesCount = Object.keys(invoices).length;
  const tokensCount = Object.keys(downloadTokens).length;

  // Estimate memory usage
  const invoicesSize = roughSizeOfObject(invoices);
  const tokensSize = roughSizeOfObject(downloadTokens);

  res.json({
    invoicesCount,
    tokensCount,
    invoicesSizeBytes: invoicesSize,
    tokensSizeBytes: tokensSize,
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

const generateDownloadToken = (fileId) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 60 * 60 * 1000; // Token valid for 1 hour
  downloadTokens[token] = { fileId, expires };
  return token;
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
function cleanUpInvoices() {
  const now = Date.now();
  for (const [hash, invoice] of Object.entries(invoices)) {
    if (invoice.paid) {
      delete invoices[hash];
    } else if (invoice.expiresAt < now) {
      delete invoices[hash];
    }
  }
}

// Catch-all route to serve 'index.html' for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Schedule the cleanup to run periodically
setInterval(cleanUpInvoices, 60 * 60 * 1000); // Every hour

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});

