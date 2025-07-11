const FMP_API_BASE_URL = 'https://financialmodelingprep.com/api/v3/';
        const AV_API_BASE_URL = 'https://www.alphavantage.co/query';
        let financialChart = null;
        let currentTicker = null;
        let currentView = 'annual'; 
        let yearsToShow = 10; 

        let fiscalYearEndMonth = null; // New global variable 

        // DOM Elements
        const FMP_API_KEY = 'yF4kjlrTqI7bphW8VCoq09Ama0jNkDUz'; // 여기에 실제 FMP API 키를 입력하세요.
        const AV_API_KEY = 'IOLM32O12PSE4LDJ'; // 여기에 실제 Alpha Vantage API 키를 입력하세요.
        const SECOND_AV_API_KEY = 'Q3H5NC59JKHFVB7X'; // New second Alpha Vantage API key
        const searchInput = document.getElementById('searchInput');
        const searchButton = document.getElementById('searchButton');
        const loader = document.getElementById('loader');
        const errorMessage = document.getElementById('errorMessage');
        const resultsSection = document.getElementById('resultsSection');
        const companyProfile = document.getElementById('companyProfile');
        const dataTableContainer = document.getElementById('dataTableContainer');
        const annualBtn = document.getElementById('annualBtn');
        const quarterlyBtn = document.getElementById('quarterlyBtn');
        
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
        
        yearsRange.addEventListener('input', (e) => {
            yearsToShow = parseInt(e.target.value);
            yearsValue.textContent = `${yearsToShow}년`;
        });
        yearsRange.addEventListener('change', () => {
            if (currentTicker) {
                fetchAndDisplayFinancials();
            }
        });

        function switchView(view) {
            currentView = view;
            annualBtn.classList.toggle('active', view === 'annual');
            quarterlyBtn.classList.toggle('active', view === 'quarterly');
            yearsRange.disabled = false;
            yearsRange.max = view === 'annual' ? 10 : 5; // 분기는 최대 5년(20분기)으로 제한
            if (yearsToShow > yearsRange.max) {
                yearsToShow = yearsRange.max;
                yearsRange.value = yearsToShow;
            }
            yearsValue.textContent = `${yearsToShow}년`;
            if (currentTicker) {
                fetchAndDisplayFinancials();
            }
        }

        async function handleSearch() {
            const query = searchInput.value.trim();
            const fmpApiKey = FMP_API_KEY;
            const avApiKey = AV_API_KEY;

            console.log('handleSearch: 검색 쿼드:', query);
            console.log('handleSearch: FMP API 키 존재 여부:', !!fmpApiKey);
            console.log('handleSearch: Alpha Vantage API 키 존재 여부:', !!avApiKey);

            if (!fmpApiKey) {
                showError("FMP API 키를 입력해주세요.");
                return;
            }
            if (!avApiKey) {
                showError("Alpha Vantage API 키를 입력해주세요.");
                return;
            }
            if (!query) {
                showError("분석할 기업명 또는 티커를 입력해주세요.");
                return;
            }

            showLoader(true);
            hideError();
            resultsSection.classList.add('hidden');

            try {
                // 1. FMP API로 티커 검색 및 유효성 확인
                const searchUrl = `${FMP_API_BASE_URL}search-ticker?query=${query}&limit=1&apikey=${fmpApiKey}`;
                console.log('handleSearch: FMP 티커 검색 URL:', searchUrl);
                const searchResponse = await fetch(searchUrl);
                if (!searchResponse.ok) throw new Error(`FMP API 요청 오류: ${searchResponse.statusText}`);
                const searchData = await searchResponse.json();
                console.log('handleSearch: FMP 티커 검색 응답:', searchData);
                
                if (searchData.length === 0) {
                    throw new Error(`'${query}'에 해당하는 기업을 찾을 수 없습니다.`);
                }
                currentTicker = searchData[0].symbol;
                console.log('handleSearch: 현재 티커 설정됨:', currentTicker);

                // 2. FMP API로 프로필 정보 가져오기
                await fetchAndDisplayProfile();

                // 3. Alpha Vantage API로 재무 데이터 가져오기
                await fetchAndDisplayFinancials();
                
                resultsSection.classList.remove('hidden');

            } catch (error) {
                console.error('handleSearch: 오류 발생:', error);
                showError(error.message);
            } finally {
                showLoader(false);
            }
        }

            

        async function fetchAndDisplayProfile() {
            const apiKey = FMP_API_KEY;
            const quoteUrl = `${FMP_API_BASE_URL}quote/${currentTicker}?apikey=${apiKey}`;
            console.log('fetchAndDisplayProfile: FMP 프로필 URL:', quoteUrl);
            
            try {
                const response = await fetch(quoteUrl);
                if (!response.ok) {
                    console.warn('fetchAndDisplayProfile: 프로필 정보 API 요청 실패 (오류 아님):', response.statusText);
                    return; // 프로필 정보는 실패해도 계속 진행
                }
                const data = await response.json();
                console.log('fetchAndDisplayProfile: FMP 프로필 응답:', data);
                if (data.length > 0) {
                    renderProfile(data[0]);
                }
            } catch (error) {
                console.error("fetchAndDisplayProfile: 프로필 정보 로딩 실패:", error);
            }
        }
        
        function renderProfile(data) {
            const change = data.change || 0;
            const changesPercentage = data.changesPercentage || 0;
            const changeColor = change >= 0 ? 'text-green-600' : 'text-red-600';
            const changeIcon = change >= 0 ? '▲' : '▼';

            companyProfile.innerHTML = `
                <div class="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div>
                        <h2 class="text-2xl md:text-3xl font-bold">${data.name} (${data.symbol})</h2>
                        <p class="text-gray-500">${data.exchange}</p>
                    </div>
                    <div class="text-right space-y-1">
                        <p class="text-3xl font-bold">${formatNumber(data.price, true)}</p>
                        <p class="${changeColor} font-semibold">
                            ${changeIcon} ${formatNumber(change, true)} (${changesPercentage.toFixed(2)}%)
                        </p>
                        <p class="text-sm text-gray-600">시가총액: <span class="font-medium">${formatLargeNumber(data.marketCap)}</span></p>
                    </div>
                </div>
            `;
        }
        
        async function fetchAndDisplayFinancials() {
            showLoader(true);
            const avApiKey = AV_API_KEY;
            const fmpApiKey = FMP_API_KEY;
            const secondAvApiKey = SECOND_AV_API_KEY; // Get the second API key

            let incomeStatements = [];
            let incomeDataRaw = null;
            let marketCapDataRaw = [];

            try {
                // Try with primary AV API key
                let incomeStatementUrl = `${AV_API_BASE_URL}?function=INCOME_STATEMENT&symbol=${currentTicker}&apikey=${avApiKey}`;
                console.log('fetchAndDisplayFinancials: Alpha Vantage 재무제표 URL (Primary):', incomeStatementUrl);
                let incomeResponse = await fetch(incomeStatementUrl);
                
                if (!incomeResponse.ok) {
                    console.warn('fetchAndDisplayFinancials: Primary AV API call failed, trying secondary...');
                    // Try with secondary AV API key
                    incomeStatementUrl = `${AV_API_BASE_URL}?function=INCOME_STATEMENT&symbol=${currentTicker}&apikey=${secondAvApiKey}`;
                    console.log('fetchAndDisplayFinancials: Alpha Vantage 재무제표 URL (Secondary):', incomeStatementUrl);
                    incomeResponse = await fetch(incomeStatementUrl);
                }

                if (!incomeResponse.ok) throw new Error(`재무제표 데이터를 가져올 수 없습니다: ${incomeResponse.statusText}`);
                
                incomeDataRaw = await incomeResponse.json();

                if (incomeDataRaw["Error Message"] || incomeDataRaw["Note"]) {
                    throw new Error(`Alpha Vantage API 응답 오류: ${incomeDataRaw["Error Message"] || incomeDataRaw["Note"]}`);
                }

                // Determine fiscal year end month from the latest annual report
                if (incomeDataRaw.annualReports && incomeDataRaw.annualReports.length > 0) {
                    const latestAnnualReport = incomeDataRaw.annualReports[0]; // Data is newest first
                    fiscalYearEndMonth = new Date(latestAnnualReport.fiscalDateEnding).getMonth() + 1;
                    console.log(`Fiscal year end month determined: ${fiscalYearEndMonth}`);
                } else {
                    // Fallback if no annual reports are available, default to December
                    fiscalYearEndMonth = 12; 
                    console.log(`No annual reports found, defaulting fiscal year end month to 12.`);
                }

                // Fetch market cap data (always with FMP)
                const marketCapUrl = `${FMP_API_BASE_URL}historical-market-capitalization/${currentTicker}?limit=1000&apikey=${fmpApiKey}`;
                console.log('fetchAndDisplayFinancials: FMP 시가총액 URL:', marketCapUrl);
                const marketCapResponse = await fetch(marketCapUrl);
                marketCapDataRaw = marketCapResponse.ok ? await marketCapResponse.json() : [];

                if (currentView === 'annual' && incomeDataRaw["annualReports"]) {
                    incomeStatements = incomeDataRaw["annualReports"];
                    console.log('fetchAndDisplayFinancials: 연간 보고서 데이터:', incomeStatements);
                } else if (currentView === 'quarterly' && incomeDataRaw["quarterlyReports"]) {
                    incomeStatements = incomeDataRaw["quarterlyReports"];
                    console.log('fetchAndDisplayFinancials: 분기 보고서 데이터:', incomeStatements);
                }
                

                if (incomeStatements.length === 0) {
                    throw new Error('재무 데이터가 없습니다.');
                }

                const processedData = processFinancialData(incomeStatements, marketCapDataRaw);
                console.log('fetchAndDisplayFinancials: 처리된 재무 데이터:', processedData);
                renderTable(processedData);
                renderChart(processedData);

            } catch (error) {
                console.error('fetchAndDisplayFinancials: 오류 발생:', error);
                showError(error.message);
                // Hide table and chart on error
                dataTableContainer.innerHTML = '';
                if (financialChart) {
                    financialChart.destroy();
                    financialChart = null;
                }
            } finally {
                showLoader(false);
            }
        }
        
        function processFinancialData(incomeStatements, historicalMarketCaps) {
            // Alpha Vantage 데이터는 최신순으로 정렬되어 있으므로, 오래된 데이터부터 표시하기 위해 역순 정렬
            const processed = incomeStatements.slice(0, yearsToShow * (currentView === 'annual' ? 1 : 4)).reverse().map((statement, index, arr) => {
                const revenue = parseFloat(statement.totalRevenue);
                const operatingIncome = parseFloat(statement.operatingIncome);
                const operatingMargin = revenue > 0 ? (operatingIncome / revenue) * 100 : 0;

                // Find the closest market cap data for the period end date
                const statementDate = new Date(statement.fiscalDateEnding);
                let marketCap = null;
                if(historicalMarketCaps.length > 0) {
                    const closestMarketCap = historicalMarketCaps.reduce((prev, curr) => {
                        const prevDate = new Date(prev.date);
                        const currDate = new Date(curr.date);
                        return (Math.abs(currDate - statementDate) < Math.abs(prevDate - statementDate) ? curr : prev);
                    });
                    marketCap = closestMarketCap.marketCap;
                }

                const marketCapToOperatingIncome = (operatingIncome > 0 && marketCap) ? marketCap / operatingIncome : null;

                // Calculate YoY change
                let revenueYoYChange = null;
                let operatingIncomeYoYChange = null;

                if (currentView === 'annual' && index > 0) {
                    const prevStatement = arr[index - 1];
                    const prevRevenue = parseFloat(prevStatement.totalRevenue);
                    const prevOperatingIncome = parseFloat(prevStatement.operatingIncome);

                    if (prevRevenue !== 0) {
                        revenueYoYChange = ((revenue - prevRevenue) / prevRevenue) * 100;
                    }
                    if (prevOperatingIncome !== 0) {
                        operatingIncomeYoYChange = ((operatingIncome - prevOperatingIncome) / prevOperatingIncome) * 100;
                    }
                } else if (currentView === 'quarterly' && index >= 4) { // For quarterly, compare with 4 periods ago
                    const prevYearSameQuarterStatement = arr[index - 4];
                    const prevYearSameQuarterRevenue = parseFloat(prevYearSameQuarterStatement.totalRevenue);
                    const prevYearSameQuarterOperatingIncome = parseFloat(prevYearSameQuarterStatement.operatingIncome);

                    if (prevYearSameQuarterRevenue !== 0) {
                        revenueYoYChange = ((revenue - prevYearSameQuarterRevenue) / prevYearSameQuarterRevenue) * 100;
                    }
                    if (prevYearSameQuarterOperatingIncome !== 0) {
                        operatingIncomeYoYChange = ((operatingIncome - prevYearSameQuarterOperatingIncome) / prevYearSameQuarterOperatingIncome) * 100;
                    }
                }

                // Determine fiscal year-end month if annual data
                if (currentView === 'annual' && fiscalYearEndMonth === null) {
                    fiscalYearEndMonth = statementDate.getMonth() + 1; // Month is 0-indexed
                }

                // Calculate fiscal quarter based on the determined fiscal year end
                let fiscalQuarter = null;
                if (fiscalYearEndMonth !== null) {
                    const reportMonth = statementDate.getMonth() + 1; // 1-indexed month of the report
                    
                    // Calculate how many months the reportMonth is from the start of the fiscal year.
                    // The fiscal year starts in the month *after* the fiscalYearEndMonth.
                    const fiscalYearStartMonth = (fiscalYearEndMonth % 12) + 1;
                    
                    let monthDifference;
                    if (reportMonth >= fiscalYearStartMonth) {
                        monthDifference = reportMonth - fiscalYearStartMonth;
                    } else {
                        monthDifference = reportMonth - fiscalYearStartMonth + 12;
                    }
                    
                    fiscalQuarter = Math.floor(monthDifference / 3) + 1;
                } else if (currentView === 'annual') {
                     fiscalQuarter = 4; // Fallback for annual if month not determined
                }


                return {
                    period: statement.fiscalDateEnding,
                    revenue,
                    operatingIncome,
                    operatingMargin,
                    marketCapToOperatingIncome,
                    revenueYoYChange,
                    operatingIncomeYoYChange,
                    fiscalQuarter // Add fiscalQuarter to the returned object
                };
            });
            return processed;
        }

        
        
        

        function renderTable(data) {
            if (data.length === 0) {
                dataTableContainer.innerHTML = `<p class="text-center text-gray-500">표시할 데이터가 없습니다.</p>`;
                return;
            }
            
            let tableHTML = `<table class="min-w-full bg-white"><thead><tr>`;
            const headers = ['기간', '매출', '영업이익', '영업이익률 (%)', '시총/영업이익'];
            headers.forEach(h => tableHTML += `<th>${h}</th>`);
            tableHTML += `</tr></thead><tbody>`;

            data.forEach((item, index) => {
                const revenueYoY = item.revenueYoYChange !== null ? 
                    `<span class="${item.revenueYoYChange >= 0 ? 'text-red-600' : 'text-blue-600'}"> (${item.revenueYoYChange >= 0 ? '▲' : '▼'}${item.revenueYoYChange.toFixed(1)}%)</span>` : '';
                const operatingIncomeYoY = item.operatingIncomeYoYChange !== null ? 
                    `<span class="${item.operatingIncomeYoYChange >= 0 ? 'text-red-600' : 'text-blue-600'}"> (${item.operatingIncomeYoYChange >= 0 ? '▲' : '▼'}${item.operatingIncomeYoYChange.toFixed(1)}%)</span>` : '';

                let periodDisplay = item.period;
                if (currentView === 'quarterly' && item.fiscalQuarter !== null) {
                    periodDisplay = `${item.period} (${item.fiscalQuarter}Q)`;
                }
                // For annual, periodDisplay remains item.period as is.

                tableHTML += `<tr>
                    <td>${periodDisplay}</td>
                    <td>${formatLargeNumber(item.revenue)}${revenueYoY}</td>
                    <td>${formatLargeNumber(item.operatingIncome)}${operatingIncomeYoY}</td>
                    <td>${item.operatingMargin.toFixed(2)}</td>
                    <td>${item.marketCapToOperatingIncome ? item.marketCapToOperatingIncome.toFixed(2) : 'N/A'}</td>
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

            const labels = data.map(d => d.period);
            const revenueData = data.map(d => d.revenue);
            const operatingIncomeData = data.map(d => d.operatingIncome);

            financialChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '매출',
                            data: revenueData,
                            backgroundColor: 'rgba(54, 162, 235, 0.6)',
                            borderColor: 'rgba(54, 162, 235, 1)',
                            borderWidth: 1
                        },
                        {
                            label: '영업이익',
                            data: operatingIncomeData,
                            backgroundColor: 'rgba(255, 99, 132, 0.6)',
                            borderColor: 'rgba(255, 99, 132, 1)',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return formatLargeNumber(value);
                                }
                            }
                        },
                        x: {
                            ticks: {
                                maxRotation: 90,
                                minRotation: 45
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    let label = context.dataset.label || '';
                                    if (label) {
                                        label += ': ';
                                    }
                                    if (context.parsed.y !== null) {
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

        // Utility Functions
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
        
        function formatNumber(num, isPrice = false) {
             if (num === null || num === undefined) return 'N/A';
             const options = isPrice ? { maximumFractionDigits: 2 } : {};
             return num.toLocaleString('ko-KR', options);
        }

        function formatLargeNumber(num) {
            if (num === null || num === undefined) return 'N/A';
            if (Math.abs(num) >= 1e12) {
                return (num / 1e12).toFixed(2) + '조';
            }
            if (Math.abs(num) >= 1e8) {
                return (num / 1e8).toFixed(1) + '억';
            }
            if (Math.abs(num) >= 1e4) {
                return (num / 1e4).toFixed(0) + '만';
            }
            return num.toLocaleString();
        }