/* Required Modules */
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const cors = require('cors');
const axios = require('axios');
const bodyParser = require('body-parser');

dotenv.config();

/* App Variables */
const app = express();
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const CLOUDFLARE_SECRET_KEY = process.env.CLOUDFLARE_SECRET_KEY;

// Adjust the limit for json req/resp to accommodate larger fingerprints
app.use(bodyParser.json({limit:'10mb'}));

// enabling CORS for our domain (adjust as needed for your testing environment)
app.use(cors("https://testsite.xyz"));

// For JSON POST requests
app.use(express.json());
// For URL encoded POST requests
app.use(express.urlencoded({ extended: true }));

// --- CAPTCHA VERIFICATION HELPERS ---
async function verifyRecaptcha(token) {
    const verifyUrl = 'https://www.google.com/recaptcha/api/siteverify';

    // We send the data as 'application/x-www-form-urlencoded'
    // 'axios' requires us to use URLSearchParams for this.
    const body = new URLSearchParams();
    body.append('secret', RECAPTCHA_SECRET_KEY);
    body.append('response', token);

    try {
        const response = await axios.post(verifyUrl, body);
        return response.data; // response.data is the JSON result
    } catch (error) {
        console.error("Error during reCAPTCHA verification:", error.message);
        return { success: false, 'error-codes': [error.message] };
    }
}

async function verifyTurnstile(token) {
    const formData = new URLSearchParams();
    formData.append('secret', CLOUDFLARE_SECRET_KEY);
    formData.append('response', token);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
    });

    const data = await response.json();
    return data;
}


/* ─── Page routes ─────────────────────────────────────────────── */
app.get("/", function (request, res) {
    res.sendFile(path.join(__dirname, 'main.html'));
});

app.get("/dynamic-form", function (request, res) {
    res.sendFile(path.join(__dirname, 'dynamic-form.html'));
});

app.get("/pledge-form", function (request, res) {
    res.sendFile(path.join(__dirname, 'simple-form.html'));
});

app.get("/captchav3", function (request, res) {
    res.sendFile(path.join(__dirname, 'captcha-tests/captcha-v3.html'));
});

app.get("/turnstile", function (request, res) {
    res.sendFile(path.join(__dirname, 'captcha-tests/captcha-turnstile.html'));
});

/* ─── Static assets used by the pages ─────────────────────────── */
app.get("/main.css", function (request, res) {
    res.sendFile(path.join(__dirname, 'main.css'));
});

app.get("/tracker.js", function (request, res) {
    res.sendFile(path.join(__dirname, 'tracker.js'));
});

/* ─── Dynamic-form interaction-timing log ─────────────────────── */
const INTERACTION_LOG_FILE = path.join(__dirname, 'interaction-log.jsonl');

app.post('/log-interaction', (req, res) => {
    const entry = {
        ...req.body,
        serverReceivedAt: Date.now(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    };

    // Pretty-print summary to console
    console.log('\n--- INTERACTION TIMING ---');
    console.log('Session :', entry.sessionId);
    console.log('UA      :', entry.userAgent);
    if (entry.summary) {
        const s = entry.summary;
        console.log(`Summary : n=${s.count}  min=${s.minMs}ms  median=${s.medianMs}ms  mean=${s.meanMs}ms  max=${s.maxMs}ms`);
    }
    if (Array.isArray(entry.reactions)) {
        entry.reactions.forEach(r => {
            console.log(`  ${r.fieldId.padEnd(28)} ${String(r.reactionMs).padStart(6)}ms  [${r.eventType}]  trusted=${r.isTrusted}`);
        });
    }
    console.log('--------------------------\n');

    // Append one JSON line per session to the log file
    fs.appendFile(INTERACTION_LOG_FILE, JSON.stringify(entry) + '\n', err => {
        if (err) console.error('Failed to write interaction log:', err.message);
    });

    res.json({ ok: true });
});

/* ─── Tracker endpoint logs ─────────────────────────────────── */
const TRACKER_LOG_FILE = path.join(__dirname, 'logs/tracker-log.jsonl');

app.post('/tracker_endpoint', (req, res) => {
    const entry = {
        ...req.body,
        serverReceivedAt: Date.now(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    };

    fs.appendFile(TRACKER_LOG_FILE, JSON.stringify(entry) + '\n', err => {
        if (err) console.error('Failed to write tracker log:', err.message);
    });

    res.json({ ok: true });
});

/* ─── CAPTCHA verification endpoints ──────────────────────────── */
app.post('/verify-recaptcha', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ success: false, error: 'No token provided' });
    }

    const result = await verifyRecaptcha(token);

    // result.score is the 0.0–1.0 value you care about for agent detection
    console.log('reCAPTCHA v3 result:', result);

    res.json(result);
});

app.post('/verify-turnstile', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ success: false, error: 'No token provided' });
    }

    const result = await verifyTurnstile(token);
    console.log('Turnstile result:', result);

    res.json(result);
});


/* Server Activation */
var httpServer = http.createServer(app);
PORT = process.env.PORT || 5001;
httpServer.listen(PORT, () => {
    console.log("HTTP server running on port 5001");
});
