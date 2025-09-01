document.addEventListener('DOMContentLoaded', function() {
    const FMP_API_BASE_URL = 'https://financialmodelingprep.com/api/v3/';
    const AV_API_BASE_URL = 'https://www.alphavantage.co/query';

    let financialChart = null;
    let currentTicker = null;
    let currentView = 'annual';
    let yearsToShow = 10;
    let displayCurrency = 'USD';
    let lastProfileData = null;
    let lastFinancialData = null;
    let fiscalYearEndMonth = null;
    let usdToKrwRate = null;

    // DOM Elements
    const FMP_API_KEY = 'yF4kjlrTqI7bphW8VCoq09Ama0jNkDUz';
    const SECOND_FMP_API_KEY = 'dxY7zyF2buPgzkurZfDd94y1Z2o4gNpb';
    const AV_API_KEY = 'IOLM32O12PSE4LDJ';
    const SECOND_AV_API_KEY = 'Q3H5NC59JKHFVB7X';

    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const loader = document.getElementById('loader');
    const errorMessage = document.getElementById('errorMessage');
    const resultsSection = document.getElementById('resultsSection');
    const companyProfile = document.getElementById('companyProfile');
    const dataTableContainer = document.getElementById('dataTableContainer');
    const annualBtn = document.getElementById('annualBtn');
    const quarterlyBtn = document.getElementById('quarterlyBtn');
    const usdBtn = document.getElementById('usdBtn');
    const krwBtn = document.getElementById('krwBtn');
    const yearsRange = document.getElementById('yearsRange');
    const yearsValue = document.getElementById('yearsValue');

    // Event Listeners
    searchButton.addEventListener('click', handleSearch);
    searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            hideAutocomplete();
            handleSearch();
        }
    });
    searchInput.addEventListener('input', debounce(handleAutocomplete, 300));
    annualBtn.addEventListener('click', () => switchView('annual'));
    quarterlyBtn.addEventListener('click', () => switchView('quarterly'));
    usdBtn.addEventListener('click', () => switchCurrency('USD'));
    krwBtn.addEventListener('click', () => switchCurrency('KRW'));

    yearsRange.addEventListener('input', (e) => {
        yearsToShow = parseInt(e.target.value);
        yearsValue.textContent = `${yearsToShow}년`;
    });
    yearsRange.addEventListener('change', () => {
        if (currentTicker) {
            fetchAndDisplayFinancials();
        }
    });

    function switchCurrency(currency) {
        displayCurrency = currency;
        usdBtn.classList.toggle('active', currency === 'USD');
        krwBtn.classList.toggle('active', currency === 'KRW');
        if (currentTicker) {
            rerenderData();
        }
    }

    function rerenderData() {
        if (lastProfileData) {
            renderProfile(lastProfileData);
        }
        if (lastFinancialData) {
            renderTable(lastFinancialData);
            renderChart(lastFinancialData);
        }
    }

    function switchView(view) {
        currentView = view;
        annualBtn.classList.toggle('active', view === 'annual');
        quarterlyBtn.classList.toggle('active', view === 'quarterly');
        yearsRange.disabled = false;
        if (view === 'annual') {
            yearsToShow = 10;
            yearsRange.max = 10;
        } else { // quarterly
            yearsToShow = 3;
            yearsRange.max = 10;
        }
        yearsRange.value = yearsToShow;
        yearsValue.textContent = `${yearsToShow}년`;
        if (currentTicker) {
            fetchAndDisplayFinancials();
        }
    }

    async function handleSearch() {
        const query = searchInput.value.trim();
        if (!query) {
            showError("분석할 기업명 또는 티커를 입력해주세요.");
            return;
        }
        showLoader(true);
        hideError();
        resultsSection.classList.add('hidden');
        lastProfileData = null;
        lastFinancialData = null;
        usdToKrwRate = null;

        try {
            const searchUrl = `${FMP_API_BASE_URL}search-ticker?query=${query}&limit=1&apikey=${FMP_API_KEY}`;
            const searchResponse = await fetch(searchUrl);
            if (!searchResponse.ok) throw new Error(`FMP API 요청 오류: ${searchResponse.statusText}`);
            const searchData = await searchResponse.json();
            if (searchData.length === 0) {
                throw new Error(`'${query}'에 해당하는 기업을 찾을 수 없습니다.`);
            }
            currentTicker = searchData[0].symbol;
            await fetchExchangeRate();
            await fetchAndDisplayProfile();
            await fetchAndDisplayFinancials();
            resultsSection.classList.remove('hidden');
        } catch (error) {
            showError(error.message);
        } finally {
            showLoader(false);
        }
    }

    async function fetchExchangeRate() {
        if (usdToKrwRate) return;
        try {
            const apiKey = 'ixCOgz4fZCVMO1h0wypjsh6r75on2HlP';
            let data = [];
            let searchDate = new Date();

            for (let i = 0; i < 7; i++) {
                const yyyy = searchDate.getFullYear();
                const mm = String(searchDate.getMonth() + 1).padStart(2, '0');
                const dd = String(searchDate.getDate()).padStart(2, '0');
                const dateStr = `${yyyy}${mm}${dd}`;

                const corsProxy = 'https://cors-anywhere.herokuapp.com/';
                const originalUrl = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${apiKey}&searchdate=${dateStr}&data=AP01`;
                const url = `${corsProxy}${originalUrl}`;
                
                const response = await fetch(url);
                if (response.ok) {
                    const result = await response.json();
                    console.log(`API response for ${dateStr}:`, result);
                    if (Array.isArray(result) && result.length > 0 && result[0].result === 1) {
                        data = result;
                        break; 
                    } else {
                        console.log(`No valid data for ${dateStr}.`);
                    }
                } else {
                    console.log(`Fetch not OK for ${dateStr}. Status: ${response.status}`);
                }
                searchDate.setDate(searchDate.getDate() - 1);
            }

            if (data && data.length > 0) {
                const usdData = data.find(item => item.cur_unit === 'USD');
                if (usdData && usdData.deal_bas_r) {
                    usdToKrwRate = parseFloat(usdData.deal_bas_r.replace(/,/g, ''));
                    console.log(`Fetched EximBank USD/KRW exchange rate: ${usdToKrwRate}`);
                } else {
                    throw new Error('API 응답에서 USD 환율 정보를 찾을 수 없습니다.');
                }
            } else {
                throw new Error('지난 7일간 유효한 환율 데이터를 가져올 수 없습니다.');
            }
        } catch (error) {
            console.error("Failed to fetch exchange rate from EximBank:", error);
            usdToKrwRate = 1300; // Fallback
            showError("수출입은행 환율 정보를 가져오지 못했습니다. 기본값(1300원/달러)을 사용합니다.");
        }
    }

    async function fetchAndDisplayProfile() {
        const apiKey = FMP_API_KEY;
        const quoteUrl = `${FMP_API_BASE_URL}quote/${currentTicker}?apikey=${apiKey}`;
        try {
            const response = await fetch(quoteUrl);
            if (!response.ok) return;
            const data = await response.json();
            if (data.length > 0) {
                lastProfileData = data[0];
                renderProfile(lastProfileData);
            }
        } catch (error) {
            console.error("프로필 정보 로딩 실패:", error);
        }
    }

    function renderProfile(data) {
        try {
            const change = data.change || 0;
            const changesPercentage = data.changesPercentage || 0;
            const changeColor = change >= 0 ? 'text-green-600' : 'text-red-600';
            const changeIcon = change >= 0 ? '▲' : '▼';
            const price = data.price || 0;
            const marketCap = data.marketCap || 0;

            companyProfile.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div>
                        <h2 class="text-2xl md:text-3xl font-bold">${data.name || 'N/A'} (${data.symbol || 'N/A'})</h2>
                        <p class="text-gray-500">${data.exchange || 'N/A'}</p>
                    </div>
                    <div class="text-right space-y-1">
                        <p class="text-3xl font-bold">${formatNumber(price, true)}</p>
                        <p class="${changeColor} font-semibold">
                            ${changeIcon} ${change.toFixed(2)} (${changesPercentage.toFixed(2)}%)
                        </p>
                        <p class="text-sm text-gray-600">시가총액: <span class="font-medium">${formatLargeNumber(marketCap)}</span></p>
                    </div>
                </div>
            `;
        } catch (e) {
            console.error("Error in renderProfile:", e);
            companyProfile.innerHTML = '<p class="text-red-500">프로필 표시 중 오류가 발생했습니다.</p>';
        }
    }

    async function fetchFromAlphaVantage(apiFunction, symbol) {
        const primaryKey = AV_API_KEY;
        const secondaryKey = SECOND_AV_API_KEY;
        let url = `${AV_API_BASE_URL}?function=${apiFunction}&symbol=${symbol}&apikey=${primaryKey}`;
        let response = await fetch(url);
        let data = await response.json();
        if (!response.ok || data["Error Message"] || data["Note"]) {
            url = `${AV_API_BASE_URL}?function=${apiFunction}&symbol=${symbol}&apikey=${secondaryKey}`;
            response = await fetch(url);
            data = await response.json();
            if (!response.ok || data["Error Message"] || data["Note"]) {
                const errorMessage = (data && (data["Error Message"] || data["Note"])) || `HTTP status ${response.status}`;
                throw new Error(`재무제표 데이터를 가져올 수 없습니다. Alpha Vantage API 호출에 실패했습니다: ${errorMessage}`);
            }
        }
        return data;
    }

    async function fetchAndDisplayFinancials() {
        showLoader(true);
        const fmpApiKey = FMP_API_KEY;
        let incomeStatements = [];
        let incomeDataRaw = null;
        let earningsDataRaw = null;
        let latestMarketCap = null;
        let sharesOutstanding = null;
        try {
            incomeDataRaw = await fetchFromAlphaVantage('INCOME_STATEMENT', currentTicker);
            earningsDataRaw = await fetchFromAlphaVantage('EARNINGS', currentTicker);
            if (incomeDataRaw.annualReports && incomeDataRaw.annualReports.length > 0) {
                const latestAnnualReport = incomeDataRaw.annualReports[0];
                fiscalYearEndMonth = new Date(latestAnnualReport.fiscalDateEnding).getMonth() + 1;
            } else {
                fiscalYearEndMonth = 12;
            }
            const quoteUrl = `${FMP_API_BASE_URL}quote/${currentTicker}?apikey=${fmpApiKey}`;
            const quoteResponse = await fetch(quoteUrl);
            if (quoteResponse.ok) {
                const quoteData = await quoteResponse.json();
                if (quoteData.length > 0) {
                    latestMarketCap = quoteData[0].marketCap;
                    sharesOutstanding = quoteData[0].sharesOutstanding;
                }
            }
            if (currentView === 'annual' && incomeDataRaw["annualReports"]) {
                incomeStatements = incomeDataRaw["annualReports"];
            } else if (currentView === 'quarterly' && incomeDataRaw["quarterlyReports"]) {
                incomeStatements = incomeDataRaw["quarterlyReports"];
            }
            if (incomeStatements.length === 0 && (!earningsDataRaw || earningsDataRaw.quarterlyEarnings.length === 0)) {
                if (incomeDataRaw && incomeDataRaw["Note"]) {
                     throw new Error(`Alpha Vantage API 응답: ${incomeDataRaw["Note"]}`);
                }
                throw new Error('재무 데이터가 없습니다.');
            }
            const processedData = processFinancialData(incomeStatements, latestMarketCap, earningsDataRaw, sharesOutstanding);
            lastFinancialData = processedData;
            renderTable(lastFinancialData);
            renderChart(lastFinancialData);
            return lastFinancialData;
        } catch (error) {
            showError(error.message);
            dataTableContainer.innerHTML = '';
            if (financialChart) {
                financialChart.destroy();
                financialChart = null;
            }
            return null;
        } finally {
            showLoader(false);
        }
    }

    function processFinancialData(incomeStatements, marketCap, earningsData, sharesOutstanding) {
        let combinedStatements = [...incomeStatements];
        if (currentView === 'quarterly' && earningsData && earningsData.quarterlyEarnings && sharesOutstanding) {
            const latestReportDate = combinedStatements.length > 0 ? new Date(combinedStatements[0].fiscalDateEnding) : new Date(0);
            const futureEarnings = earningsData.quarterlyEarnings
                .filter(e => new Date(e.fiscalDateEnding) > latestReportDate)
                .map(earning => {
                    const estimatedNetIncome = parseFloat(earning.estimatedEPS) * sharesOutstanding;
                    return {
                        fiscalDateEnding: earning.fiscalDateEnding,
                        isEstimate: true,
                        totalRevenue: null,
                        operatingIncome: null,
                        netIncome: estimatedNetIncome,
                        operatingMargin: null,
                        marketCapToOperatingIncome: null,
                        marketCapToNetIncome: (estimatedNetIncome > 0 && marketCap) ? marketCap / estimatedNetIncome : null,
                        revenueYoYChange: null,
                        operatingIncomeYoYChange: null,
                        netIncomeYoYChange: null,
                        revenueYoYIsGood: null,
                        operatingIncomeYoYIsGood: null,
                        netIncomeYoYIsGood: null,
                        fiscalQuarter: null
                    };
                });
            combinedStatements = [...futureEarnings.reverse(), ...combinedStatements];
        }
        const processed = combinedStatements.slice(0, yearsToShow * (currentView === 'annual' ? 1 : 4)).reverse().map((statement, index, arr) => {
            if (statement.isEstimate) {
                const statementDate = new Date(statement.fiscalDateEnding);
                let fiscalQuarter = null;
                if (fiscalYearEndMonth !== null) {
                    const reportMonth = statementDate.getMonth() + 1;
                    const fiscalYearStartMonth = (fiscalYearEndMonth % 12) + 1;
                    let monthDifference = (reportMonth - fiscalYearStartMonth + 12) % 12;
                    fiscalQuarter = Math.floor(monthDifference / 3) + 1;
                }
                statement.fiscalQuarter = fiscalQuarter;
                return statement;
            }
            const revenue = parseFloat(statement.totalRevenue);
            const operatingIncome = parseFloat(statement.operatingIncome);
            const netIncome = parseFloat(statement.netIncome);
            const operatingMargin = revenue > 0 ? (operatingIncome / revenue) * 100 : 0;
            const marketCapToOperatingIncome = (operatingIncome > 0 && marketCap) ? marketCap / operatingIncome : null;
            const marketCapToNetIncome = (netIncome > 0 && marketCap) ? marketCap / netIncome : null;
            let revenueYoYChange = null;
            let operatingIncomeYoYChange = null;
            let netIncomeYoYChange = null;
            let revenueYoYIsGood = null;
            let operatingIncomeYoYIsGood = null;
            let netIncomeYoYIsGood = null;
            const comparisonIndex = currentView === 'annual' ? index - 1 : index - 4;
            if (comparisonIndex >= 0) {
                const prevStatement = arr[comparisonIndex];
                if (prevStatement && !prevStatement.isEstimate) {
                    const prevRevenue = parseFloat(prevStatement.totalRevenue);
                    const prevOperatingIncome = parseFloat(prevStatement.operatingIncome);
                    const prevNetIncome = parseFloat(prevStatement.netIncome);
                    if (prevRevenue !== 0) {
                        revenueYoYChange = ((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100;
                        revenueYoYIsGood = revenue > prevRevenue;
                    }
                    if (prevOperatingIncome !== 0) {
                        operatingIncomeYoYChange = ((operatingIncome - prevOperatingIncome) / Math.abs(prevOperatingIncome)) * 100;
                        operatingIncomeYoYIsGood = operatingIncome > prevOperatingIncome;
                    }
                    if (prevNetIncome !== 0) {
                        netIncomeYoYChange = ((netIncome - prevNetIncome) / Math.abs(prevNetIncome)) * 100;
                        netIncomeYoYIsGood = netIncome > prevNetIncome;
                    }
                }
            }
            const statementDate = new Date(statement.fiscalDateEnding);
            let fiscalQuarter = null;
            if (fiscalYearEndMonth !== null) {
                const reportMonth = statementDate.getMonth() + 1;
                const fiscalYearStartMonth = (fiscalYearEndMonth % 12) + 1;
                let monthDifference = (reportMonth - fiscalYearStartMonth + 12) % 12;
                fiscalQuarter = Math.floor(monthDifference / 3) + 1;
            } else if (currentView === 'annual') {
                 fiscalQuarter = 4;
            }
            return {
                period: statement.fiscalDateEnding,
                isEstimate: false,
                revenue,
                operatingIncome,
                netIncome,
                operatingMargin,
                marketCapToOperatingIncome,
                marketCapToNetIncome,
                revenueYoYChange,
                operatingIncomeYoYChange,
                netIncomeYoYChange,
                revenueYoYIsGood,
                operatingIncomeYoYIsGood,
                netIncomeYoYIsGood,
                fiscalQuarter
            };
        });
        return processed.reverse();
    }

    function renderTable(data) {
        if (data.length === 0) {
            dataTableContainer.innerHTML = `<p class="text-center text-gray-500">표시할 데이터가 없습니다.</p>`;
            return;
        }
        let tableHTML = `<table class="min-w-full bg-white"><thead><tr>`;
        const headers = ['기간', '매출', '영업이익', '순이익', '영업이익률 (%)', '시총/영업이익', '시총/순이익'];
        headers.forEach(h => tableHTML += `<th>${h}</th>`);
        tableHTML += `</tr></thead><tbody>`;
        data.forEach((item, index) => {
            const revenueYoY = item.revenueYoYChange !== null ?
                `<span class="${item.revenueYoYIsGood ? 'text-red-600' : 'text-blue-600'}"> (${item.revenueYoYIsGood ? '▲' : '▼'}${item.revenueYoYChange.toFixed(1)}%)</span>` : '';
            const operatingIncomeYoY = item.operatingIncomeYoYChange !== null ?
                `<span class="${item.operatingIncomeYoYIsGood ? 'text-red-600' : 'text-blue-600'}"> (${item.operatingIncomeYoYIsGood ? '▲' : '▼'}${item.operatingIncomeYoYChange.toFixed(1)}%)</span>` : '';
            const netIncomeYoY = item.netIncomeYoYChange !== null ?
                `<span class="${item.netIncomeYoYIsGood ? 'text-red-600' : 'text-blue-600'}"> (${item.netIncomeYoYIsGood ? '▲' : '▼'}${item.netIncomeYoYChange.toFixed(1)}%)</span>` : '';
            let periodDisplay = item.period;
            if (item.isEstimate) {
                periodDisplay = `(E) ${item.period}`;
            }
            if (currentView === 'quarterly' && item.fiscalQuarter !== null) {
                periodDisplay += ` (${item.fiscalQuarter}Q)`;
            }
            tableHTML += `<tr>
                <td>${periodDisplay}</td>
                <td>${formatLargeNumber(item.revenue)}${revenueYoY}</td>
                <td>${formatLargeNumber(item.operatingIncome)}${operatingIncomeYoY}</td>
                <td>${formatLargeNumber(item.netIncome)}${netIncomeYoY}</td>
                <td>${item.operatingMargin !== null ? item.operatingMargin.toFixed(2) : 'N/A'}</td>
                <td>${item.marketCapToOperatingIncome ? item.marketCapToOperatingIncome.toFixed(2) : 'N/A'}</td>
                <td>${item.marketCapToNetIncome ? item.marketCapToNetIncome.toFixed(2) : 'N/A'}</td>
            </tr>`;
        });
        tableHTML += `</tbody></table>`;
        dataTableContainer.innerHTML = tableHTML;
    }

    function renderChart(data) {
        const ctx = document.getElementById('financialsChart').getContext('2d');
        if (financialChart) {
            financialChart.destroy();
        }
        if (data.length === 0) return;
        const labels = data.map(d => {
            let label = d.period;
            if (currentView === 'quarterly' && d.fiscalQuarter) {
                label += ` (${d.fiscalQuarter}Q)`;
            }
            if (d.isEstimate) {
                label = `(E) ${label}`;
            }
            return label;
        });
        const revenueData = data.map(d => d.revenue);
        const operatingIncomeData = data.map(d => d.operatingIncome);
        const netIncomeData = data.map(d => d.netIncome);
        const revenueColors = data.map(d => d.isEstimate ? 'rgba(54, 162, 235, 0.2)' : 'rgba(54, 162, 235, 0.6)');
        const operatingIncomeColors = data.map(d => d.isEstimate ? 'rgba(255, 99, 132, 0.2)' : 'rgba(255, 99, 132, 0.6)');
        const netIncomeColors = data.map(d => d.isEstimate ? 'rgba(153, 102, 255, 0.6)' : 'rgba(75, 192, 192, 0.6)');
        const revenueBorderColors = data.map(d => d.isEstimate ? 'rgba(54, 162, 235, 0.5)' : 'rgba(54, 162, 235, 1)');
        const operatingIncomeBorderColors = data.map(d => d.isEstimate ? 'rgba(255, 99, 132, 0.5)' : 'rgba(255, 99, 132, 1)');
        const netIncomeBorderColors = data.map(d => d.isEstimate ? 'rgba(153, 102, 255, 1)' : 'rgba(75, 192, 192, 1)');
        financialChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    { label: '매출', data: revenueData, backgroundColor: revenueColors, borderColor: revenueBorderColors, borderWidth: 1 },
                    { label: '영업이익', data: operatingIncomeData, backgroundColor: operatingIncomeColors, borderColor: operatingIncomeBorderColors, borderWidth: 1 },
                    { label: '순이익', data: netIncomeData, backgroundColor: netIncomeColors, borderColor: netIncomeBorderColors, borderWidth: 1 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: function(value) { return formatLargeNumber(value); } }
                    },
                    x: { ticks: { maxRotation: 90, minRotation: 45 } }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) { label += ': '; }
                                if (context.parsed.y !== null) {
                                    const dataPoint = data[context.dataIndex];
                                    if (dataPoint.isEstimate) { label = `(E) ${label}`; }
                                    label += formatLargeNumber(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    function formatNumber(num, isPrice = false) {
        if (num === null || num === undefined) return 'N/A';
        if (isPrice) {
            if (displayCurrency === 'USD') {
                return `$${num.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
            } else { // KRW
                if (!usdToKrwRate) return '환율 정보 없음';
                const krwValue = num * usdToKrwRate;
                return `₩${krwValue.toLocaleString('ko-KR', {maximumFractionDigits: 0})}`;
            }
        }
        return num.toLocaleString();
    }

    function formatLargeNumber(num) {
        if (num === null || num === undefined) return 'N/A';
        if (displayCurrency === 'KRW') {
            if (!usdToKrwRate) return '환율 정보 없음';
            const valueToFormat = num * usdToKrwRate;
            if (Math.abs(valueToFormat) >= 1e12) return `₩${(valueToFormat / 1e12).toFixed(2)}조`;
            if (Math.abs(valueToFormat) >= 1e8) return `₩${(valueToFormat / 1e8).toFixed(1)}억`;
            if (Math.abs(valueToFormat) >= 1e4) return `₩${(valueToFormat / 1e4).toFixed(0)}만`;
            return `₩${valueToFormat.toLocaleString('ko-KR')}`;
        } else { // 'USD'
            if (Math.abs(num) >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
            if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
            if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
            return `$${num.toLocaleString('en-US', {maximumFractionDigits: 0})}`;
        }
    }

    function showLoader(show) {
        loader.classList.toggle('hidden', !show);
    }

    function showError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
    }

    function hideError() {
        errorMessage.classList.add('hidden');
    }

    function debounce(func, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    }

    async function handleAutocomplete() {
        const query = searchInput.value.trim();
        const autocompleteResults = document.getElementById('autocomplete-results');
        if (query.length < 1) {
            hideAutocomplete();
            return;
        }
        const apiKey = FMP_API_KEY;
        const url = `${FMP_API_BASE_URL}search-ticker?query=${encodeURIComponent(query)}&limit=5&apikey=${apiKey}`;
        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const data = await response.json();
            renderAutocomplete(data);
        } catch (error) {
            console.error("Autocomplete error:", error);
            hideAutocomplete();
        }
    }

    function renderAutocomplete(data) {
        const autocompleteResults = document.getElementById('autocomplete-results');
        if (data.length === 0) {
            hideAutocomplete();
            return;
        }
        autocompleteResults.innerHTML = '';
        const list = document.createElement('ul');
        data.forEach(item => {
            const listItem = document.createElement('li');
            listItem.className = 'px-4 py-2 hover:bg-gray-100 cursor-pointer';
            listItem.textContent = `${item.name} (${item.symbol})`;
            listItem.addEventListener('click', () => {
                searchInput.value = item.symbol;
                hideAutocomplete();
                handleSearch();
            });
            list.appendChild(listItem);
        });
        autocompleteResults.appendChild(list);
        autocompleteResults.classList.remove('hidden');
    }

    function hideAutocomplete() {
        const autocompleteResults = document.getElementById('autocomplete-results');
        autocompleteResults.classList.add('hidden');
    }

    document.addEventListener('click', function(event) {
        const searchContainer = searchInput.parentElement;
        if (!searchContainer.contains(event.target)) {
            hideAutocomplete();
        }
    });
});