// _worker.js - Cloudflare Workers / Pages 통합 엔트리포인트
// Cloudflare Workers(workers.dev) 및 Pages(pages.dev) 모두에서 /api/sec 및 정적 자산을 완벽하게 서빙합니다.

let cachedTickerMap = null;

// 1. SEC EDGAR 통합 재무제표 파서
function parseSecFacts(json, ticker) {
    const gaap = json?.facts?.['us-gaap'] || {};
    const ifrs = json?.facts?.['ifrs-full'] || {};
    const dei = json?.facts?.['dei'] || {};

    function getAllEntries(tagCandidates) {
        let all = [];
        for (const tag of tagCandidates) {
            const concept = gaap[tag] || ifrs[tag];
            if (concept && concept.units) {
                const unitKey = concept.units.USD ? 'USD' : Object.keys(concept.units)[0];
                if (unitKey && Array.isArray(concept.units[unitKey]) && concept.units[unitKey].length > 0) {
                    all.push(...concept.units[unitKey]);
                }
            }
        }
        return all;
    }

    const revEntries = getAllEntries([
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'SalesRevenueNet',
        'Revenues',
        'Revenue',
        'RevenueFromContractsWithCustomers',
        'RevenueFromSaleOfGoods',
        'RevenuesNetOfInterestExpense',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'TotalRevenuesAndOtherIncome'
    ]);

    const opEntries = getAllEntries([
        'OperatingIncomeLoss',
        'OperatingIncome',
        'ProfitLossFromOperatingActivities',
        'OperatingProfitLoss',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
        'ProfitLossBeforeTax',
        'NetIncomeLoss',
        'ProfitLoss'
    ]);

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

    // 4분기(Q4) 자동 차감 복원
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

const POPULAR_CIK_FALLBACK = {
    'AAPL': '320193',
    'NVDA': '1045810',
    'MSFT': '789019',
    'TSLA': '1318605',
    'AMZN': '1018724',
    'GOOGL': '1652044',
    'GOOG': '1652044',
    'META': '1326801',
    'MU': '723125',
    'AMD': '2488',
    'INTC': '50863',
    'NFLX': '1065280',
    'AVGO': '1730168',
    'IBM': '51143',
    'QCOM': '804328',
    'TSM': '1046179',
    'ASML': '937966',
    'BABA': '1577552',
    'NVO': '353278',
    'TM': '1094517',
    'SONY': '313838',
    'ARM': '1973239',
    'CPNG': '1834584',
    'JPM': '19617',
    'BAC': '70858',
    'PLTR': '1321655',
    'COIN': '1679788',
    'SMCI': '1375365',
    'LLY': '59478',
    'PFE': '78003',
    'MRK': '310158',
    'JNJ': '200406',
    'ABBV': '1551152'
};

function populateTickerMap(map, list) {
    if (!Array.isArray(list)) list = Object.values(list || {});
    list.forEach(item => {
        if (item?.ticker && item?.cik_str != null) {
            const t = item.ticker.toUpperCase().trim();
            const cik = String(item.cik_str);
            map.set(t, cik);
            if (t.includes('-')) {
                map.set(t.replace(/-/g, '.'), cik);
                map.set(t.replace(/-/g, ''), cik);
            }
            if (t.includes('.')) {
                map.set(t.replace(/\./g, '-'), cik);
                map.set(t.replace(/\./g, ''), cik);
            }
        }
    });
}

async function getTickerMap(requestOrigin, env) {
    if (cachedTickerMap && cachedTickerMap.size > 0) {
        return cachedTickerMap;
    }

    const map = new Map();
    Object.entries(POPULAR_CIK_FALLBACK).forEach(([t, c]) => {
        map.set(t, c);
        if (t.includes('-')) map.set(t.replace(/-/g, '.'), c);
    });

    if (env?.ASSETS) {
        try {
            const assetRes = await env.ASSETS.fetch(new URL('/company_tickers.json', requestOrigin));
            if (assetRes.ok) {
                const data = await assetRes.json();
                populateTickerMap(map, data);
                cachedTickerMap = map;
                return map;
            }
        } catch (e) {}
    }

    try {
        const ghRes = await fetch('https://raw.githubusercontent.com/veronikavoss/earnings/main/company_tickers.json');
        if (ghRes.ok) {
            const data = await ghRes.json();
            populateTickerMap(map, data);
            cachedTickerMap = map;
            return map;
        }
    } catch (e) {}

    return map;
}

async function handleSecApi(request, env) {
    const url = new URL(request.url);
    const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();

    if (!ticker) {
        return new Response(JSON.stringify({ ok: false, error: 'ticker 파라미터가 필요합니다.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
    }

    try {
        const tickerMap = await getTickerMap(url.origin, env);
        let cik = tickerMap.get(ticker)
               || tickerMap.get(ticker.replace(/\./g, '-'))
               || tickerMap.get(ticker.replace(/-/g, '.'))
               || tickerMap.get(ticker.replace(/[\.\-]/g, ''));

        if (!cik) {
            return new Response(JSON.stringify({ ok: false, error: `티커 '${ticker}'의 CIK 정보를 찾을 수 없습니다. 올바른 미국 상장 기업 티커인지 확인해 주세요.` }), {
                status: 404,
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const paddedCik = String(cik).padStart(10, '0');
        const secUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

        let secRes;
        let attempts = 0;
        while (attempts < 2) {
            attempts++;
            try {
                secRes = await fetch(secUrl, {
                    headers: {
                        'User-Agent': 'EarningsViewer admin@earningsviewer.io',
                        'Accept-Encoding': 'gzip, deflate'
                    }
                });
                if (secRes.ok) break;
                if (secRes.status === 404) {
                    return new Response(JSON.stringify({ ok: false, error: `해당 기업('${ticker}')은 SEC에 등록된 10-K/10-Q/20-F XBRL 재무제표 공시가 없습니다. (ETF, 스팩, 펀드 등은 개별 기업 재무제표가 공시되지 않습니다.)` }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
                    });
                }
                if (secRes.status === 429) {
                    return new Response(JSON.stringify({ ok: false, error: 'SEC EDGAR 요청 한도(초당 10회) 초과로 잠시 지연되었습니다. 1~2초 후 다시 시도해 주세요.' }), {
                        status: 429,
                        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
                    });
                }
            } catch (err) {
                if (attempts >= 2) throw err;
                await new Promise(r => setTimeout(r, 600));
            }
        }

        if (!secRes || !secRes.ok) {
            return new Response(JSON.stringify({ ok: false, error: `SEC EDGAR 응답 오류: HTTP ${secRes ? secRes.status : '네트워크 오류'}` }), {
                status: secRes ? secRes.status : 500,
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
            });
        }

        const factsJson = await secRes.json();
        const parsed = parseSecFacts(factsJson, ticker);

        const result = {
            ok: true,
            ticker,
            cik: paddedCik,
            entityName: factsJson.entityName || ticker,
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

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=604800, s-maxage=604800'
            }
        });
    } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message || '서버 오류' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS Preflight
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

        // 1. /api/sec 요청 처리
        if (url.pathname === '/api/sec') {
            return handleSecApi(request, env);
        }

        // 2. /api/status 상태 확인
        if (url.pathname === '/api/status') {
            return new Response(JSON.stringify({ ok: true, version: '2.0.0', platform: 'Cloudflare Worker' }), {
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // 3. 정적 파일 서빙
        if (env?.ASSETS) {
            return env.ASSETS.fetch(request);
        }

        return fetch(request);
    }
};
