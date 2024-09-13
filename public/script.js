/* public/script.js */

// Fetch and display the list of files
document.addEventListener('DOMContentLoaded', () => {
  fetch('/files')
    .then((response) => response.json())
    .then((files) => {
      const fileList = document.getElementById('file-list');
      files.forEach((file) => {
        const fileCard = document.createElement('div');
        fileCard.className = 'file-card';
        fileCard.innerHTML = `
          <h2>${file.name}</h2>
          <p>Price: ${file.priceSats} sats</p>
          <button data-file-id="${file.id}">Purchase</button>
        `;
        fileList.appendChild(fileCard);
      });

      // Add event listeners to purchase buttons
      const purchaseButtons = document.querySelectorAll('.file-card button');
      purchaseButtons.forEach((button) => {
        button.addEventListener('click', (e) => {
          const fileId = e.target.getAttribute('data-file-id');
          initiatePurchase(fileId);
        });
      });
    })
    .catch((error) => {
      console.error('Error fetching files:', error);
    });
});

// Handle the purchase process
function initiatePurchase(fileId) {
  fetch('/purchase', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fileId: parseInt(fileId) })
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.payment_request) {
        showModal(data.payment_request, data.payment_hash, fileId);
      } else {
        alert('Failed to create invoice.');
      }
    })
    .catch((error) => {
      console.error('Error initiating purchase:', error);
    });
}

// Show the modal with the invoice QR code
function showModal(paymentRequest, paymentHash, fileId) {
  const modal = document.getElementById('purchase-modal');
  const modalBody = document.getElementById('modal-body');
  modal.style.display = 'block';

  modalBody.innerHTML = `
    <h2>Complete Payment</h2>
    <p>Scan the QR code or copy the invoice to pay.</p>
    <div id="qrcode"></div>
    <label for="invoice-text">Lightning invoice:</label>
    <textarea id="invoice-text" readonly>${paymentRequest}</textarea>
    <p id="status">Waiting for payment...</p>
  `;

  // Generate QR code
  const qrCode = new QRCode(document.getElementById('qrcode'), {
    text: paymentRequest,
    width: 256,
    height: 256
  });

  // Close modal functionality
  const closeModal = document.getElementById('close-modal');
  closeModal.onclick = () => {
    modal.style.display = 'none';
    modalBody.innerHTML = '';
    clearInterval(pollingInterval);
  };

  // Poll for payment confirmation
  const pollingInterval = setInterval(() => {
    checkPaymentStatus(paymentHash, fileId, modalBody, pollingInterval);
  }, 5000);
}

// Check payment status
function checkPaymentStatus(paymentHash, fileId, modalBody, pollingInterval) {
  fetch('/check-payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ payment_hash: paymentHash })
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.paid) {
        clearInterval(pollingInterval);
        showDownloadLink(data.downloadToken, fileId, modalBody);
      }
    })
    .catch((error) => {
      console.error('Error checking payment status:', error);
    });
}

// Show the download link after payment confirmation
function showDownloadLink(downloadToken, fileId, modalBody) {
  modalBody.innerHTML = `
    <h2>Payment Confirmed!</h2>
    <p>You can now download your file.</p>
    <button id="download-button">Download</button>
  `;

  const downloadButton = document.getElementById('download-button');
  downloadButton.onclick = () => {
    window.location.href = `/download?token=${downloadToken}`;
  };
}

// Close modal when clicking outside of it
window.onclick = (event) => {
  const modal = document.getElementById('purchase-modal');
  if (event.target === modal) {
    modal.style.display = 'none';
    document.getElementById('modal-body').innerHTML = '';
    clearInterval(pollingInterval);
  }
};
