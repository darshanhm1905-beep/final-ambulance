require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const session = require('express-session');
const db = require('./database');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.SESSION_SECRET || 'ambulance_secret';

const app = express();
const PORT = process.env.PORT || 3000;
// ----- Socket.IO setup -----
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
// Export io for other modules
module.exports.io = io;


// --- Middlewares ---
app.use(compression()); // gzip all responses
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'ambulance_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
    }
}));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // cache static files for 1 day
  etag: true
}));

// Health check / keep-alive endpoint
app.get('/ping', (req, res) => res.status(200).send('OK'));

// --- Email Transporter Setup ---
let transporter;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
}

async function sendEmail(to, subject, text) {
    if (!transporter) {
        console.log('Transporter not configured. Email not sent.');
        return;
    }
    try {
        await transporter.sendMail({
            from: `"AmbulanceConnect" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text
        });
        console.log(`Email sent to ${to}`);
    } catch (error) {
        console.error('Error sending email:', error);
    }
}

// --- Driver Auth Middleware (JWT) ---
function isAuthenticatedDriver(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1] || req.query.token;
    if (!token) return res.redirect('/driver/login');
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.driverId = decoded.driverId;
        req.driverName = decoded.name;
        next();
    } catch {
        res.redirect('/driver/login');
    }
}

// --- Routes ---

// Admin Routes (No Auth as requested)
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin/user', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin/driver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Driver Routes
app.get('/driver/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/driver/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/driver/login', (req, res) => {
    const { username, mobile } = req.body;
    db.get("SELECT * FROM drivers WHERE username = ? AND mobile = ?", [username, mobile], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            const token = jwt.sign(
                { driverId: row.id, name: row.name },
                JWT_SECRET,
                { expiresIn: '24h' }
            );
            res.json({ message: 'Login successful', token, redirect: '/driver' });
        } else {
            res.status(401).json({ error: 'Invalid username or mobile number' });
        }
    });
});

app.get('/driver', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/driver/session', (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json({ driverId: decoded.driverId, name: decoded.name });
    } catch {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

app.get('/api/driver/logout', (req, res) => {
    res.redirect('/driver/login');
});

// --- API Routes ---

app.post('/api/bookings', (req, res) => {
    const { patientName, phone, email, latitude, longitude, address, emergencyType } = req.body;
    const sql = `INSERT INTO bookings (patientName, phone, email, latitude, longitude, address, emergencyType) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [patientName, phone, email, latitude, longitude, address, emergencyType], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const bookingId = this.lastID;
        if (email) {
            sendEmail(email, "Ambulance Request Received", 
                `Hello ${patientName},\n\nWe have received your emergency request (#${bookingId}) for: ${emergencyType}.\n\nAn ambulance will be dispatched shortly.\n\nStay calm and wait for assistance.`);
        }
        
        res.status(201).json({ id: bookingId, message: 'Booking created successfully' });
    });
});

app.get('/api/bookings', (req, res) => {
    db.all("SELECT * FROM bookings ORDER BY timestamp DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.put('/api/bookings/:id/status', (req, res) => {
    const { status, driverId } = req.body;
    
    // Update booking status
    db.run("UPDATE bookings SET status = ?, driverId = ? WHERE id = ?", [status, driverId, req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        // Fetch updated booking for emission & email logic
        db.get("SELECT * FROM bookings WHERE id = ?", [req.params.id], (err, updatedBooking) => {
            if (err) {
                console.error('Error fetching updated booking:', err);
                return res.status(500).json({ error: 'Failed to fetch updated booking' });
            }
            
            // Update driver status based on new booking status
            if (driverId) {
                let driverStatus = 'Available';
                if (status === 'Accepted' || status === 'Dispatched' || status === 'Arrived') {
                    driverStatus = 'Busy';
                }
                db.run("UPDATE drivers SET status = ? WHERE id = ?", [driverStatus, driverId]);
            }
            
            // Email notifications (retain existing behavior for Dispatched & Arrived)
            if (updatedBooking.email) {
                if (status === 'Dispatched') {
                    db.get("SELECT * FROM drivers WHERE id = ?", [driverId], (err, driver) => {
                        if (driver) {
                            sendEmail(updatedBooking.email, "Ambulance Dispatched",
                                `Hello ${updatedBooking.patientName},\n\nAn ambulance has been dispatched for your request (#${updatedBooking.id}).\n\nDriver: ${driver.name}\nPhone: ${driver.phone}\nVehicle: ${driver.vehicleNumber}\n\nPlease be ready at the pickup location.`);
                        }
                    });
                } else if (status === 'Arrived') {
                    sendEmail(updatedBooking.email, "Ambulance Arrived",
                        `Hello ${updatedBooking.patientName},\n\nYour ambulance has arrived at the pickup location.\n\nPlease look for vehicle ${updatedBooking.vehicleNumber || ''}.`);
                }
            }
            
            // Emit real‑time update to all connected clients
            if (typeof io !== 'undefined') {
                console.log('[Socket] Emitting bookingUpdated', updatedBooking);
                io.emit('bookingUpdated', updatedBooking);
            }
            
            res.json({ message: 'Booking updated successfully', booking: updatedBooking });
        });
    });
});

app.get('/api/drivers', (req, res) => {
    db.all("SELECT * FROM drivers", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/drivers', (req, res) => {
    const { name, phone, username, mobile, vehicleNumber } = req.body;
    db.run("INSERT INTO drivers (name, phone, username, mobile, vehicleNumber) VALUES (?, ?, ?, ?, ?)", 
        [name, phone, username, mobile, vehicleNumber], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, message: 'Driver added successfully' });
    });
});

app.delete('/api/drivers/:id', (req, res) => {
    db.run("DELETE FROM drivers WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Driver deleted successfully' });
    });
});

// Fallback for React Router client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    server.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));
}

module.exports = { app, io };
