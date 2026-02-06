const { Pool } = require('pg');

/*
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'jikoni',
  password: process.env.DB_PASSWORD || 'Pass_123',
  port: process.env.DB_PORT || 5432,
});
*/


const db = new Pool({

host: 'ep-sweet-thunder-a50yx78z-pooler.us-east-2.aws.neon.tech',
database:'master_db',
user: 'master_db_owner',
password: 'FV4RGtQmS6dL',

ssl: {
  rejectUnauthorized: false, // Option to allow self-signed certificates if necessary
},

  /*
  host: 'localhost',           // PostgreSQL host (usually localhost)
  user: 'postgres',            // PostgreSQL username (adjust as needed)
  password: 'yqY7xb#007@immah', // Your actual PostgreSQL password
  database: 'master_db',       // Your actual database name
  port: 5432,                  // Default PostgreSQL port
  max: 10,                     // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,  */  // Close idle clients after 30 seconds
});

// Test connection
db.query('SELECT NOW()', (err, res) => {
  if (err) console.error('PostgreSQL connection error:', err);
  else console.log('Connected to PostgreSQL at:', res.rows[0].now);
});

module.exports = { db };



