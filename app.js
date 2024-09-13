// app.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const port = 3000;

app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Sample files with their prices in satoshis
let files = [
  { id: 1, name: 'file1.pdf', priceSats: 10000 },
  { id: 2, name: 'file2.pdf', priceSats: 20000 },
];

// In-memory storage (replace with a database in production)
let invoices = {}; // payment_hash => { fileId, paid }
let downloadTokens = {}; // token => { fileId, expires }

// API route to get the list of files
app.get('/files', (req, res) => {
  res.json(files);
});

// API route to create a purchase invoice
app.post('/purchase', async (req, res) => {
  const fileId = req.body.fileId;
  const file = files.find((f) => f.id === fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const invoice = await createInvoice(file.priceSats, `Purchase of ${file.name}`);
    invoices[invoice.payment_hash] = { fileId, paid: false, payment_request: invoice.payment_request };

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
app.post('/check-payment', async (req, res) => {
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
app.get('/download', (req, res) => {
  const token = req.query.token;
  const tokenData = downloadTokens[token];

  if (!tokenData) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  if (tokenData.expires < Date.now()) {
    delete downloadTokens[token];
    return res.status(403).json({ error: 'Token expired' });
  }

  const file = files.find((f) => f.id === tokenData.fileId);

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

  const response = await axios.get(`https://api.getalby.com/payments/${payment_hash}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return response.data;
};

const generateDownloadToken = (fileId) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 60 * 60 * 1000; // Token valid for 1 hour
  downloadTokens[token] = { fileId, expires };
  return token;
};

// Catch-all route to serve 'index.html' for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
