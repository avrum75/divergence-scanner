const SignalType = {
    BULLISH_DIVERGENCE: 'Bullish',
    BEARISH_DIVERGENCE: 'Bearish',
    BULLISH_HIDDEN: 'Bullish Hidden',
    BEARISH_HIDDEN: 'Bearish Hidden',
    NONE: 'None'
};

const findPivots = (values, type, range = 5) => {
    const pivots = [];
    for (let i = range; i < values.length - range; i++) {
        const val = values[i];
        if (isNaN(val)) continue;
        let isPivot = true;
        for (let j = 1; j <= range; j++) {
            if (type === 'high') {
                if (values[i - j] > val || values[i + j] >= val) {
                    isPivot = false;
                    break;
                }
            } else {
                if (values[i - j] < val || values[i + j] <= val) {
                    isPivot = false;
                    break;
                }
            }
        }
        if (isPivot) pivots.push(i);
    }
    return pivots;
};

const scanForDivergences = (candles, indicatorValues, sensitivity = 3) => {
    const lookback = 120;
    const recentCloses = candles.map(c => c.close).slice(-lookback);
    const indValues = indicatorValues.slice(-lookback);

    const findSignals = (type) => {
        const isBullish = type === 'bullish';
        const pricePivots = findPivots(recentCloses, isBullish ? 'low' : 'high', sensitivity);
        const indPivots = findPivots(indValues, isBullish ? 'low' : 'high', sensitivity);

        console.log(`Pivots found for ${type}: Price: ${pricePivots}, Ind: ${indPivots}`);

        if (pricePivots.length < 2 || indPivots.length < 2) return null;

        const pIndices = pricePivots.slice(-3);
        const iIndices = indPivots.slice(-3);

        const matchedPairs = [];
        for (const p of pIndices) {
            const match = iIndices.find(idx => Math.abs(idx - p) <= 4);
            if (match !== undefined) matchedPairs.push({ p, i: match });
        }

        console.log(`Matched pairs for ${type}:`, matchedPairs);

        if (matchedPairs.length < 2) return null;

        const last = matchedPairs[matchedPairs.length - 1];
        const prev = matchedPairs[matchedPairs.length - 2];

        const isRegular = isBullish
            ? (recentCloses[last.p] < recentCloses[prev.p] && indValues[last.i] > indValues[prev.i])
            : (recentCloses[last.p] > recentCloses[prev.p] && indValues[last.i] < indValues[prev.i]);

        const isHidden = isBullish
            ? (recentCloses[last.p] > recentCloses[prev.p] && indValues[last.i] < indValues[prev.i])
            : (recentCloses[last.p] < recentCloses[prev.p] && indValues[last.i] > indValues[prev.i]);

        if (!isRegular && !isHidden) return null;

        return {
            type: isBullish ? (isRegular ? 'REGULAR_BULL' : 'HIDDEN_BULL') : (isRegular ? 'REGULAR_BEAR' : 'HIDDEN_BEAR'),
            lastIdx: last.p,
            prevIdx: prev.p,
            lastVal: recentCloses[last.p],
            prevVal: recentCloses[prev.p],
            lastInd: indValues[last.i],
            prevInd: indValues[prev.i]
        };
    };

    return findSignals('bullish') || findSignals('bearish');
};

// TEST CASE: NET-like situation
// Price making Higher Lows, RSI making Higher Lows (No divergence)
const data = [];
for (let i = 0; i < 150; i++) {
    data.push({ close: 200 + i * 0.1 }); // Trending up
}
const rsiValues = data.map((_, i) => 40 + i * 0.1);

// Add some wiggles to create "pivots"
data[100].close = 185; // Low 1
data[110].close = 195; // High
data[120].close = 190; // Low 2 (Higher Low)
data[130].close = 203; // Current High

rsiValues[100] = 35; // RSI Low 1
rsiValues[110] = 50; // High
rsiValues[120] = 32; // RSI Low 2 (Lower Low) -> This should trigger HIDDEN BULL
rsiValues[130] = 58; // Current High

console.log("Test Hidden Bull:", scanForDivergences(data, rsiValues, 3));

// Add test for Regular Bull (Price LL, Indicator HL)
const rsiValues2 = [...rsiValues];
data[120].close = 180; // Price Low 2 (Lower Low)
rsiValues2[120] = 40; // RSI Low 2 (Higher Low)
console.log("Test Regular Bull:", scanForDivergences(data, rsiValues2, 3));
