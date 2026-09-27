// NOTE: RUN THIS TO GET KEYBOARD/MOUSE METRICS FOR A SPECIFIC TOOL


const fs = require('fs');
const path = require('path');
const readline = require('readline');

const logFile = process.argv[2] || path.join(__dirname, 'logs', 'tracker-log.jsonl');

async function analyzeLogs() {
    if (!fs.existsSync(logFile)) {
        console.error('Log file not found:', logFile);
        return;
    }

    const rl = readline.createInterface({
        input: fs.createReadStream(logFile),
        crlfDelay: Infinity
    });

    const sessions = {};

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            const sessionId = entry.session_id;

            if (!sessions[sessionId]) {
                // Initialize a new session record
                sessions[sessionId] = {
                    ip: entry.ip,
                    url: entry.url,
                    eventCount: 0,
                    startTime: Infinity,
                    endTime: 0,
                    mouseMoves: 0,
                    mouseClicks: 0,
                    keystrokes: 0,
                    untrustedEvents: 0,
                    fieldsCompleted: new Set(),
                    fieldsRevealed: new Set(),
                    clicks: [],
                    keyPressTimes: [],
                    lastKeyPressTime: null,
                    fieldMetrics: {},
                    dwellTimes: [],
                    revealTimestamps: {},
                    firstInteractionTimestamps: {},
                    reactionTimes: []
                };
            }

            const session = sessions[sessionId];

            entry.events.forEach(event => {
                session.eventCount++;

                if (event.is_trusted === false) {
                    session.untrustedEvents++;
                }

                // Track total time bounds
                if (event.timestamp < session.startTime) session.startTime = event.timestamp;
                if (event.timestamp > session.endTime) session.endTime = event.timestamp;

                // Tally event types
                switch (event.type) {
                    case 'mouse_move':
                        session.mouseMoves++;
                        break;
                    case 'mouse_click':
                        session.mouseClicks++;
                        session.clicks.push({ target: event.target_id || event.target_element, x: event.x, y: event.y });
                        
                        if (event.target_id) {
                            const cName = event.target_id.replace(/-/g, '_');
                            if (session.revealTimestamps[cName] && !session.firstInteractionTimestamps[cName]) {
                                session.firstInteractionTimestamps[cName] = event.timestamp;
                                session.reactionTimes.push(event.timestamp - session.revealTimestamps[cName]);
                            }
                        }
                        break;
                    case 'input_capture':
                        session.keystrokes++;
                        
                        const iName = (event.field_name || 'unknown').replace(/-/g, '_');
                        if (session.revealTimestamps[iName] && !session.firstInteractionTimestamps[iName]) {
                            session.firstInteractionTimestamps[iName] = event.timestamp;
                            session.reactionTimes.push(event.timestamp - session.revealTimestamps[iName]);
                        }
                        
                        // Per-field keypress metrics
                        const fieldName = event.field_name || 'unknown';
                        if (!session.fieldMetrics[fieldName]) {
                            session.fieldMetrics[fieldName] = { keyPressTimes: [], lastKeyPressTime: null };
                        }
                        const fieldData = session.fieldMetrics[fieldName];

                        // Global keystroke tracking
                        if (session.lastKeyPressTime) {
                            const delay = event.timestamp - session.lastKeyPressTime;
                            if (delay < 2000) {
                                session.keyPressTimes.push(delay);
                            }
                        }
                        
                        // Local (per-field) keystroke tracking
                        if (fieldData.lastKeyPressTime) {
                            const delay = event.timestamp - fieldData.lastKeyPressTime;
                            if (delay < 2000) {
                                fieldData.keyPressTimes.push(delay);
                            }
                        }

                        session.lastKeyPressTime = event.timestamp;
                        fieldData.lastKeyPressTime = event.timestamp;
                        break;
                    case 'field_completed':
                        if (event.field_name) session.fieldsCompleted.add(event.field_name);
                        break;
                    case 'field_revealed':
                        if (event.field_id) {
                            session.fieldsRevealed.add(event.field_id);
                            
                            // Normalize "field-us-city" to "us_city" to match target_id and field_name mappings
                            const rName = event.field_id.replace(/^field-/, '').replace(/-/g, '_');
                            if (!session.revealTimestamps[rName]) {
                                session.revealTimestamps[rName] = event.timestamp;
                            }
                        }
                        break;
                    case 'keypress_dwell_time':
                        if (event.duration_ms) session.dwellTimes.push(event.duration_ms);
                        break;
                }
            });
        } catch (err) {
            console.error("Error parsing line:", err);
        }
    }

    const tableData = {};
    const totals = {
        dwellTime: [],
        dwellTimeStdev: [],
        mouseMoves: [],
        keypresses: [],
        keypressStdev: [],
        meanReactionTime: [],
        minReactionTime: [],
        untrustedEvents: [],
        mouseClicks: []
    };

    const getMedian = (arr) => {
        if (!arr.length) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    for (const [sessionId, data] of Object.entries(sessions)) {
        if (data.eventCount === 0) continue;

        const getMean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const getStdev = (arr, mean) => arr.length ? Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length) : null;

        const dwellMean = getMean(data.dwellTimes);
        const dwellStdev = getStdev(data.dwellTimes, dwellMean);
        const keypressMean = getMean(data.keyPressTimes);
        const keypressStdev = getStdev(data.keyPressTimes, keypressMean);
        const reactionMean = getMean(data.reactionTimes);
        const reactionMedian = getMedian(data.reactionTimes);
        const reactionMin = data.reactionTimes.length ? Math.min(...data.reactionTimes) : null;
        const reactionMax = data.reactionTimes.length ? Math.max(...data.reactionTimes) : null;

        const row = {
            'Dwell Time': dwellMean !== null ? Number(dwellMean.toFixed(2)) : null,
            'Dwell Time STDEV': dwellStdev !== null ? Number(dwellStdev.toFixed(2)) : null,
            'Mouse Movements': data.mouseMoves,
            'Keypresses': data.keystrokes,
            'Keypress STDEV': keypressStdev !== null ? Number(keypressStdev.toFixed(2)) : null,
            'Untrusted Events': data.untrustedEvents,
            'Mouse Clicks': data.mouseClicks
        };

        tableData[sessionId] = row;

        if (row['Dwell Time'] !== null) totals.dwellTime.push(row['Dwell Time']);
        if (row['Dwell Time STDEV'] !== null) totals.dwellTimeStdev.push(row['Dwell Time STDEV']);
        totals.mouseMoves.push(row['Mouse Movements']);
        totals.keypresses.push(row['Keypresses']);
        if (row['Keypress STDEV'] !== null) totals.keypressStdev.push(row['Keypress STDEV']);
        totals.untrustedEvents.push(row['Untrusted Events']);
        totals.mouseClicks.push(row['Mouse Clicks']);
    }

    const calcAvg = (arr) => (arr && arr.length) ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null;

    if (Object.keys(tableData).length > 0) {
        tableData['AVERAGE'] = {
            'Dwell Time': calcAvg(totals.dwellTime),
            'Dwell Time STDEV': calcAvg(totals.dwellTimeStdev),
            'Mouse Movements': calcAvg(totals.mouseMoves),
            'Keypresses': calcAvg(totals.keypresses),
            'Keypress STDEV': calcAvg(totals.keypressStdev),
            'Untrusted Events': calcAvg(totals.untrustedEvents),
            'Mouse Clicks': calcAvg(totals.mouseClicks)
        };

        console.table(tableData);
    } else {
        console.log("No valid sessions found to tabulate.");
    }
}

analyzeLogs();
