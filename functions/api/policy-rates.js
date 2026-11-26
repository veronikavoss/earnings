// Cloudflare Pages Functions - /api/policy-rates
// 한·미·일 중앙은행 기준금리 실시간 & 5년 시계열 파서

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
        const now = new Date();
        const start = new Date(now);
        start.setFullYear(start.getFullYear() - 5);
        const startStr = start.toISOString().slice(0, 10);
        const endStr = now.toISOString().slice(0, 10);

        const [nyRes, bisRes, bokRes] = await Promise.allSettled([
            fetch(`https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate=${startStr}&endDate=${endStr}`, {
                headers: { 'Accept': 'application/json', 'User-Agent': 'EarningsViewer/1.0' }
            }).then(r => r.ok ? r.json() : null),
            fetch(`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.JP+KR?startPeriod=${startStr}&detail=dataonly&format=csv`, {
                headers: { 'Accept': 'text/csv', 'User-Agent': 'EarningsViewer/1.0' }
            }).then(r => r.ok ? r.text() : null),
            fetch('https://www.bok.or.kr/portal/main/main.do', {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EarningsViewer/1.0)' }
            }).then(r => r.ok ? r.text() : null)
        ]);

        const history = { US: [], JP: [], KR: [] };
        const rates = {};
        const summarizeSeries = (series) => {
            if (!series || series.length === 0) return null;
            const latest = series[series.length - 1];
            const refDate = new Date(latest.date + 'T00:00:00Z');
            refDate.setUTCDate(refDate.getUTCDate() - 30);
            const monthAgoStr = refDate.toISOString().slice(0, 10);
            let prevMonthVal = series[0].value;
            for (let i = series.length - 1; i >= 0; i--) {
                if (series[i].date <= monthAgoStr) {
                    prevMonthVal = series[i].value;
                    break;
                }
            }
            const momDiff = Number((latest.value - prevMonthVal).toFixed(4));
            return { latest, momDiff };
        };

        if (nyRes.status === 'fulfilled' && nyRes.value && Array.isArray(nyRes.value.refRates)) {
            history.US = nyRes.value.refRates
                .filter(r => r.effectiveDate && (r.targetRateTo != null || r.percentRate != null))
                .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
                .map(r => {
                    const topVal = r.targetRateTo != null ? Number(r.targetRateTo) : Number(r.percentRate);
                    return {
                        date: r.effectiveDate,
                        dateStr: r.effectiveDate.replace(/-/g, ''),
                        value: Number(topVal.toFixed(4))
                    };
                });
            const sum = summarizeSeries(history.US);
            if (sum) {
                rates.US = { label: '미국 기준금리', valText: `${sum.latest.value.toFixed(2)}%`, rawVal: sum.latest.value, chgVal: sum.momDiff, changeNum: sum.momDiff, effectiveDate: sum.latest.date };
            }
        }

        if (bisRes.status === 'fulfilled' && typeof bisRes.value === 'string') {
            const parsed = { JP: [], KR: [] };
            for (const line of bisRes.value.split(/\r?\n/)) {
                const m = line.match(/^D,(JP|KR),(?:.*?,)?(\d{4}-\d{2}-\d{2}),(-?\d+(?:\.\d+)?)/);
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
        if (jpSum) rates.JP = { label: '일본 기준금리', valText: `${jpSum.latest.value.toFixed(2)}%`, rawVal: jpSum.latest.value, chgVal: jpSum.momDiff, changeNum: jpSum.momDiff, effectiveDate: jpSum.latest.date };
        const krSum = summarizeSeries(history.KR);
        if (krSum) rates.KR = { label: '한국 기준금리', valText: `${krSum.latest.value.toFixed(2)}%`, rawVal: krSum.latest.value, chgVal: krSum.momDiff, changeNum: krSum.momDiff, effectiveDate: krSum.latest.date };

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
