import tkinter as tk
from tkinter import ttk, messagebox
import requests
import threading
import os

# --- 설정 --- #
# 아래 따옴표 안에 본인의 Financial Modeling Prep (FMP) API 키를 입력하세요.
API_KEY = "yF4kjlrTqI7bphW8VCoq09Ama0jNkDUz"

class AutocompleteEntry(ttk.Entry):
    """사용자 입력을 기반으로 자동완성 추천을 보여주는 Entry 위젯"""
    def __init__(self, parent, *args, **kwargs):
        super().__init__(parent, *args, **kwargs)

        self.parent = parent
        self._suggestions = []
        self._debounce_timer = None

        # 추천 목록을 보여줄 Listbox 생성
        self.listbox = tk.Listbox(parent, font=('Malgun Gothic', 10), relief=tk.SOLID, borderwidth=1)
        self.listbox.bind("<Button-1>", self.on_item_select)
        self.listbox.bind("<Button-3>", self.on_item_select) # 오른쪽 마우스 클릭 (표준)

        self.bind("<KeyRelease>", self.on_key_release)
        self.bind("<FocusOut>", lambda e: self.hide_listbox())

    def on_key_release(self, event):
        """키 입력이 있을 때마다 호출됩니다."""
        # 타이핑 멈춤을 감지하기 위한 디바운스(debounce) 타이머 설정
        if self._debounce_timer:
            self.after_cancel(self._debounce_timer)
        
        # 300ms 후에 추천 목록을 가져오는 함수를 호출
        self._debounce_timer = self.after(300, self.fetch_suggestions)

    def fetch_suggestions(self):
        """(스레드에서 실행) API를 호출하여 자동완성 추천 목록을 가져옵니다."""
        query = self.get().strip()
        if not query or len(query) < 2:
            self.hide_listbox()
            return

        # GUI가 멈추지 않도록 별도 스레드에서 API 호출
        thread = threading.Thread(target=self._api_call, args=(query,))
        thread.daemon = True
        thread.start()

    def _api_call(self, query):
        url = f"https://financialmodelingprep.com/api/v3/search?query={query}&limit=7&apikey={API_KEY}"
        try:
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            data = response.json()
            # GUI 업데이트는 메인 스레드에서 실행해야 함
            self.parent.after(0, self.update_listbox, data)
        except requests.exceptions.RequestException as e:
            print(f"[자동완성 오류] {e}")

    def update_listbox(self, data):
        """가져온 데이터로 Listbox를 업데이트하고 화면에 표시합니다."""
        self.listbox.delete(0, tk.END)
        self._suggestions = []

        if not data:
            self.hide_listbox()
            return

        for item in data:
            # 표시 형식: Apple Inc. (AAPL)
            display_text = f"{item.get('name')} ({item.get('symbol')})"
            self.listbox.insert(tk.END, display_text)
            self._suggestions.append(item.get('symbol'))

        if self._suggestions:
            self.show_listbox()
        else:
            self.hide_listbox()

    def on_item_select(self, event):
        """Listbox에서 항목을 선택했을 때 호출됩니다."""
        if not self.listbox.curselection():
            return
        
        selected_index = self.listbox.curselection()[0]
        selected_ticker = self._suggestions[selected_index]

        self.delete(0, tk.END)
        self.insert(0, selected_ticker)
        self.hide_listbox()
        self.focus_set() # Entry 위젯에 포커스 설정
        self.icursor(tk.END) # 커서를 맨 뒤로 이동

    def show_listbox(self):
        """Entry 위젯 바로 아래에 Listbox를 표시합니다."""
        x = self.winfo_x()
        y = self.winfo_y() + self.winfo_height()
        width = self.winfo_width()
        self.listbox.place(x=x, y=y, width=width)
        self.listbox.lift()

    def hide_listbox(self):
        self.listbox.place_forget()

class EarningsGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("기업 실적 분석 (FMP API)")
        self.root.geometry("950x450")

        style = ttk.Style(self.root)
        style.theme_use('clam')
        style.configure('TLabel', font=('Malgun Gothic', 10)); style.configure('TButton', font=('Malgun Gothic', 10)); style.configure('TEntry', font=('Malgun Gothic', 10)); style.configure("Treeview.Heading", font=('Malgun Gothic', 10, 'bold'))

        main_frame = ttk.Frame(self.root, padding="10 10 10 10")
        main_frame.pack(fill=tk.BOTH, expand=True)

        input_frame = ttk.LabelFrame(main_frame, text="조회 정보 입력", padding="10")
        input_frame.pack(fill=tk.X, pady=5)

        ttk.Label(input_frame, text="Ticker:").grid(row=0, column=0, padx=5, pady=5, sticky="w")
        # 기존 Entry를 AutocompleteEntry로 교체
        self.ticker_entry = AutocompleteEntry(input_frame, width=50)
        self.ticker_entry.grid(row=0, column=1, padx=5, pady=5, sticky="ew")
        self.ticker_entry.bind("<Return>", self.start_fetch_thread)

        self.search_button = ttk.Button(input_frame, text="실적 조회", command=self.start_fetch_thread)
        self.search_button.grid(row=0, column=2, padx=10, pady=5, ipady=4)
        input_frame.columnconfigure(1, weight=1)

        result_frame = ttk.LabelFrame(main_frame, text="조회 결과", padding="10")
        result_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        columns = ("date", "revenue", "operating_income", "op_margin", "net_income", "mkt_cap_multiple")
        self.tree = ttk.Treeview(result_frame, columns=columns, show="headings")
        self.tree.heading("date", text="회계 마감일"); self.tree.heading("revenue", text="총수익(매출)"); self.tree.heading("operating_income", text="영업이익"); self.tree.heading("op_margin", text="영업이익률 (%)"); self.tree.heading("net_income", text="순이익"); self.tree.heading("mkt_cap_multiple", text="시총/영업이익 (배)")
        self.tree.column("date", anchor="center", width=100); self.tree.column("revenue", anchor="e", width=130); self.tree.column("operating_income", anchor="e", width=130); self.tree.column("op_margin", anchor="center", width=110); self.tree.column("net_income", anchor="e", width=130); self.tree.column("mkt_cap_multiple", anchor="center", width=120)
        scrollbar = ttk.Scrollbar(result_frame, orient=tk.VERTICAL, command=self.tree.yview); self.tree.configure(yscroll=scrollbar.set); scrollbar.pack(side=tk.RIGHT, fill=tk.Y); self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.status_label = ttk.Label(main_frame, text="조회할 기업의 Ticker를 입력하세요.", relief=tk.SUNKEN, anchor="w")
        self.status_label.pack(side=tk.BOTTOM, fill=tk.X)

    def start_fetch_thread(self, event=None):
        if not API_KEY or API_KEY == "YOUR_FMP_API_KEY":
            messagebox.showerror("API 키 필요", "스크립트 파일(earnings_gui.py)을 열어 API_KEY 변수에 FMP API 키를 입력해주세요.")
            return

        ticker = self.ticker_entry.get().strip().upper()
        if not ticker:
            messagebox.showerror("오류", "기업 Ticker를 입력해주세요.")
            return

        self.ticker_entry.hide_listbox() # 조회 시작 시 리스트박스 숨기기
        self.search_button.config(state="disabled")
        self.status_label.config(text=f"'{ticker}' 데이터 조회 중...")
        self.tree.delete(*self.tree.get_children())
        
        thread = threading.Thread(target=self.fetch_and_display_data, args=(ticker, API_KEY))
        thread.daemon = True
        thread.start()

    def fetch_and_display_data(self, ticker, api_key):
        income_url = f"https://financialmodelingprep.com/api/v3/income-statement/{ticker}?limit=10&apikey={api_key}"
        profile_url = f"https://financialmodelingprep.com/api/v3/profile/{ticker}?apikey={api_key}"
        try:
            income_response = requests.get(income_url, timeout=10)
            profile_response = requests.get(profile_url, timeout=10)
            income_response.raise_for_status()
            profile_response.raise_for_status()
            self.root.after(0, self.update_ui, income_response.json(), profile_response.json(), ticker)
        except requests.exceptions.RequestException as e:
            self.root.after(0, self.handle_error, str(e))

    def update_ui(self, income_data, profile_data, ticker):
        self.search_button.config(state="normal")
        if not income_data or (isinstance(income_data, dict) and income_data.get('Error Message')):
            error_msg = (income_data.get('Error Message') if isinstance(income_data, dict) else f"'{ticker}'에 대한 손익계산서 데이터를 찾을 수 없습니다.")
            self.status_label.config(text=error_msg); messagebox.showwarning("조회 실패", error_msg)
            return

        market_cap = profile_data[0].get('mktCap') if profile_data and isinstance(profile_data, list) and profile_data[0] else None
        if not market_cap:
            messagebox.showwarning("데이터 부족", f"'{ticker}'의 시가총액 정보를 가져올 수 없어 일부 데이터는 표시되지 않습니다.")

        for report in income_data:
            revenue, op_income = report.get('revenue'), report.get('operatingIncome')
            op_margin = f"{(op_income / revenue) * 100:.2f}%" if revenue and op_income and revenue != 0 else "N/A"
            mkt_cap_multiple = f"{market_cap / op_income:.2f}배" if market_cap and op_income and op_income > 0 else "N/A"
            self.tree.insert("", tk.END, values=(report.get('date', 'N/A'), self.format_currency(revenue), self.format_currency(op_income), op_margin, self.format_currency(report.get('netIncome')), mkt_cap_multiple))
        self.status_label.config(text=f"'{ticker}' 실적 조회 완료.")

    def handle_error(self, error_message):
        self.search_button.config(state="normal")
        self.status_label.config(text="오류 발생. 다시 시도해주세요.")
        messagebox.showerror("요청 오류", f"데이터 요청 중 오류가 발생했습니다:\n{error_message}")

    def format_currency(self, value):
        if value is None or not isinstance(value, (int, float)): return "N/A"
        return f"${value / 1_000_000:,.0f}M"

if __name__ == "__main__":
    app_root = tk.Tk()
    app = EarningsGUI(app_root)
    app_root.mainloop()
