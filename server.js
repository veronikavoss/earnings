const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
const ROOT_DIR = __dirname;

// 1. Ticker -> CIK 매핑 로드
let tickerMap = new Map();
try {
    const tickersPath = path.join(ROOT_DIR, 'company_tickers.json');
    if (fs.existsSync(tickersPath)) {
        const raw = JSON.parse(fs.readFileSync(tickersPath, 'utf8'));
        const list = Array.isArray(raw) ? raw : Object.values(raw);
        list.forEach(item => {
            if (item && item.ticker && item.cik_str != null) {
                const t = item.ticker.toUpperCase().trim();
                const cik = String(item.cik_str);
                tickerMap.set(t, cik);
                // 점(.)과 하이픈(-) 변환 변형 등록 (예: BRK-B <-> BRK.B <-> BRKB)
                if (t.includes('-')) {
                    tickerMap.set(t.replace(/-/g, '.'), cik);
                    tickerMap.set(t.replace(/-/g, ''), cik);
                }
                if (t.includes('.')) {
                    tickerMap.set(t.replace(/\./g, '-'), cik);
                    tickerMap.set(t.replace(/\./g, ''), cik);
                }
            }
        });
        console.log(`[SEC Server] Loaded ${tickerMap.size} ticker variants into memory.`);
    }
} catch (e) {
    console.error('[SEC Server] Failed to load company_tickers.json:', e);
}

// 2. SEC EDGAR 통합 재무제표 파서 (US-GAAP + IFRS + 외국계 ADR 20-F/6-K + 금융주 완벽 지원)
function parseSecFacts(json, ticker) {
    const gaap = json?.facts?.['us-gaap'] || {};
    const ifrs = json?.facts?.['ifrs-full'] || {};
    const dei = json?.facts?.['dei'] || {};

    function getAllEntries(tagCandidates) {
        let all = [];
        for (const tag of tagCandidates) {
            const concept = gaap[tag] || ifrs[tag];
            if (concept && concept.units) {
                // USD 단위 최우선, 없을 시 자국 통화(EUR, TWD, CNY, JPY 등) 첫 번째 단위 사용
                const unitKey = concept.units.USD ? 'USD' : Object.keys(concept.units)[0];
                if (unitKey && Array.isArray(concept.units[unitKey]) && concept.units[unitKey].length > 0) {
                    all.push(...concept.units[unitKey]);
                }
            }
        }
        return all;
    }

    // 매출 태그 (일반 제조/테크 US-GAAP + IFRS + 금융/은행)
    const revEntries = getAllEntries([
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'SalesRevenueNet',
        'Revenues',
        'Revenue',
        'RevenueFromContractsWithCustomers',
        'RevenueFromSaleOfGoods',
        'RevenuesNetOfInterestExpense', // 은행/금융
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'TotalRevenuesAndOtherIncome'
    ]);

    // 영업이익 및 이익 태그 (일반 제조/테크 + IFRS + 제약/바이오 세전이익 + 당기순이익)
    const opEntries = getAllEntries([
        'OperatingIncomeLoss',
        'OperatingIncome',
        'ProfitLossFromOperatingActivities',
        'OperatingProfitLoss',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', // 일라이 릴리(LLY), 화이자(PFE), 머크(MRK) 등 제약사
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
        'ProfitLossBeforeTax',
        'NetIncomeLoss',
        'ProfitLoss'
    ]);

    // 자산, 부채, 자본, 현금, 잉여금
    const assetEntries = getAllEntries(['Assets']);
    const liabEntries = getAllEntries(['Liabilities']);
    const equityEntries = getAllEntries([
        'StockholdersEquity',
        'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
        'Equity',
        'EquityAttributableToOwnersOfParent'
    ]);
    const cashEntries = getAllEntries([
        'CashAndCashEquivalentsAtCarryingValue',
        'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
        'CashAndCashEquivalents'
    ]);
    const reEntries = getAllEntries([
        'RetainedEarningsAccumulatedDeficit',
        'RetainedEarnings'
    ]);

    let shareEntries = [];
    if (dei['EntityCommonStockSharesOutstanding']?.units?.shares) {
        shareEntries.push(...dei['EntityCommonStockSharesOutstanding'].units.shares);
    }
    if (gaap['CommonStockSharesOutstanding']?.units?.shares) {
        shareEntries.push(...gaap['CommonStockSharesOutstanding'].units.shares);
    }
    if (ifrs['NumberOfSharesOutstanding']?.units?.shares) {
        shareEntries.push(...ifrs['NumberOfSharesOutstanding'].units.shares);
    }

    // 연간 리포트 (미국 10-K, 외국계 ADR 20-F, 캐나다 40-F)
    const annualForms = ['10-K', '20-F', '40-F'];
    const annualMap = new Map();
    revEntries.forEach(item => {
        if (annualForms.includes(item.form) && item.end && item.val != null) {
            if (item.start) {
                const days = (new Date(item.end) - new Date(item.start)) / (1000 * 60 * 60 * 24);
                if (days < 300) return;
            }
            const date = item.end;
            if (!annualMap.has(date)) annualMap.set(date, { fiscalDateEnding: date });
            if (!annualMap.get(date).totalRevenue) annualMap.get(date).totalRevenue = String(item.val);
        }
    });

    opEntries.forEach(item => {
        if (annualForms.includes(item.form) && item.end && item.val != null) {
            if (item.start) {
                const days = (new Date(item.end) - new Date(item.start)) / (1000 * 60 * 60 * 24);
                if (days < 300) return;
            }
            const date = item.end;
            if (!annualMap.has(date)) annualMap.set(date, { fiscalDateEnding: date });
            if (!annualMap.get(date).operatingIncome) annualMap.get(date).operatingIncome = String(item.val);
        }
    });

    const annualReports = Array.from(annualMap.values())
        .filter(r => r.totalRevenue != null || r.operatingIncome != null)
        .sort((a, b) => new Date(b.fiscalDateEnding) - new Date(a.fiscalDateEnding));

    // 분기/반기 리포트 (미국 10-Q, 외국계 6-K)
    const quarterlyMap = new Map();
    revEntries.forEach(item => {
        if (item.end && item.val != null) {
            let isQuarter = false;
            if (item.start) {
                const days = (new Date(item.end) - new Date(item.start)) / (1000 * 60 * 60 * 24);
                if (days >= 60 && days <= 125) isQuarter = true;
            } else if (item.form === '10-Q' || item.form === '6-K') {
                isQuarter = true;
            }
            if (isQuarter) {
                const date = item.end;
                if (!quarterlyMap.has(date)) quarterlyMap.set(date, { fiscalDateEnding: date });
                if (!quarterlyMap.get(date).totalRevenue) quarterlyMap.get(date).totalRevenue = String(item.val);
            }
        }
    });

    opEntries.forEach(item => {
        if (item.end && item.val != null) {
            let isQuarter = false;
            if (item.start) {
                const days = (new Date(item.end) - new Date(item.start)) / (1000 * 60 * 60 * 24);
                if (days >= 60 && days <= 125) isQuarter = true;
            } else if (item.form === '10-Q' || item.form === '6-K') {
                isQuarter = true;
            }
            if (isQuarter) {
                const date = item.end;
                if (!quarterlyMap.has(date)) quarterlyMap.set(date, { fiscalDateEnding: date });
                if (!quarterlyMap.get(date).operatingIncome) quarterlyMap.get(date).operatingIncome = String(item.val);
            }
        }
    });

    // 4분기(Q4) 자동 채우기: 연간(10-K/20-F) 실적에서 1~3분기를 차감하여 누락된 4분기 실적 복원
    annualReports.forEach(ann => {
        const annDate = ann.fiscalDateEnding;
        if (quarterlyMap.has(annDate)) return;

        const annRev = Number(ann.totalRevenue);
        const annOp = Number(ann.operatingIncome);
        if (isNaN(annRev) && isNaN(annOp)) return;

        const annTime = new Date(annDate).getTime();
        const prevQuarters = Array.from(quarterlyMap.values()).filter(q => {
            const qTime = new Date(q.fiscalDateEnding).getTime();
            const diffDays = (annTime - qTime) / (1000 * 60 * 60 * 24);
            return diffDays > 30 && diffDays <= 330;
        }).sort((a, b) => new Date(b.fiscalDateEnding) - new Date(a.fiscalDateEnding));

        if (prevQuarters.length >= 3) {
            const q123 = prevQuarters.slice(0, 3);
            let sumRev = 0, hasRev = true;
            let sumOp = 0, hasOp = true;

            for (const q of q123) {
                if (q.totalRevenue != null && !isNaN(Number(q.totalRevenue))) {
                    sumRev += Number(q.totalRevenue);
                } else {
                    hasRev = false;
                }
                if (q.operatingIncome != null && !isNaN(Number(q.operatingIncome))) {
                    sumOp += Number(q.operatingIncome);
                } else {
                    hasOp = false;
                }
            }

            const q4Data = { fiscalDateEnding: annDate };
            if (!isNaN(annRev) && hasRev && annRev >= sumRev) {
                q4Data.totalRevenue = String(annRev - sumRev);
            }
            if (!isNaN(annOp) && hasOp) {
                q4Data.operatingIncome = String(annOp - sumOp);
            }

            if (q4Data.totalRevenue != null || q4Data.operatingIncome != null) {
                quarterlyMap.set(annDate, q4Data);
            }
        }
    });

    const quarterlyReports = Array.from(quarterlyMap.values())
        .filter(r => r.totalRevenue != null || r.operatingIncome != null)
        .sort((a, b) => new Date(b.fiscalDateEnding) - new Date(a.fiscalDateEnding));

    function getLatestInstant(entries) {
        if (!entries || entries.length === 0) return null;
        const sorted = [...entries].sort((a, b) => new Date(b.end || b.filed) - new Date(a.end || a.filed));
        return sorted[0]?.val != null ? String(sorted[0].val) : null;
    }

    const latestBalance = {
        fiscalDateEnding: quarterlyReports[0]?.fiscalDateEnding || annualReports[0]?.fiscalDateEnding || '',
        totalAssets: getLatestInstant(assetEntries),
        totalLiabilities: getLatestInstant(liabEntries),
        totalShareholderEquity: getLatestInstant(equityEntries),
        cashAndCashEquivalentsAtCarryingValue: getLatestInstant(cashEntries),
        retainedEarnings: getLatestInstant(reEntries),
        commonStockSharesOutstanding: getLatestInstant(shareEntries)
    };

    return {
        annualReports,
        quarterlyReports,
        latestBalance
    };
}

// 3. SEC 데이터 비동기 요청 처리
async function fetchSecEdgar(ticker) {
    const cleanTicker = ticker.toUpperCase().trim();
    let cik = tickerMap.get(cleanTicker)
           || tickerMap.get(cleanTicker.replace(/\./g, '-'))
           || tickerMap.get(cleanTicker.replace(/-/g, '.'))
           || tickerMap.get(cleanTicker.replace(/[\.\-]/g, ''));

    if (!cik) {
        throw new Error(`티커 '${cleanTicker}'의 CIK 정보를 찾을 수 없습니다. 올바른 미국 상장 주식 티커인지 확인해 주세요.`);
    }

    const paddedCik = String(cik).padStart(10, '0');
    const secUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;
    
    let response;
    let attempts = 0;
    while (attempts < 2) {
        attempts++;
        try {
            response = await fetch(secUrl, {
                headers: {
                    'User-Agent': 'EarningsViewer admin@earningsviewer.io',
                    'Accept-Encoding': 'gzip, deflate'
                }
            });
            if (response.ok) break;
            if (response.status === 404) {
                throw new Error(`해당 기업('${cleanTicker}')은 SEC에 등록된 10-K/10-Q/20-F XBRL 재무제표 공시가 없습니다. (ETF, 스팩, 펀드 등은 개별 기업 재무제표가 공시되지 않습니다.)`);
            }
            if (response.status === 429) {
                throw new Error('SEC EDGAR 요청 한도(초당 10회) 초과로 잠시 지연되었습니다. 1~2초 후 다시 시도해 주세요.');
            }
        } catch (netErr) {
            if (attempts >= 2) throw netErr;
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (!response || !response.ok) {
        throw new Error(`SEC EDGAR 응답 오류: HTTP ${response ? response.status : '네트워크 연결 실패'}`);
    }

    const factsJson = await response.json();
    const parsed = parseSecFacts(factsJson, cleanTicker);

    return {
        ok: true,
        ticker: cleanTicker,
        cik: paddedCik,
        entityName: factsJson.entityName || cleanTicker,
        source: 'SEC EDGAR',
        income: {
            annualReports: parsed.annualReports,
            quarterlyReports: parsed.quarterlyReports
        },
        balance: {
            annualReports: [parsed.latestBalance],
            quarterlyReports: [parsed.latestBalance]
        }
    };
}

// 4. HTTP 서버 구동
const server = http.createServer(async (req, res) => {
    // CORS 헤더 설정 (file:/// 또는 타 포트 접근 허용)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8000'}`);
    const pathname = parsedUrl.pathname;

    // API: SEC 재무제표 조회
    if (pathname === '/api/sec') {
        const ticker = parsedUrl.searchParams.get('ticker');
        if (!ticker) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: 'ticker 파라미터가 필요합니다.' }));
            return;
        }

        try {
            const data = await fetchSecEdgar(ticker);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
        } catch (err) {
            console.error(`[SEC API Error for ${ticker}]:`, err.message);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
    }

    // API: 한·미·일 기준금리 조회 (5년 시계열 + 전월 대비 변동폭)
    if (pathname === '/api/policy-rates') {
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

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, rates, history }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: err.message }));
        }
        return;
    }

    // API: 서버 상태
    if (pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, tickersLoaded: tickerMap.size, version: '2.0.0' }));
        return;
    }

    // 정적 파일 서빙 (index.html, company_tickers.json 등)
    let filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'text/plain; charset=utf-8';
        if (ext === '.html') contentType = 'text/html; charset=utf-8';
        else if (ext === '.json') contentType = 'application/json; charset=utf-8';
        else if (ext === '.js') contentType = 'application/javascript; charset=utf-8';
        else if (ext === '.css') contentType = 'text/css; charset=utf-8';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.ico') contentType = 'image/x-icon';

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n⚠️ [포트 충돌] 포트 ${PORT}이 이미 다른 프로세스에 의해 사용 중입니다.`);
        console.error(`기존 실행 중인 서버를 사용하거나, 포트를 종료 후 다시 실행해 주세요.\n`);
    } else {
        console.error('[SEC Server Error]:', err);
    }
});

process.on('uncaughtException', (err) => {
    console.error('[Uncaught Exception]:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]:', reason);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 [Earnings Viewer] SEC EDGAR 고속 서버가 시작되었습니다!`);
    console.log(`🌐 웹 브라우저 주소: http://localhost:${PORT}`);
    console.log(`🏛️ SEC EDGAR 공식 10-K/10-Q 15~20년 데이터 무제한 제공`);
    console.log(`=======================================================`);
});
