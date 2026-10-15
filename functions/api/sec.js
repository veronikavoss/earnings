// Cloudflare Pages Functions - /api/sec
// SEC EDGAR 재무제표 초고속 엣지 파서

let cachedTickerMap = null;

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

    // 영업이익 태그 (US-GAAP + IFRS + fallback)
    const opEntries = getAllEntries([
        'OperatingIncomeLoss',
        'OperatingIncome',
        'ProfitLossFromOperatingActivities',
        'OperatingProfitLoss',
        'ProfitLossBeforeTax',
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
    'LLY': '59478'
};

async function getTickerMap(requestOrigin, context) {
    if (cachedTickerMap && cachedTickerMap.size > 0) {
        return cachedTickerMap;
    }

    const map = new Map();
    // 인기 티커 우선 초기화
    Object.entries(POPULAR_CIK_FALLBACK).forEach(([t, c]) => map.set(t, c));

    // 1차: Cloudflare Pages ASSETS 바인딩에서 내부 파일 로드
    if (context?.env?.ASSETS) {
        try {
            const assetRes = await context.env.ASSETS.fetch(new URL('/company_tickers.json', requestOrigin));
            if (assetRes.ok) {
                const data = await assetRes.json();
                const list = Array.isArray(data) ? data : Object.values(data);
                list.forEach(item => {
                    if (item?.ticker && item?.cik_str != null) {
                        map.set(item.ticker.toUpperCase(), String(item.cik_str));
                    }
                });
                cachedTickerMap = map;
                return map;
            }
        } catch (e) {}
    }

    // 2차: Pages URL 자체 fetch
    try {
        const localRes = await fetch(`${requestOrigin}/company_tickers.json`);
        if (localRes.ok) {
            const data = await localRes.json();
            const list = Array.isArray(data) ? data : Object.values(data);
            list.forEach(item => {
                if (item?.ticker && item?.cik_str != null) {
                    map.set(item.ticker.toUpperCase(), String(item.cik_str));
                }
            });
            cachedTickerMap = map;
            return map;
        }
    } catch (e) {}

    // 3차: GitHub Raw 저장소에서 직접 로드
    try {
        const ghRes = await fetch('https://raw.githubusercontent.com/veronikavoss/earnings/main/company_tickers.json');
        if (ghRes.ok) {
            const data = await ghRes.json();
            const list = Array.isArray(data) ? data : Object.values(data);
            list.forEach(item => {
                if (item?.ticker && item?.cik_str != null) {
                    map.set(item.ticker.toUpperCase(), String(item.cik_str));
                }
            });
            cachedTickerMap = map;
            return map;
        }
    } catch (e) {}

    // 4차: SEC 공식 티커 매핑 파일에서 로드
    try {
        const secRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
            headers: { 'User-Agent': 'EarningsViewer admin@earningsviewer.io' }
        });
        if (secRes.ok) {
            const data = await secRes.json();
            const list = Object.values(data);
            list.forEach(item => {
                if (item?.ticker && item?.cik_str != null) {
                    map.set(item.ticker.toUpperCase(), String(item.cik_str));
                }
            });
            cachedTickerMap = map;
            return map;
        }
    } catch (e) {}

    return map;
}

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    // CORS preflight 처리
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

    const ticker = (url.searchParams.get('ticker') || '').trim().toUpperCase();
    if (!ticker) {
        return new Response(JSON.stringify({ ok: false, error: 'ticker 파라미터가 필요합니다.' }), {
            status: 400,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }

    try {
        const tickerMap = await getTickerMap(url.origin, context);
        const cik = tickerMap.get(ticker);
        if (!cik) {
            return new Response(JSON.stringify({ ok: false, error: `티커 '${ticker}'의 CIK 정보를 찾을 수 없습니다.` }), {
                status: 404,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        const paddedCik = String(cik).padStart(10, '0');
        const secUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;

        const secRes = await fetch(secUrl, {
            headers: {
                'User-Agent': 'EarningsViewer admin@earningsviewer.io',
                'Accept-Encoding': 'gzip, deflate'
            }
        });

        if (!secRes.ok) {
            return new Response(JSON.stringify({ ok: false, error: `SEC EDGAR 응답 오류: HTTP ${secRes.status}` }), {
                status: secRes.status,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                }
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

        // Cloudflare 글로벌 CDN 캐시 7일(604800초) 설정으로 전 세계 초고속 응답
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
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            }
        });
    }
}
