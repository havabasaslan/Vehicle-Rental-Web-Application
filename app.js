// Import necessary modules
const express = require('express');
const { Pool } = require('pg'); // Used for PostgreSQL database connection
const multer = require('multer'); // Used for file upload operations
const path = require('path'); // Used for working with file paths
const bodyParser = require('body-parser'); // Used to parse HTTP request bodies
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

// Initialize Express app
const app = express();
const port = 3000; // Server port

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'postgres', // Database username
  password: process.env.DB_PASSWORD || '123456', // Database password
  host: process.env.DB_HOST || 'postgres-db', // Database server address
  database: process.env.DB_NAME || 'vehicle_db', // Database name
  port: process.env.DB_PORT || 5432, // Database port
});

// Function to connect to the database with retries
const connectWithRetry = async (maxAttempts = 5) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = await pool.connect(); // Test the database connection
      console.log('Database connected successfully'); // Successful connection
      client.release(); // Release the connection
      return true;
    } catch (err) {
      console.error(`Attempt ${attempt}/${maxAttempts} - Database connection failed:`, err.message);
      if (attempt === maxAttempts) {
        throw err; // Throw error if the connection fails after max attempts
      }
      // Wait for 5 seconds and retry
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
};

// Multer configuration for file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/uploads/'); // Directory where uploaded files will be saved
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname)); // Use timestamp as the file name
  }
});
const upload = multer({ storage: storage }); // Configure multer to handle file uploads

// Middleware settings
app.set('view engine', 'ejs'); // Use EJS templating engine
app.use(express.static('public')); // Serve static files (images, CSS, JS)
app.use(bodyParser.urlencoded({ extended: true })); // Allow URL-encoded data
app.use(bodyParser.json()); // Allow JSON data

// Session configuration
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return done(null, false, { message: 'Incorrect username.' });
    }
    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return done(null, false, { message: 'Incorrect password.' });
    }
    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0]);
  } catch (err) {
    done(err);
  }
});

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied');
};

// Initialize database tables if they don't exist
async function initDB() {
  try {
    await connectWithRetry();
    
    // Create session table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `);

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create vehicles table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        brand VARCHAR(100) NOT NULL,
        model VARCHAR(100) NOT NULL,
        image_path VARCHAR(255),
        technical_specs TEXT,
        daily_price DECIMAL(10,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create favorites table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, vehicle_id)
      )
    `);

    // Create rentals table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rentals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        days INTEGER NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        rental_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active'
      )
    `);

    // Create default admin user if not exists
    const adminExists = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['admin', hashedPassword, 'admin']
      );
    }

    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
    process.exit(1);
  }
}

// Authentication routes
app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/register', (req, res) => {
  res.render('register');
});

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Check if username already exists
    const userExists = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userExists.rows.length > 0) {
      return res.render('register', { error: 'This username is already taken.' });
    }

    // Create new user
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
      [username, hashedPassword, 'user']
    );
    res.redirect('/login');
  } catch (err) {
    res.render('register', { error: 'An error occurred during registration.' });
  }
});

app.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login',
  failureFlash: true
}));

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// Admin routes
app.get('/admin', isAdmin, async (req, res) => {
  try {
    const vehicles = await pool.query('SELECT * FROM vehicles ORDER BY created_at DESC');
    const users = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    const rentals = await pool.query(`
      SELECT 
        r.*,
        u.username,
        v.brand,
        v.model,
        v.image_path
      FROM rentals r
      JOIN users u ON r.user_id = u.id
      JOIN vehicles v ON r.vehicle_id = v.id
      ORDER BY r.rental_date DESC
    `);

    res.render('admin', { 
      vehicles: vehicles.rows, 
      users: users.rows,
      rentals: rentals.rows,
      user: req.user 
    });
  } catch (err) {
    console.error('Admin panel error:', err);
    res.status(500).send('Error loading admin panel: ' + err.message);
  }
});

// Public routes
app.get('/', async (req, res) => {
  try {
    // Get all vehicles for brand list
    const allVehicles = await pool.query('SELECT * FROM vehicles');
    
    // Pagination settings
    const page = parseInt(req.query.page) || 1;
    const limit = 9;
    const offset = (page - 1) * limit;
    
    // Build query for filtered vehicles
    let query = 'SELECT * FROM vehicles';
    let countQuery = 'SELECT COUNT(*) FROM vehicles';
    const queryParams = [];
    const countParams = [];
    
    // Brand filter
    const selectedBrand = req.query.brand || '';
    if (selectedBrand) {
      query += ' WHERE brand = $1';
      countQuery += ' WHERE brand = $1';
      queryParams.push(selectedBrand);
      countParams.push(selectedBrand);
    }
    
    // Add sorting and pagination
    query += ' ORDER BY created_at DESC LIMIT $' + (queryParams.length + 1) + ' OFFSET $' + (queryParams.length + 2);
    queryParams.push(limit, offset);

    // Get filtered vehicles and total count
    const vehicles = await pool.query(query, queryParams);
    const totalCount = await pool.query(countQuery, countParams);
    
    // Calculate total pages
    const totalVehicles = parseInt(totalCount.rows[0].count);
    const totalPages = Math.ceil(totalVehicles / limit);

    // Get unique brands for filter dropdown
    const brands = [...new Set(allVehicles.rows.map(v => v.brand))];

    // Get favorite information if user is logged in
    let favorites = [];
    if (req.user) {
      const favResult = await pool.query(
        'SELECT vehicle_id FROM favorites WHERE user_id = $1',
        [req.user.id]
      );
      favorites = favResult.rows.map(f => f.vehicle_id);
    }

    res.render('index', { 
      vehicles: vehicles.rows,
      brands: brands,
      user: req.user,
      selectedBrand: selectedBrand,
      favorites: favorites,
      pagination: {
        page,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (err) {
    console.error('Database query error:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

// Protected routes
app.post('/vehicles', isAdmin, upload.single('image'), async (req, res) => {
  const { brand, model, technical_specs, daily_price } = req.body;
  const image_path = req.file ? '/uploads/' + req.file.filename : null;

  try {
    await pool.query(
      'INSERT INTO vehicles (brand, model, image_path, technical_specs, daily_price) VALUES ($1, $2, $3, $4, $5)',
      [brand, model, image_path, technical_specs, daily_price]
    );
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error adding vehicle');
  }
});

app.post('/vehicles/:id/delete', isAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM vehicles WHERE id = $1', [req.params.id]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error deleting vehicle');
  }
});

app.post('/vehicles/:id/update', isAdmin, upload.single('image'), async (req, res) => {
  const { brand, model, technical_specs, daily_price } = req.body;
  const image_path = req.file ? '/uploads/' + req.file.filename : null;

  try {
    if (image_path) {
      await pool.query(
        'UPDATE vehicles SET brand = $1, model = $2, technical_specs = $3, image_path = $4, daily_price = $5 WHERE id = $6',
        [brand, model, technical_specs, image_path, daily_price, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE vehicles SET brand = $1, model = $2, technical_specs = $3, daily_price = $4 WHERE id = $5',
        [brand, model, technical_specs, daily_price, req.params.id]
      );
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error updating vehicle');
  }
});

// Kullanıcı rolü güncelleme
app.post('/users/:id/update-role', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  
  try {
    // Admin kendisinin rolünü değiştirmeye çalışıyorsa engelle
    if (parseInt(id) === req.user.id) {
      return res.status(403).send('You cannot change your own role.');
    }

    // Rolü güncelle
    await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, id]
    );
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error updating user role: ' + err.message);
  }
});

// Kullanıcı silme
app.post('/users/:id/delete', isAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Admin kendisini silmeye çalışıyorsa engelle
    if (parseInt(id) === req.user.id) {
      return res.status(403).send('You cannot delete your own account.');
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error deleting user: ' + err.message);
  }
});

// Favorites routes
app.get('/favorites', isAuthenticated, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, f.id as favorite_id 
      FROM vehicles v 
      INNER JOIN favorites f ON v.id = f.vehicle_id 
      WHERE f.user_id = $1 
      ORDER BY f.created_at DESC
    `, [req.user.id]);
    
    res.render('favorites', { 
      vehicles: result.rows,
      user: req.user
    });
  } catch (err) {
    res.status(500).send('Error fetching favorites: ' + err.message);
  }
});

// Add to favorites
app.post('/favorites/add/:vehicleId', isAuthenticated, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO favorites (user_id, vehicle_id) VALUES ($1, $2) ON CONFLICT (user_id, vehicle_id) DO NOTHING',
      [req.user.id, req.params.vehicleId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove from favorites
app.post('/favorites/remove/:vehicleId', isAuthenticated, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM favorites WHERE user_id = $1 AND vehicle_id = $2',
      [req.user.id, req.params.vehicleId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rental route
app.get('/rent/:id', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).send('Vehicle not found');
        }
        res.render('rent', { 
            vehicle: result.rows[0],
            user: req.user
        });
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// Payment route
app.get('/payment', isAuthenticated, async (req, res) => {
    try {
        const { vehicleId, days, total, startDate, endDate } = req.query;
        const result = await pool.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId]);
        if (result.rows.length === 0) {
            return res.status(404).send('Vehicle not found');
        }
        res.render('payment', {
            vehicle: result.rows[0],
            days: parseInt(days),
            total: parseFloat(total),
            startDate,
            endDate,
            user: req.user
        });
    } catch (err) {
        res.status(500).send('Error: ' + err.message);
    }
});

// Process payment route
app.post('/process-payment', isAuthenticated, async (req, res) => {
    try {
        const { vehicleId, days, total, startDate, endDate } = req.body;
        
        // Insert rental record
        await pool.query(
            'INSERT INTO rentals (user_id, vehicle_id, start_date, end_date, days, total_price) VALUES ($1, $2, $3, $4, $5, $6)',
            [req.user.id, vehicleId, startDate, endDate, days, total]
        );
        
        // Redirect to my rentals page
        res.redirect('/my-rentals');
    } catch (err) {
        res.status(500).send('Error processing payment: ' + err.message);
    }
});

// My rentals route
app.get('/my-rentals', isAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT r.*, v.* as vehicle 
            FROM rentals r 
            INNER JOIN vehicles v ON r.vehicle_id = v.id 
            WHERE r.user_id = $1 
            ORDER BY r.rental_date DESC
        `, [req.user.id]);
        
        const rentals = result.rows.map(row => ({
            id: row.id,
            days: row.days,
            total_price: row.total_price,
            rental_date: row.rental_date,
            start_date: row.start_date,
            end_date: row.end_date,
            status: row.status,
            vehicle: {
                id: row.vehicle_id,
                brand: row.brand,
                model: row.model,
                image_path: row.image_path,
                technical_specs: row.technical_specs
            }
        }));

        res.render('my-rentals', { 
            rentals,
            user: req.user
        });
    } catch (err) {
        res.status(500).send('Error fetching rentals: ' + err.message);
    }
});

// Admin rental cancellation route
app.post('/admin/rentals/:id/cancel', isAdmin, async (req, res) => {
  try {
    await pool.query(
      'UPDATE rentals SET status = $1 WHERE id = $2',
      ['cancelled', req.params.id]
    );
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error cancelling rental: ' + err.message);
  }
});

// Initialize the database and start the server
initDB().then(() => {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
});
