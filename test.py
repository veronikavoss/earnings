import requests
import json
import sys

# Alpha Vantage API 키를 여기에 입력하세요.
# https://www.alphavantage.co/support/#api-key 에서 발급받을 수 있습니다.
API_KEY = 'YOUR_ALPHA_VANTAGE_API_KEY' 

def get_income_statement(symbol):
    # Alpha Vantage Income Statement API 엔드포인트
    url = f'https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol={symbol}&apikey={API_KEY}'
    
    try:
        response = requests.get(url)
        response.raise_for_status()  # HTTP 오류 발생 시 예외 발생
        data = response.json()
        
        if "quarterlyReports" in data:
            print(f"--- {symbol} 분기 손익계산서 ---")
            for report in data["quarterlyReports"]:
                print(f"  회계 기간: {report.get('fiscalDateEnding')}")
                print(f"  매출액 (totalRevenue): {report.get('totalRevenue')}")
                print(f"  영업이익 (operatingIncome): {report.get('operatingIncome')}")
                print(f"  순이익 (netIncome): {report.get('netIncome')}")
                print("-" * 30)
            return data["quarterlyReports"]
        elif "Note" in data:
            print(f"API 호출 제한 또는 오류: {data['Note']}")
        else:
            print(f"'{symbol}'에 대한 분기 손익계산서 데이터를 찾을 수 없습니다.")
            print(data) # 전체 응답을 출력하여 디버깅에 도움
        return None
            
    except requests.exceptions.RequestException as e:
        print(f"API 요청 중 오류 발생: {e}")
        return None
    except json.JSONDecodeError:
        print("API 응답을 JSON으로 디코딩하는 데 실패했습니다. 응답이 유효한 JSON 형식이 아닐 수 있습니다.")
        print(response.text) # 원본 응답 텍스트 출력
        return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        ticker = sys.argv[1].upper()
        get_income_statement(ticker)
    else:
        print("사용법: python test.py <티커>")
        print("예시: python test.py AAPL")