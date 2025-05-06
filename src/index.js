const express = require('express');
const Amadeus = require('amadeus');
const { Pool } = require('pg');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const dotenv = require('dotenv');
const cors = require('cors');
const moment = require('moment-timezone');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const pool = new Pool({
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
});

const amadeus = new Amadeus({
  clientId: process.env.AMADEUS_API_KEY,
  clientSecret: process.env.AMADEUS_API_SECRET,
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.get('/', async (req, res) => {
  try {
    const userId = req.query.userId || '';
    let cart = [];
    if (userId) {
      const result = await pool.query(
        'SELECT id, origin, destination, departure_date, return_date, adults, currency_code, airline, flight_number, price FROM cart_flights WHERE user_id = $1',
        [userId]
      );
      cart = result.rows;
    }
    res.render('index', {
      userId,
      flights: [],
      cart,
      message: '',
      email: '',
      phone: '',
      origin: 'COK',
      destination: 'BOM',
      departureDate: '2025-05-10',
      adults: 1
    });
  } catch (error) {
    console.error('Error rendering index:', error);
    res.render('index', {
      userId: '',
      flights: [],
      cart: [],
      message: 'Failed to load page',
      email: '',
      phone: '',
      origin: 'CCJ',
      destination: '',
      departureDate: '',
      adults: 1
    });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { email, phone } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.render('index', {
        userId: '',
        flights: [],
        cart: [],
        message: 'Valid email is required',
        email,
        phone,
        origin: 'CCJ',
        destination: '',
        departureDate: '',
        adults: 1
      });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    let userId;
    let message;

    if (existingUser.rowCount > 0) {
      userId = existingUser.rows[0].id;
      message = `Logged in with email: ${email}`;
    } else {
      const result = await pool.query(
        'INSERT INTO users (email, phone) VALUES ($1, $2) RETURNING id',
        [email, phone || null]
      );
      userId = result.rows[0].id;
      message = `Registered with email: ${email}`;
    }

    const cartResult = await pool.query(
      'SELECT id, origin, destination, departure_date, return_date, adults, currency_code, airline, flight_number, price FROM cart_flights WHERE user_id = $1',
      [userId]
    );
    const cart = cartResult.rows;

    res.render('index', {
      userId,
      flights: [],
      cart,
      message,
      email: '',
      phone: '',
      origin: 'COK',
      destination: 'BOM',
      departureDate: '2025-05-10',
      adults: 1
    });
  } catch (error) {
    console.error('Error processing user:', error);
    res.render('index', {
      userId: '',
      flights: [],
      cart: [],
      message: 'Failed to process user: ' + error.message,
      email: req.body.email,
      phone: req.body.phone,
      origin: 'CCJ',
      destination: '',
      departureDate: '',
      adults: 1
    });
  }
});

app.post('/search', async (req, res) => {
  try {
    const { origin, destination, departureDate, adults, userId } = req.body;
    if (!origin || !destination || !departureDate) {
      return res.render('index', {
        userId,
        flights: [],
        cart: [],
        message: 'Missing required fields: origin, destination, departureDate',
        email: '',
        phone: '',
        origin,
        destination,
        departureDate,
        adults
      });
    }

    const iataCodeRegex = /^[A-Z]{3}$/;
    if (!iataCodeRegex.test(origin) || !iataCodeRegex.test(destination)) {
      return res.render('index', {
        userId,
        flights: [],
        cart: [],
        message: 'Invalid origin or destination. Use 3-letter IATA codes (e.g., CCJ).',
        email: '',
        phone: '',
        origin,
        destination,
        departureDate,
        adults
      });
    }

    const query = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults: parseInt(adults),
      currencyCode: 'INR',
      max: 10,
      includedAirlineCodes: origin === 'CCJ' ? '6E,AI,QR' : undefined,
    };

    const response = await amadeus.shopping.flightOffersSearch.get(query);
    const flights = response.data.map((flight) => {
      const itinerary = flight.itineraries[0];
      const segment = itinerary.segments[0];
      const departureTimeIST = moment(segment.departure.at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
      const arrivalTimeIST = moment(segment.arrival.at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      return {
        airline: segment.carrierCode,
        flightNumber: segment.number,
        departure: {
          airport: segment.departure.iataCode,
          timeIST: departureTimeIST,
        },
        arrival: {
          airport: segment.arrival.iataCode,
          timeIST: arrivalTimeIST,
        },
        duration: itinerary.duration,
        price: {
          total: flight.price.total,
          currency: flight.price.currency,
        },
      };
    });

    let cart = [];
    if (userId) {
      const result = await pool.query(
        'SELECT id, origin, destination, departure_date, return_date, adults, currency_code, airline, flight_number, price FROM cart_flights WHERE user_id = $1',
        [userId]
      );
      cart = result.rows;
    }

    res.render('index', {
      userId,
      flights,
      cart,
      message: '',
      email: '',
      phone: '',
      origin,
      destination,
      departureDate,
      adults
    });
  } catch (error) {
    console.error('Error fetching flights:', {
      message: error.message,
      code: error.code,
      description: error.description,
    });
    res.render('index', {
      userId: req.body.userId,
      flights: [],
      cart: [],
      message: error.description || 'Failed to fetch flights',
      email: '',
      phone: '',
      origin: req.body.origin,
      destination: req.body.destination,
      departureDate: req.body.departureDate,
      adults: req.body.adults
    });
  }
});

app.post('/cart', async (req, res) => {
  try {
    const { userId, origin, destination, departureDate, adults = 1, currencyCode = 'INR' } = req.body;

    if (!userId || !origin || !destination || !departureDate) {
      return res.status(400).json({ error: 'Missing required fields: userId, origin, destination, departureDate' });
    }
    const iataCodeRegex = /^[A-Z]{3}$/;
    if (!iataCodeRegex.test(origin) || !iataCodeRegex.test(destination)) {
      return res.status(400).json({
        error: 'Invalid origin or destination. Use 3-letter IATA airport codes (e.g., CCJ for Calicut).',
      });
    }

    const userResult = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userEmail = userResult.rows[0].email;

    const query = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults: parseInt(adults),
      currencyCode,
      max: 1,
      includedAirlineCodes: origin === 'CCJ' ? '6E,AI,QR' : undefined,
    };

    const response = await amadeus.shopping.flightOffersSearch.get(query);
    if (!response.data.length) {
      return res.status(404).json({ error: 'No flights found for the specified route' });
    }

    const flight = response.data[0];
    const itinerary = flight.itineraries[0];
    const segment = itinerary.segments[0];
    const departureTimeIST = moment(segment.departure.at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
    const arrivalTimeIST = moment(segment.arrival.at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

    await pool.query(
      `INSERT INTO cart_flights (user_id, origin, destination, departure_date, adults, currency_code, airline, flight_number, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        origin,
        destination,
        departureDate,
        adults,
        currencyCode,
        segment.carrierCode,
        segment.number,
        parseFloat(flight.price.total),
      ]
    );

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: userEmail,
      subject: `Flight Added to Cart: ${origin} to ${destination}`,
      text: `Your flight from ${origin} to ${destination} has been added to your cart.\n\nDetails:\n- Flight: ${segment.carrierCode}${segment.number}\n- Departure: ${departureTimeIST} (IST)\n- Arrival: ${arrivalTimeIST} (IST)\n- Price: ${flight.price.total} ${currencyCode}\n- Passengers: ${adults}\n\nBook now to confirm your trip!`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${userEmail} for flight added to cart: ${origin}-${destination}`);

    res.json({ success: true, message: 'Flight added to cart' });
  } catch (error) {
    console.error('Error adding flight to cart:', {
      message: error.message,
      code: error.code,
      description: error.description,
    });
    res.status(500).json({
      error: 'Failed to add flight to cart',
      details: error.description || error.message,
      code: error.code || 'UNKNOWN',
    });
  }
});

app.get('/flights', async (req, res) => {
  try {
    const { origin, destination, departureDate, adults = 1, currencyCode = 'INR' } = req.query;

    if (!origin || !destination || !departureDate) {
      return res.status(400).json({ error: 'Missing required parameters: origin, destination, departureDate' });
    }

    const iataCodeRegex = /^[A-Z]{3}$/;
    if (!iataCodeRegex.test(origin) || !iataCodeRegex.test(destination)) {
      return res.status(400).json({
        error: 'Invalid origin or destination. Use 3-letter IATA airport codes (e.g., CCJ for Calicut).',
      });
    }

    const query = {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults: parseInt(adults),
      currencyCode,
      max: 10,
      includedAirlineCodes: origin === 'CCJ' ? '6E,AI,QR' : undefined,
    };

    const response = await amadeus.shopping.flightOffersSearch.get(query);

    const flights = response.data.map((flight) => {
      const itinerary = flight.itineraries[0];
      const segment = itinerary.segments[0];
      const departureTimeIST = moment(segment.departure.at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
      const arrivalTimeIST = moment(segment.arrival.at).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      return {
        airline: segment.carrierCode,
        flightNumber: segment.number,
        departure: {
          airport: segment.departure.iataCode,
          time: segment.departure.at,
          timeIST: departureTimeIST,
        },
        arrival: {
          airport: segment.arrival.iataCode,
          time: segment.arrival.at,
          timeIST: arrivalTimeIST,
        },
        duration: itinerary.duration,
        price: {
          total: flight.price.total,
          currency: flight.price.currency,
        },
      };
    });

    res.json({ success: true, data: flights });
  } catch (error) {
    console.error('Error fetching flights:', {
      message: error.message,
      code: error.code,
      description: error.description,
    });
    res.status(500).json({
      error: 'Failed to fetch flight details',
      details: error.description || error.message,
      code: error.code || 'UNKNOWN',
    });
  }
});

app.get('/cart/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT id, origin, destination, departure_date, return_date, adults, currency_code, airline, flight_number, price FROM cart_flights WHERE user_id = $1',
      [userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching cart:', error);
    res.status(500).json({ error: 'Failed to fetch cart', details: error.message });
  }
});

app.post('/clear-cart', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const userResult = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    await pool.query('DELETE FROM cart_flights WHERE user_id = $1', [userId]);
    res.json({ success: true, message: 'Cart cleared' });
  } catch (error) {
    console.error('Error clearing cart:', error);
    res.status(500).json({ error: 'Failed to clear cart', details: error.message });
  }
});

cron.schedule('*/5 * * * *', async () => {
  console.log('Running flight price check cron job...');
  try {
    const result = await pool.query(`
      SELECT cf.id, cf.user_id, cf.origin, cf.destination, cf.departure_date, cf.return_date, cf.adults, cf.currency_code, cf.price, u.email
      FROM cart_flights cf
      JOIN users u ON cf.user_id = u.id
      WHERE cf.departure_date >= CURRENT_DATE
    `);

    for (const flight of result.rows) {
      const query = {
        originLocationCode: flight.origin,
        destinationLocationCode: flight.destination,
        departureDate: moment(flight.departure_date).format('YYYY-MM-DD'),
        adults: flight.adults,
        currencyCode: flight.currency_code,
        max: 1,
        includedAirlineCodes: flight.origin === 'CCJ' ? '6E,AI,QR' : undefined,
      };
      if (flight.return_date) query.returnDate = moment(flight.return_date).format('YYYY-MM-DD');

      const response = await amadeus.shopping.flightOffersSearch.get(query);
      if (!response.data.length) continue;

      const newPrice = parseFloat(response.data[0].price.total);
      const oldPrice = flight.price;

      if (newPrice < oldPrice) {
        const reductionPercentage = ((oldPrice - newPrice) / oldPrice * 100).toFixed(2);

        await pool.query('UPDATE cart_flights SET price = $1 WHERE id = $2', [newPrice, flight.id]);

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: flight.email,
          subject: `Flight Price Drop Alert: ${flight.origin} to ${flight.destination}`,
          text: `Good news! The price for your flight from ${flight.origin} to ${flight.destination} on ${flight.departure_date} has dropped by ${reductionPercentage}%.\n\nNew Price: ${newPrice} ${flight.currency_code}\nOld Price: ${oldPrice} ${flight.currency_code}\n\nBook now to save!`,
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${flight.email} for price drop on ${flight.origin}-${destination}`);
      }
    }
  } catch (error) {
    console.error('Error in price check cron job:', {
      message: error.message,
      code: error.code,
      description: error.description,
    });
  }
}, {
  timezone: 'Asia/Kolkata',
});

async function startServer() {
  try {
    const client = await pool.connect();
    console.log('Successfully connected to PostgreSQL database');
    client.release();

    app.listen(port, async () => {
      console.log(`Server running on http://localhost:${port}`);
      const open = (await import('open')).default;
      await open(`http://localhost:${port}`);
      console.log('Opened http://localhost:3000 in default browser');
    });
  } catch (error) {
    console.error('Failed to connect to PostgreSQL database:', {
      message: error.message,
      code: error.code,
      details: error.detail,
    });
    process.exit(1);
  }
}

startServer();