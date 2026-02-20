const express = require('express');
const path = require('path');
const axios = require('axios');
const { db } = require('./services/db');

const app = express();
app.use(express.json());

// === Serve frontend ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/luo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'll.html'));
});

// === Production MPesa / Daraja config ===
const CONSUMER_KEY = 'gj230a8RAQZZVACSCafk1rjoeLISsg9LXTFkRftwigdDxKT8';
const CONSUMER_SECRET = 'bDQWzIs3d3rpDDiX6BqLixZ3HAoCUoo2ZN77wQ3oa4k3GdgAz9ZhP67K22VgEO12';
const SHORTCODE = '5687502';        // e.g. 174379
const PASSKEY = 'fc4f2cf850d54d271f1d828247ce3b6fa913f7f8b67d6f5ce97b3ae89527319d';
const CALLBACK_URL = 'https://mpesa-stk-olive.vercel.app/process-mpesa-callback';  // Must be HTTPS
const CONFIRMATION_URL = 'https://mpesa-stk-olive.vercel.app/customer-payment-confirmation'

// Key endpoints from Daraja (production)
const OAUTH_URL = 'https://api.safaricom.co.ke/oauth/v1/generate';
const STK_PUSH_URL = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

// Pull Transactions API (Production)
const PULL_REGISTER_URL = 'https://api.safaricom.co.ke/pulltransactions/v1/register';
const PULL_QUERY_URL = 'https://api.safaricom.co.ke/pulltransactions/v1/query';


// Utility: timestamp in YYYYMMDDHHmmss
function getTimestamp() {
  const dt = new Date();
  const YYYY = dt.getFullYear().toString();
  const MM = String(dt.getMonth() + 1).padStart(2, '0');
  const DD = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${YYYY}${MM}${DD}${hh}${mm}${ss}`;
}

// Fetch access token
async function getAccessToken() {
  const credentials = `${CONSUMER_KEY}:${CONSUMER_SECRET}`;
  const encoded = Buffer.from(credentials).toString('base64');
  const authHeader = `Basic ${encoded}`;
  const url = `${OAUTH_URL}?grant_type=client_credentials`;

  console.log('[Token] Requesting token:', url);
  console.log('[Token] Auth header:', authHeader);

  try {
    const resp = await axios.get(url, {
      headers: {
        Authorization: authHeader
      }
    });

    console.log('[Token] Response:', resp.data);

    if (!resp.data.access_token) {
      throw new Error('No access_token in response: ' + JSON.stringify(resp.data));
    }
    return resp.data.access_token;
  } catch (err) {
    console.error('[Token] Error fetching token:', err.response?.data || err.message);
    throw err;
  }
}

// Handle STK Push
app.post('/stkpush', async (req, res) => {
  const { phone, amount } = req.body;

  if (!phone || !amount) {
    return res.status(400).json({ success: false, error: 'Phone and amount are required.' });
  }

  try {
    const token = await getAccessToken();
    const timestamp = getTimestamp();
    const passwordPlain = SHORTCODE + PASSKEY + timestamp;
    const password = Buffer.from(passwordPlain).toString('base64');

    const payload = {
      BusinessShortCode:  SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', // 'CustomerBuyGoodsOnline', // 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: '5687502', // '4959216',// SHORTCODE, 5467496
      PhoneNumber: phone,
      CallBackURL: CALLBACK_URL,
      AccountReference: 'Merchant Store here',
      TransactionDesc: 'Payment for Order'
    };

    console.log('[STK] Payload:', payload);

    const stkResp = await axios.post(STK_PUSH_URL, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('[STK] Response data:', stkResp.data);
    //insert into database
    const insertQuery = `
  INSERT INTO mpesa_transactions_general (merchant_request_id, checkout_request_id, response_code)
  VALUES ($1, $2, 808080)
  RETURNING *
`;

const values = [stkResp.data.MerchantRequestID, stkResp.data.CheckoutRequestID];

const { rows } = await db.query(insertQuery, values);
console.log('Inserted transaction:', rows[0]);
///done inserting into db

    return res.json({
      success: true,
      data: {
        message: stkResp.data.CustomerMessage || 'STK Push request accepted',
        checkoutRequestID: stkResp.data.CheckoutRequestID,
        merchantRequestID: stkResp.data.MerchantRequestID,
        statusCode: stkResp.data.ResponseCode
      }
    });

  } catch (err) {
    console.error('[STK] Error during STK Push:', err.response?.data || err.message);

    const errMessage = err.response?.data?.errorMessage 
      || err.response?.data?.error 
      || 'STK Push failed';

    return res.status(500).json({
      success: false,
      error: errMessage
    });
  }
});

//give transaction feedback when frontend sends feedback request
app.post('/check-transaction-status', async (req, res) => {
  console.log(req.body);
  const { checkoutRequestID, merchantRequestID } = req.body;

  if (!checkoutRequestID || !merchantRequestID) {
    return res.status(400).json({
      success: false,
      message: 'checkoutRequestId and merchantRequestId are required',
    });
  }

  try {
    // Query transaction from database
    const query = `
      SELECT response_code, transaction_data
      FROM mpesa_transactions_general
      WHERE checkout_request_id = $1
        AND merchant_request_id = $2
      LIMIT 1
    `;

    const { rows } = await db.query(query, [
      checkoutRequestID,
      merchantRequestID,
    ]);

    console.log(rows);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    const resultCode = Number(rows[0].response_code);
    let message = 'Unknown transaction status';
    let success = false;
    let data = {};

    // Interpret ResultCode
    switch (resultCode) {
      case 0:
        success = true;
        message = 'Payment successful';
        data = rows[0].transaction_data;
        break;
      case 1:
        message = 'Insufficient balance or overdraft declined';
        break;
      case 1001:
        message = 'Subscriber locked or conflicting session';
        break;
      case 1019:
        message = 'Transaction expired';
        break;
      case 1025:
        message = 'Error sending push request';
        break;
      case 1032:
        message = 'User cancelled the request';
        break;
      case 1037:
        message = 'User unreachable or device/server timeout';
        break;
      case 9999:
        message = 'General push request error';
        break;
      default:
        message = 'Unrecognized transaction result code';
        break;
    }

    return res.status(200).json({
      success,
      resultCode,
      message,
      data,
    });
  } catch (error) {
    console.error('Error checking transaction status:', error);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});



// Callback endpoint
app.post('/process-mpesa-callback', async (req, res) => {
  console.log('Received M-Pesa Callback:');
  //console.dir(req.body, { depth: null });
  console.log(req.body);
  // Respond to Safaricom immediately to avoid timeout
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received successfully' });


  //record status to database
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      console.error('Invalid MPESA callback structure');
      return;
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata,
    } = callback;

    // Prepare transaction_data object
    let transactionData = {};

    if (CallbackMetadata?.Item) {
      // Convert array of items into a simple key-value object
      CallbackMetadata.Item.forEach(item => {
        transactionData[item.Name] = item.Value;
      });
    }

    // Add raw callback for full audit trail
    transactionData.rawCallback = callback;

    // Update the transaction record
    const updateQuery = `
      UPDATE mpesa_transactions_general
      SET
        response_code = $1,
        transaction_data = $2
      WHERE merchant_request_id = $3
        AND checkout_request_id = $4
    `;

    await db.query(updateQuery, [
      ResultCode,
      transactionData,
      MerchantRequestID,
      CheckoutRequestID,
    ]);

  } catch (error) {
    console.error('Error processing MPESA callback:', error);
  }
});

function getLast48HoursRange() {
  const now = new Date();
  const past = new Date(now.getTime() - (48 * 60 * 60 * 1000));

  const format = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

  return {
    startDate: format(past),
    endDate: format(now)
  };
}



app.get('/pull-last-48hrs', async (req, res) => {
  try {
    const token = await getAccessToken();
    const { startDate, endDate } = getLast48HoursRange();

    const response = await axios.get(PULL_QUERY_URL, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      params: {
        ShortCode: SHORTCODE,
        StartDate: startDate,
        EndDate: endDate,
        OffSetValue: 0
      }
    });
    console.log(response)
    res.json(response.data);

  } catch (error) {
    console.error("Auto 48hr Pull Error:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});


const REGISTER_URL = 'https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl';
const C2B_REGISTER_URL = 'https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl';

app.get('/register-c2b-no-validation', async (req, res) => {
  try {
    const token = await getAccessToken();

    const payload = {
      ShortCode: SHORTCODE,
      ResponseType: "Completed", // VERY IMPORTANT
      ConfirmationURL: CONFIRMATION_URL,
      ValidationURL: "" // Leave empty to disable validation
    };

    const response = await axios.post(C2B_REGISTER_URL, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("C2B Register Response:", response.data);
    res.json(response.data);

  } catch (error) {
    console.error("C2B Register Error:", error.response?.data || error.message);
    res.status(500).json(error.response?.data || error.message);
  }
});




// C2B Confirmation endpoint
app.post('/customer-payment-confirmation', async (req, res) => {
  console.log('C2B Confirmation received:');
  console.log(req.body);

  // Always respond immediately
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });

  try {
    const {
      TransID,
      TransTime,
      TransAmount,
      BusinessShortCode,
      BillRefNumber,
      InvoiceNumber,
      MSISDN,
      FirstName,
      MiddleName,
      LastName
    } = req.body;

    // Prepare transaction_data like you do for STK
    const transactionData = {
      TransTime,
      TransAmount,
      BusinessShortCode,
      BillRefNumber,
      InvoiceNumber,
      MSISDN,
      FirstName,
      MiddleName,
      LastName,
      rawCallback: req.body
    };

    const insertQuery = `
      INSERT INTO mpesa_transactions_general 
        (merchant_request_id, checkout_request_id, response_code, transaction_data)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (merchant_request_id) DO NOTHING
      RETURNING *
    `;

    const values = [
      TransID,        // merchant_request_id
      TransID,        // checkout_request_id (C2B has none, reuse TransID)
      0,              // response_code (success)
      transactionData // transaction_data
    ];

    const { rows } = await db.query(insertQuery, values);

    console.log("C2B transaction saved:", rows[0]);

  } catch (error) {
    console.error("Error processing C2B confirmation:", error);
  }
});




// Start server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});




