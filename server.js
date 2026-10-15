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
                tickerMap.set(item.ticker.toUpperCase(), String(item.cik_str));
            }
        });
        console.log(`[SEC Server] Loaded ${tickerMap.size} tickers into memory.`);
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
    const cik = tickerMap.get(cleanTicker);
    if (!cik) {
        throw new Error(`티커 '${cleanTicker}'의 CIK 정보를 찾을 수 없습니다.`);
    }

    const paddedCik = String(cik).padStart(10, '0');
    const secUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`;
    
    const response = await fetch(secUrl, {
        headers: {
            'User-Agent': 'EarningsViewer admin@earningsviewer.io',
            'Accept-Encoding': 'gzip, deflate'
        }
    });

    if (!response.ok) {
        throw new Error(`SEC EDGAR 응답 오류: HTTP ${response.status}`);
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 [Earnings Viewer] SEC EDGAR 고속 서버가 시작되었습니다!`);
    console.log(`🌐 웹 브라우저 주소: http://localhost:${PORT}`);
    console.log(`🏛️ SEC EDGAR 공식 10-K/10-Q 15~20년 데이터 무제한 제공`);
    console.log(`=======================================================`);
});
