# 📈 미국 기업 실적 검색기 (Earnings Viewer)

미국 상장 기업의 공식 **SEC EDGAR 10-K/10-Q 재무제표(15~20년)** 와 **실시간 주가/시가총액**을 일일 호출 제한 없이 무료로 분석할 수 있는 웹 애플리케이션입니다.

---

## 🌟 주요 기능

1. **🏛️ SEC EDGAR 공식 재무 데이터 (무제한 15~20년)**:
   - 미국 증권거래위원회(SEC) 공식 공시 데이터를 초고속으로 파싱하여 매출, 영업이익, 자산, 부채, 자기자본, 현금성 자산, 이익잉여금 등을 15~20년 장기 시계열로 제공합니다.
2. **📈 실시간 주가 및 시총 (Finnhub & Yahoo Finance)**:
   - 현재가, 전일비 변동률, 실시간 시가총액 및 기업 로고 지원.
3. **⚡ 스마트 엣지 & 로컬 캐싱**:
   - Cloudflare CDN 엣지 캐시 및 브라우저 로컬 캐시(14일)를 통해 한 번 조회한 데이터는 호출수 0회 및 0.01초 만에 렌더링.
4. **🧮 투자 분석 도구**:
   - 실적 추이 인터랙티브 차트 (Chart.js)
   - 예상 영업이익 또는 성장률(%) 기반 실시간 멀티플(배수) 및 기대 이익률(Yield %) 계산기
   - 3대 재무 건전성 지표 (자산/자기자본, 부채총계/부채비율, 총현금/이익잉여금)
   - 원화(KRW) / 달러(USD) 실시간 환율 자동 변환 및 가로/세로 테이블 레이아웃 전환

---

## ☁️ 클라우드플레어(Cloudflare Pages) 무료 웹 배포 방법 (추천)

Cloudflare Pages를 이용하면 **누구나 어디서든(모바일/PC) 접속 가능한 고유 웹 주소(`https://xxx.pages.dev`)**로 1분 만에 완전 무료 배포할 수 있습니다.

### 1단계: GitHub에 코드 Push
```bash
git add .
git commit -m "feat: Cloudflare Pages Functions 및 SEC EDGAR 엔진 탑재"
git push origin main
```

### 2단계: Cloudflare 대시보드에서 연동
1. [Cloudflare 대시보드](https://dash.cloudflare.com/)에 로그인합니다.
2. 좌측 메뉴에서 **Workers 및 Pages (Workers & Pages)** 클릭 → **애플리케이션 생성 (Create Application)** 클릭.
3. 상단 탭에서 **Pages** 선택 → **Git에 연결 (Connect to Git)** 클릭.
4. 본인의 GitHub 계정을 연동하고, 이 저장소(`Gemini` 또는 `Earning`)를 선택합니다.
5. 빌드 설정:
   - **프레임워크 사전 설정 (Framework preset)**: `없음 (None)`
   - **빌드 명령 (Build command)**: (비워둠)
   - **빌드 출력 디렉터리 (Build output directory)**: `.` (또는 루트 경로 그대로 둠)
6. **저장 및 배포 (Save and Deploy)** 클릭!

> 💡 **완료!** 약 1분 후 `https://[프로젝트명].pages.dev` 주소가 발급되며, 스마트폰이나 PC 어디서든 즉시 접속해 무제한 SEC 데이터로 사용하실 수 있습니다. (`functions/api/sec.js`가 자동으로 Cloudflare 서버리스 엣지 함수로 구동됩니다.)

---

## 💻 로컬(내 PC)에서 실행하는 방법

로컬에서 실행하고 싶을 때는 배치 파일 하나로 바로 실행할 수 있습니다:

1. [start.bat](start.bat) 파일을 더블 클릭합니다.
2. 자동으로 고속 SEC 로컬 서버가 실행되며 브라우저(`http://localhost:8000`)가 열립니다.
