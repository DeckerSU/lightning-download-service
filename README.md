# Lightning Download Service

**Lightning Download Service** is an easy-to-use application that enables you to create a "download-after-pay" service using the [GetAlby API](https://getalby.com/) and Bitcoin Lightning payments. This application allows users to purchase files by paying with Lightning Satoshis and download them immediately after the payment is confirmed.

**Note:** This project is a Proof of Concept (PoC). Use it in production at your own risk.

## Features

- **Lightning Network Payments:** Accept payments via the Bitcoin Lightning Network for quick and low-fee transactions.
- **GetAlby API Integration:** Utilize the GetAlby API to create and manage Lightning invoices seamlessly.
- **Download After Pay:** Automatically provide users with a download link upon successful payment.
- **Easy Setup:** Simple configuration with minimal dependencies.
- **Customizable:** Modify the list of available files and pricing through a configuration file.

## How It Works

1. **User Selects a File:**
   - Users browse the list of available files and select one to purchase.

2. **Invoice Generation:**
   - Upon selection, the application generates a Lightning Network invoice using the GetAlby API.

3. **Payment Process:**
   - The user pays the invoice using a Lightning-compatible wallet.

4. **Payment Confirmation:**
   - The application checks the payment status via the GetAlby API.

5. **File Download:**
   - After payment is confirmed, the user receives a one-time download link for the purchased file.

---

## Installation and Setup

### Prerequisites

- **Node.js v18.20.4**
- **npm** (Node Package Manager)
- **Docker** (optional, for containerized deployment)

### Clone the Repository

```bash
git clone https://github.com/DeckerSU/lightning-download-service.git
cd lightning-download-service
```

### Install Dependencies

```bash
npm install
```

### Configuration

1. **GetAlby API Key:**
   - Obtain an API key from [GetAlby](https://getalby.com/).
   - Create a `.env` file in the project root and add your API key:

     ```bash
     ALBY_API_KEY=your_alby_api_key
     ```

2. **Configure Available Files:**
   - Edit the `config.json` file to specify the files available for purchase and their prices:

     ```json
     {
       "files": [
         { "id": 1, "name": "file1.pdf", "priceSats": 10000 },
         { "id": 2, "name": "file2.pdf", "priceSats": 20000 }
       ]
     }
     ```

3. **Place Files in the `files` Directory:**
   - Add the files you want to sell into the `files` directory.

### Running the Application

#### Without Docker

```bash
node app.js
```

#### With Docker

1. **Build the Docker Image:**

   ```bash
   docker build -t lightning-download-service .
   ```

2. **Run the Docker Container:**

   ```bash
   docker run --rm -d -p 3000:3000 \
     -v $(pwd)/config.json:/usr/src/app/config.json \
     -v $(pwd)/files:/usr/src/app/files \
     -v $(pwd)/data:/usr/src/app/data \
     --env-file .env \
     --user $(id -u):$(id -g) \
     --name lightning-download-service \
     lightning-download-service
   ```

## Usage

- **Access the Service:**
  - Navigate to `http://localhost:3000` in your web browser.

- **Purchase a File:**
  - Select a file and click "Purchase."
  - A QR code and Lightning invoice will be displayed.

- **Complete Payment:**
  - Pay the invoice using a Lightning-compatible wallet (e.g., [Muun Wallet](https://muun.com/)).

- **Download the File:**
  - After payment confirmation, a download link will appear.
  - Click the link to download your file.
  - **Note:** The download link is valid for a single use.


## Important Notes

- **Proof of Concept:**
  - This application is a Proof of Concept and may not be production-ready.
  - Use it in production environments at your own risk.

- **Data Persistence:**
  - Invoices and download tokens are stored using SQLite3.
  - Ensure proper backups and data management if used in production.

## Technologies Used

- **Node.js**: Server-side JavaScript runtime.
- **Express.js**: Web framework for Node.js.
- **SQLite3**: Lightweight relational database for storing invoices and tokens.
- **GetAlby API**: For creating and checking Lightning Network invoices.
- **Bitcoin Lightning Network**: For fast and low-fee Bitcoin payments.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request with your enhancements.

## License

This project is licensed under the MIT License.

## Disclaimer

The Lightning Download Service is provided "as is," without warranty of any kind. The developers are not responsible for any loss or damage resulting from the use of this application. Users are responsible for ensuring compliance with all legal and regulatory requirements in their jurisdiction.

If you have any questions or need assistance, feel free to open an issue on GitHub.
