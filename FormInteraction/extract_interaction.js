// Emits ONE JSON object per session (JSONL) for the reaction-time metrics.
// Same source data as analyze_interaction.js, but machine-readable for the notebook.
// Usage: node extract_interaction.js <interaction-log.jsonl>

const fs = require('fs');
const readline = require('readline');

async function extract(file) {
    if (!fs.existsSync(file)) {
        process.exit(0); // nothing to emit
    }

    const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const row = JSON.parse(line);
            if (!row.summary || !row.sessionId) continue;

            const { count, minMs, maxMs, meanMs, medianMs } = row.summary;

            // The sessionId prefix is the epoch-ms start time, e.g. "1775755142998-ofjvqw".
            const idStart = Number(String(row.sessionId).split('-')[0]) || null;
            const reacts = Array.isArray(row.reactions) ? row.reactions : [];
            const reveals = reacts.map(r => r.revealedAt).filter(Boolean);
            const firstRevealedAt = reveals.length ? Math.min(...reveals) : null;

            process.stdout.write(JSON.stringify({
                sessionId: row.sessionId,
                startTime: idStart,
                firstRevealedAt,
                submittedAt: row.submittedAt || null,
                reactionCount: count,
                reactionMin: minMs,
                reactionMax: maxMs,
                reactionMean: meanMs,
                reactionMedian: medianMs
            }) + '\n');
        } catch (e) {
            // ignore bad JSON
        }
    }
}

const file = process.argv[2];
if (!file) {
    console.error('Please provide a file path');
    process.exit(1);
}
extract(file);
