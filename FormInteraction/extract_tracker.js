// Emits ONE JSON object per session (JSONL) for the keyboard/mouse metrics.
// Same aggregation logic as analyze_tracker.js, but machine-readable for the
// notebook. Adds the session time window (for joining with the interaction log)
// and the reaction-time values that analyze_tracker.js computes but never prints.
// Usage: node extract_tracker.js <tracker-log.jsonl>

const fs = require('fs');
const readline = require('readline');

async function extract(logFile) {
    if (!fs.existsSync(logFile)) {
        process.exit(0);
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
                sessions[sessionId] = {
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
                if (event.is_trusted === false) session.untrustedEvents++;
                if (event.timestamp < session.startTime) session.startTime = event.timestamp;
                if (event.timestamp > session.endTime) session.endTime = event.timestamp;

                switch (event.type) {
                    case 'mouse_move':
                        session.mouseMoves++;
                        break;
                    case 'mouse_click':
                        session.mouseClicks++;
                        if (event.target_id) {
                            const cName = event.target_id.replace(/-/g, '_');
                            if (session.revealTimestamps[cName] && !session.firstInteractionTimestamps[cName]) {
                                session.firstInteractionTimestamps[cName] = event.timestamp;
                                session.reactionTimes.push(event.timestamp - session.revealTimestamps[cName]);
                            }
                        }
                        break;
                    case 'input_capture': {
                        session.keystrokes++;
                        const iName = (event.field_name || 'unknown').replace(/-/g, '_');
                        if (session.revealTimestamps[iName] && !session.firstInteractionTimestamps[iName]) {
                            session.firstInteractionTimestamps[iName] = event.timestamp;
                            session.reactionTimes.push(event.timestamp - session.revealTimestamps[iName]);
                        }
                        const fieldName = event.field_name || 'unknown';
                        if (!session.fieldMetrics[fieldName]) {
                            session.fieldMetrics[fieldName] = { keyPressTimes: [], lastKeyPressTime: null };
                        }
                        const fieldData = session.fieldMetrics[fieldName];
                        if (session.lastKeyPressTime) {
                            const delay = event.timestamp - session.lastKeyPressTime;
                            if (delay < 2000) session.keyPressTimes.push(delay);
                        }
                        if (fieldData.lastKeyPressTime) {
                            const delay = event.timestamp - fieldData.lastKeyPressTime;
                            if (delay < 2000) fieldData.keyPressTimes.push(delay);
                        }
                        session.lastKeyPressTime = event.timestamp;
                        fieldData.lastKeyPressTime = event.timestamp;
                        break;
                    }
                    case 'field_completed':
                        if (event.field_name) session.fieldsCompleted.add(event.field_name);
                        break;
                    case 'field_revealed':
                        if (event.field_id) {
                            session.fieldsRevealed.add(event.field_id);
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
            // ignore bad JSON
        }
    }

    const getMean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    const getStdev = (arr, mean) => arr.length ? Math.sqrt(arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length) : null;
    const getMedian = (arr) => {
        if (!arr.length) return null;
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    for (const [sessionId, data] of Object.entries(sessions)) {
        if (data.eventCount === 0) continue;

        const dwellMean = getMean(data.dwellTimes);
        const keypressMean = getMean(data.keyPressTimes);
        const reactionMean = getMean(data.reactionTimes);

        process.stdout.write(JSON.stringify({
            sessionId,
            startTime: data.startTime === Infinity ? null : data.startTime,
            endTime: data.endTime || null,
            durationMs: (data.endTime && data.startTime !== Infinity) ? data.endTime - data.startTime : null,
            dwellTimeMean: dwellMean,
            dwellTimeStdev: getStdev(data.dwellTimes, dwellMean),
            dwellCount: data.dwellTimes.length,
            mouseMoves: data.mouseMoves,
            mouseClicks: data.mouseClicks,
            keypresses: data.keystrokes,
            keypressMean: keypressMean,
            keypressStdev: getStdev(data.keyPressTimes, keypressMean),
            untrustedEvents: data.untrustedEvents,
            fieldsCompleted: data.fieldsCompleted.size,
            fieldsRevealed: data.fieldsRevealed.size,
            trackerReactionMean: reactionMean,
            trackerReactionMin: data.reactionTimes.length ? Math.min(...data.reactionTimes) : null,
            trackerReactionMax: data.reactionTimes.length ? Math.max(...data.reactionTimes) : null,
            trackerReactionMedian: getMedian(data.reactionTimes)
        }) + '\n');
    }
}

const logFile = process.argv[2];
if (!logFile) {
    console.error('Please provide a file path');
    process.exit(1);
}
extract(logFile);
