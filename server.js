const express = require('express');
const path = require('path');
const axios = require('axios');

const app = express();
app.use(express.json());

// === Serve frontend ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === Production MPesa / Daraja config ===
const CONSUMER_KEY = 'gj230a8RAQZZVACSCafk1rjoeLISsg9LXTFkRftwigdDxKT8';
const CONSUMER_SECRET = 'bDQWzIs3d3rpDDiX6BqLixZ3HAoCUoo2ZN77wQ3oa4k3GdgAz9ZhP67K22VgEO12';
const SHORTCODE = '5687502';        // e.g. 174379
const PASSKEY = 'fc4f2cf850d54d271f1d828247ce3b6fa913f7f8b67d6f5ce97b3ae89527319d';
const CALLBACK_URL = 'https://mpesa-stk-olive.vercel.app/process-mpesa-callback';  // Must be HTTPS

// Key endpoints from Daraja (production)
const OAUTH_URL = 'https://api.safaricom.co.ke/oauth/v1/generate';
const STK_PUSH_URL = 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

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
      TransactionType: 'CustomerBuyGoodsOnline', // 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: '4959216',// SHORTCODE,
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

    return res.json({
      success: true,
      message: stkResp.data.CustomerMessage || 'STK Push request accepted'
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

// Callback endpoint
app.post('/process-mpesa-callback', (req, res) => {
  console.log('Received M-Pesa Callback:');
  //console.dir(req.body, { depth: null });
  console.log(req.body);
  // Respond to Safaricom immediately to avoid timeout
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Callback received successfully' });
});

// Start server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

