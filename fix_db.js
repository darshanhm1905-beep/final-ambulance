const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, 'ambulance.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run("ALTER TABLE bookings ADD COLUMN email TEXT", (err) => {
        if(err) console.log("email column might already exist", err.message);
        else console.log("Added email to bookings");
    });
    db.run("ALTER TABLE drivers ADD COLUMN username TEXT", (err) => {
        if(err) console.log("username column might already exist", err.message);
        else console.log("Added username to drivers");
    });
    db.run("ALTER TABLE drivers ADD COLUMN mobile TEXT", (err) => {
        if(err) console.log("mobile column might already exist", err.message);
        else console.log("Added mobile to drivers");
    });
});

db.close();
