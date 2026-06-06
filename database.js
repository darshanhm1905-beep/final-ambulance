const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const isPg = !!process.env.DATABASE_URL;

let sqliteDb = null;
let pgPool = null;

if (isPg) {
    pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    console.log('Connected to PostgreSQL database.');
    
    // Run migrations
    const initPg = async () => {
        try {
            await pgPool.query(`CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                patientName VARCHAR(255) NOT NULL,
                phone VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                latitude REAL,
                longitude REAL,
                address TEXT,
                emergencyType VARCHAR(255),
                status VARCHAR(50) DEFAULT 'Pending',
                driverId INTEGER,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
            await pgPool.query(`CREATE TABLE IF NOT EXISTS drivers (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                phone VARCHAR(255) NOT NULL,
                username VARCHAR(255),
                mobile VARCHAR(255),
                vehicleNumber VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'Available'
            )`);
            const countRes = await pgPool.query("SELECT COUNT(*) FROM drivers");
            if (parseInt(countRes.rows[0].count) === 0) {
                await pgPool.query(`INSERT INTO drivers (name, phone, username, mobile, vehicleNumber) VALUES 
                    ('darshan', '7338201360', 'darshan', '7338201360', 'KA05HM2022'),
                    ('tharun', '9113959782', 'tharun', '9113959782', 'KA04MS2021'),
                    ('arun', '9113959738', 'ARUN', '9113959738', 'KA10SJ1705')`);
            }
        } catch (e) {
            console.error('Postgres init error:', e);
        }
    };
    initPg();
} else {
    const isVercel = process.env.VERCEL === '1';
    const dbPath = isVercel ? '/tmp/ambulance.db' : path.resolve(__dirname, 'ambulance.db');
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) console.error('Error opening SQLite', err.message);
        else console.log('Connected to SQLite database.');
    });
    
    sqliteDb.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patientName TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT,
        latitude REAL,
        longitude REAL,
        address TEXT,
        emergencyType TEXT,
        status TEXT DEFAULT 'Pending',
        driverId INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    sqliteDb.run(`CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        username TEXT,
        mobile TEXT,
        vehicleNumber TEXT NOT NULL,
        status TEXT DEFAULT 'Available'
    )`, () => {
        sqliteDb.get("SELECT COUNT(*) as count FROM drivers", (err, row) => {
            if (row && row.count === 0) {
                sqliteDb.run(`INSERT INTO drivers (name, phone, username, mobile, vehicleNumber) VALUES ('darshan', '7338201360', 'darshan', '7338201360', 'KA05HM2022')`);
                sqliteDb.run(`INSERT INTO drivers (name, phone, username, mobile, vehicleNumber) VALUES ('tharun', '9113959782', 'tharun', '9113959782', 'KA04MS2021')`);
                sqliteDb.run(`INSERT INTO drivers (name, phone, username, mobile, vehicleNumber) VALUES ('arun', '9113959738', 'ARUN', '9113959738', 'KA10SJ1705')`);
            }
        });
    });
}

const convertSqlToPg = (sql) => {
    let i = 1;
    return sql.replace(/\?/g, () => `$${i++}`);
};

const dbWrapper = {
    run: function(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (!isPg) {
            return sqliteDb.run(sql, params, callback);
        }
        
        let pgSql = convertSqlToPg(sql);
        let isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
        if (isInsert && !pgSql.toUpperCase().includes('RETURNING')) {
            pgSql += ' RETURNING id';
        }
        
        pgPool.query(pgSql, params)
            .then(res => {
                if (callback) {
                    const ctx = { lastID: isInsert && res.rows[0] ? res.rows[0].id : null, changes: res.rowCount };
                    callback.call(ctx, null);
                }
            })
            .catch(err => {
                if (callback) callback(err);
            });
    },
    all: function(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (!isPg) {
            return sqliteDb.all(sql, params, callback);
        }
        pgPool.query(convertSqlToPg(sql), params)
            .then(res => { if (callback) callback(null, res.rows); })
            .catch(err => { if (callback) callback(err, null); });
    },
    get: function(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        if (!isPg) {
            return sqliteDb.get(sql, params, callback);
        }
        pgPool.query(convertSqlToPg(sql), params)
            .then(res => { if (callback) callback(null, res.rows[0] || null); })
            .catch(err => { if (callback) callback(err, null); });
    }
};

module.exports = dbWrapper;
