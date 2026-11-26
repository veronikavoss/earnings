// Cloudflare Pages Functions - /api/policy-rates
// 한·미·일 중앙은행 기준금리 실시간 & 1년 시계열 파서

export async function onRequest(context) {
    const { request } = context;
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }

    try {
        const start = new Date();
        start.setFullYear(start.getFullYear() - 1);
        const startStr = start.toISOString().slice(0, 10);

        const [nyRes, bisRes, bokRes] = await Promise.allSettled([
            fetch('https://markets.newyorkfed.org/api/rates/unsecured/effr/last/260.json', {
                headers: { 'Accept': 'application/json', 'User-Agent': 'EarningsViewer/1.0' }
            }).then(r => r.ok ? r.json() : null),
            fetch(`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.JP+KR?startPeriod=${startStr}&format=csv`, {
                headers: { 'Accept': 'text/csv', 'User-Agent': 'EarningsViewer/1.0' }
            }).then(r => r.ok ? r.text() : null),
            fetch('https://www.bok.or.kr/portal/main/main.do', {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EarningsViewer/1.0)' }
            }).then(r => r.ok ? r.text() : null)
        ]);

        const history = { US: [], JP: [], KR: [] };
        const rates = {};
        const summarizeSeries = (series, isWithinDays = 7) => {
            if (!series || series.length === 0) return null;
            const latest = series[series.length - 1];
            let prevDistinctVal = latest.value;
            let lastChangeDate = latest.date;
            for (let i = series.length - 2; i >= 0; i--) {
                if (Math.abs(series[i].value - latest.value) > 1e-6) {
                    prevDistinctVal = series[i].value;
                    lastChangeDate = series[i + 1].date;
                    break;
                }
            }
            const decisionDiff = Number((latest.value - prevDistinctVal).toFixed(4));
            const ageDays = (Date.now() - new Date(lastChangeDate + 'T00:00:00Z').getTime()) / (1000 * 60 * 60 * 24);
            const recentDiff = (Math.abs(decisionDiff) > 1e-6 && ageDays <= isWithinDays) ? decisionDiff : null;
            return { latest, decisionDiff, recentDiff };
        };

        if (nyRes.status === 'fulfilled' && nyRes.value && Array.isArray(nyRes.value.refRates)) {
            history.US = nyRes.value.refRates
                .filter(r => r.effectiveDate && (r.targetRateFrom != null || r.percentRate != null))
                .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
                .map(r => {
                    const hasRange = r.targetRateFrom != null && r.targetRateTo != null;
                    const mid = hasRange ? (Number(r.targetRateFrom) + Number(r.targetRateTo)) / 2 : Number(r.percentRate);
                    return {
                        date: r.effectiveDate,
                        dateStr: r.effectiveDate.replace(/-/g, ''),
                        value: Number(mid.toFixed(4)),
                        min: r.targetRateFrom != null ? Number(r.targetRateFrom) : mid,
                        max: r.targetRateTo != null ? Number(r.targetRateTo) : mid
                    };
                });
            const sum = summarizeSeries(history.US);
            if (sum) {
                const { latest, decisionDiff, recentDiff } = sum;
                const valText = (latest.min !== latest.max)
                    ? `${latest.min.toFixed(2)}~${latest.max.toFixed(2)}%`
                    : `${latest.value.toFixed(2)}%`;
                rates.US = { label: '미국 기준금리', valText, rawVal: latest.value, chgVal: decisionDiff, changeNum: recentDiff, effectiveDate: latest.date };
            }
        }

        if (bisRes.status === 'fulfilled' && typeof bisRes.value === 'string') {
            const parsed = { JP: [], KR: [] };
            for (const line of bisRes.value.split(/\r?\n/)) {
                const m = line.match(/^D,(JP|KR),.*,(\d{4}-\d{2}-\d{2}),(-?\d+(?:\.\d+)?),/);
                if (m) {
                    const v = parseFloat(m[3]);
                    if (!isNaN(v)) parsed[m[1]].push({ date: m[2], dateStr: m[2].replace(/-/g, ''), value: v });
                }
            }
            history.JP = parsed.JP.sort((a, b) => a.date.localeCompare(b.date));
            history.KR = parsed.KR.sort((a, b) => a.date.localeCompare(b.date));
        }

        if (bokRes.status === 'fulfilled' && typeof bokRes.value === 'string') {
            const bokMatch = bokRes.value.match(/기준금리<\/strong>\s*<span[^>]*>\s*<span[^>]*>\s*<em>([0-9.]+)<\/em>/i);
            if (bokMatch) {
                const liveKr = parseFloat(bokMatch[1]);
                if (!isNaN(liveKr)) {
                    const todayStr = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
                    const lastPt = history.KR[history.KR.length - 1];
                    if (!lastPt || Math.abs(lastPt.value - liveKr) > 1e-6 || lastPt.date < todayStr) {
                        if (lastPt && lastPt.date === todayStr) lastPt.value = liveKr;
                        else history.KR.push({ date: todayStr, dateStr: todayStr.replace(/-/g, ''), value: liveKr });
                    }
                }
            }
        }

        const jpSum = summarizeSeries(history.JP);
        if (jpSum) rates.JP = { label: '일본 기준금리', valText: `${jpSum.latest.value.toFixed(2)}%`, rawVal: jpSum.latest.value, chgVal: jpSum.decisionDiff, changeNum: jpSum.recentDiff, effectiveDate: jpSum.latest.date };
        const krSum = summarizeSeries(history.KR);
        if (krSum) rates.KR = { label: '한국 기준금리', valText: `${krSum.latest.value.toFixed(2)}%`, rawVal: krSum.latest.value, chgVal: krSum.decisionDiff, changeNum: krSum.recentDiff, effectiveDate: krSum.latest.date };

        return new Response(JSON.stringify({ ok: true, rates, history }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=1800, s-maxage=1800'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || '기준금리 조회 오류' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
