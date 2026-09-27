// NOTE: RUN THIS TO GET REACTION TIME METRICS FOR A SPECIFIC TOOL

const fs = require('fs');
const readline = require('readline');

async function analyze(file) {
    if (!fs.existsSync(file)) {
        console.error(`File not found: ${file}`);
        return;
    }

    const fileStream = fs.createReadStream(file);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const results = [];
    let sumMin = 0, sumMax = 0, sumMean = 0, sumMedian = 0;
    let count = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const row = JSON.parse(line);
            if (row.summary && row.sessionId) {
                const { minMs, maxMs, meanMs, medianMs } = row.summary;
                results.push({
                    Session: row.sessionId,
                    Min: minMs,
                    Max: maxMs,
                    Mean: meanMs,
                    Median: medianMs
                });
                
                sumMin += minMs;
                sumMax += maxMs;
                sumMean += meanMs;
                sumMedian += medianMs;
                count++;
            }
        } catch (e) {
            // ignore bad JSON
        }
    }

    if (count > 0) {
        results.push({
            Session: 'OVERALL AVERAGE',
            Min: Math.round(sumMin / count),
            Max: Math.round(sumMax / count),
            Mean: Math.round(sumMean / count),
            Median: Math.round(sumMedian / count)
        });
        console.table(results);
    } else {
        console.log("No valid session summaries found.");
    }
}

const file = process.argv[2];
if (!file) {
    console.error('Please provide a file path');
    process.exit(1);
}

analyze(file);
