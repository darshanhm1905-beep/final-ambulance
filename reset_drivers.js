const db = require('./database');
setTimeout(() => {
    db.run("UPDATE drivers SET status = 'Available'", [], (err) => {
        if (err) console.error(err);
        else console.log('All drivers reset to Available.');
        process.exit(0);
    });
}, 500);
