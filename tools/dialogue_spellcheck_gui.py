#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Read-only bulk QA for Korean dialogue TSV. Never writes the source TSV."""
import csv
import json
import re
import tkinter as tk
from dataclasses import asdict, dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from PIL import ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TSV = ROOT / "trDatas/dialogue-workflow/dialogue-translation.tsv"
DEFAULT_FONT = ROOT / "font/gulim.ttc"
KANA = re.compile(r"[\u3040-\u30ff\u31f0-\u31ff]")

# Deliberately conservative: every rule should be useful as a review candidate.
RULES = [
    (r"왠만", "웬만", "표준어", "'웬만'이 표준 표기입니다."),
    (r"금새", "금세", "표준어", "시간이 금방이라는 뜻은 '금세'입니다."),
    (r"몇일", "며칠", "표준어", "날짜를 세는 말은 '며칠'입니다."),
    (r"어떻해", "어떡해", "표준어", "'어떻게 해'의 준말은 '어떡해'입니다."),
    (r"할께", "할게", "어미", "약속·의지를 나타내는 어미는 '-ㄹ게'입니다."),
    (r"될께", "될게", "어미", "약속·의지를 나타내는 어미는 '-ㄹ게'입니다."),
    (r"갈께", "갈게", "어미", "약속·의지를 나타내는 어미는 '-ㄹ게'입니다."),
    (r"올께", "올게", "어미", "약속·의지를 나타내는 어미는 '-ㄹ게'입니다."),
    (r"할꺼야", "할 거야", "띄어쓰기", "의존 명사 '거'는 띄어 씁니다."),
    (r"갈꺼야", "갈 거야", "띄어쓰기", "의존 명사 '거'는 띄어 씁니다."),
    (r"될꺼야", "될 거야", "띄어쓰기", "의존 명사 '거'는 띄어 씁니다."),
    (r"올꺼야", "올 거야", "띄어쓰기", "의존 명사 '거'는 띄어 씁니다."),
    (r"할수([가-힣])", r"할 수\1", "띄어쓰기", "의존 명사 '수'는 띄어 씁니다."),
    (r"될수([가-힣])", r"될 수\1", "띄어쓰기", "의존 명사 '수'는 띄어 씁니다."),
    (r"갈수([가-힣])", r"갈 수\1", "띄어쓰기", "의존 명사 '수'는 띄어 씁니다."),
    (r"볼수([가-힣])", r"볼 수\1", "띄어쓰기", "의존 명사 '수'는 띄어 씁니다."),
    (r"되어있", "되어 있", "띄어쓰기", "보조 용언 '있다'는 띄어쓰기를 우선 검토합니다."),
    (r"돼있", "돼 있", "띄어쓰기", "보조 용언 '있다'는 띄어쓰기를 우선 검토합니다."),
    (r"하면돼", "하면 돼", "띄어쓰기", "'돼' 앞을 띄어 씁니다."),
    (r"하면되", "하면 되", "띄어쓰기", "'되다' 앞을 띄어 씁니다."),
    (r"안돼", "안 돼", "띄어쓰기", "부정 부사 '안'은 띄어쓰기를 우선 검토합니다."),
]


def unescape(value):
    marker="\ue000"
    return (value or "").replace("\\\\",marker).replace("\\n","\n").replace("\\t","\t").replace(marker,"\\")


@dataclass
class Issue:
    row_index:int; message_id:str; severity:str; category:str; line:int
    text:str; suggestion:str; reason:str


class App(tk.Tk):
    def __init__(self):
        super().__init__(); self.title("파랜드 사가 2 대사 맞춤법·표시 QA (읽기 전용)"); self.geometry("1500x900"); self.minsize(1100,700)
        self.tsv=tk.StringVar(value=str(DEFAULT_TSV)); self.font_path=tk.StringVar(value=str(DEFAULT_FONT)); self.query=tk.StringVar(); self.category=tk.StringVar(value="전체"); self.severity=tk.StringVar(value="확실"); self.status=tk.StringVar(value="TSV를 검사하세요.")
        self.rows=[]; self.issues=[]; self.visible=[]; self.font_cache={}; self._ui()

    def _ui(self):
        self.columnconfigure(0,weight=1); self.rowconfigure(2,weight=1)
        top=ttk.Frame(self,padding=8); top.grid(row=0,column=0,sticky="ew"); top.columnconfigure(1,weight=1)
        for r,(label,var,kind) in enumerate((("대사 TSV (읽기 전용)",self.tsv,"file"),("폭 검사 글꼴",self.font_path,"font"))):
            ttk.Label(top,text=label).grid(row=r,column=0,sticky="w"); ttk.Entry(top,textvariable=var).grid(row=r,column=1,sticky="ew",padx=6,pady=2); ttk.Button(top,text="...",command=lambda v=var,k=kind:self.browse(v,k),width=4).grid(row=r,column=2)
        ttk.Button(top,text="전체 검사",command=self.scan).grid(row=0,column=3,rowspan=2,sticky="ns",padx=(10,0))
        filters=ttk.Frame(self,padding=(8,0,8,8)); filters.grid(row=1,column=0,sticky="ew"); filters.columnconfigure(1,weight=1)
        ttk.Label(filters,text="결과 검색").grid(row=0,column=0); e=ttk.Entry(filters,textvariable=self.query); e.grid(row=0,column=1,sticky="ew",padx=6)
        ttk.Label(filters,text="유형").grid(row=0,column=2); ttk.Combobox(filters,textvariable=self.category,values=("전체","표준어","어미","띄어쓰기","일본어 잔존","공백","줄 수","표시 폭"),state="readonly",width=12).grid(row=0,column=3,padx=4)
        ttk.Label(filters,text="등급").grid(row=0,column=4); ttk.Combobox(filters,textvariable=self.severity,values=("전체","확실","검토"),state="readonly",width=8).grid(row=0,column=5,padx=4)
        ttk.Button(filters,text="JSON 저장",command=lambda:self.export("json")).grid(row=0,column=6,padx=(12,2)); ttk.Button(filters,text="CSV 저장",command=lambda:self.export("csv")).grid(row=0,column=7,padx=2); ttk.Label(filters,textvariable=self.status).grid(row=0,column=8,padx=(12,0))
        for v in (self.query,self.category,self.severity):v.trace_add("write",lambda *_:self.refresh())
        pane=ttk.PanedWindow(self,orient=tk.VERTICAL); pane.grid(row=2,column=0,sticky="nsew",padx=8,pady=(0,8))
        upper=ttk.Frame(pane); upper.rowconfigure(0,weight=1); upper.columnconfigure(0,weight=1); pane.add(upper,weight=3)
        cols=("severity","category","message_id","line","text","suggestion","reason"); self.tree=ttk.Treeview(upper,columns=cols,show="headings",selectmode="browse")
        specs=(("severity","등급",55),("category","유형",90),("message_id","메시지 ID",90),("line","줄",40),("text","현재 문장",380),("suggestion","제안",380),("reason","사유",300))
        for c,label,w in specs:self.tree.heading(c,text=label); self.tree.column(c,width=w,anchor="w",stretch=c in ("text","suggestion","reason"))
        self.tree.grid(row=0,column=0,sticky="nsew"); sb=ttk.Scrollbar(upper,orient="vertical",command=self.tree.yview); sb.grid(row=0,column=1,sticky="ns"); self.tree.configure(yscrollcommand=sb.set); self.tree.bind("<<TreeviewSelect>>",self.select)
        lower=ttk.LabelFrame(pane,text="문맥 확인 (수정 기능 없음)",padding=6); lower.columnconfigure(0,weight=1); lower.rowconfigure(0,weight=1); pane.add(lower,weight=2)
        self.context=tk.Text(lower,wrap="word",state="disabled",font=("Malgun Gothic",11)); self.context.grid(row=0,column=0,sticky="nsew")

    def browse(self,var,kind):
        p=Path(var.get() or ROOT); value=filedialog.askopenfilename(initialdir=str(p.parent),filetypes=[("TSV","*.tsv"),("Font","*.ttc *.ttf"),("모든 파일","*")]);
        if value:var.set(value)

    def font(self,size):
        size=max(1,size)
        if size not in self.font_cache:self.font_cache[size]=ImageFont.truetype(self.font_path.get(),size)
        return self.font_cache[size]

    def scan(self):
        try:
            with open(self.tsv.get(),"r",encoding="utf-8",newline="") as f: raw=list(csv.DictReader(f,delimiter="\t"))
            self.rows=[{k:unescape(v) for k,v in row.items()} for row in raw]; self.issues=[]; self.font_cache={}
            for idx,row in enumerate(self.rows):
                text=row.get("ko_text",""); mid=row.get("message_id","") or row.get("address","")
                if not text.strip():continue
                for pattern,repl,category,reason in RULES:
                    if re.search(pattern,text):
                        self.issues.append(Issue(idx,mid,"확실",category,0,text,re.sub(pattern,repl,text),reason))
                for n,line in enumerate(text.splitlines(),1):
                    if KANA.search(line):self.issues.append(Issue(idx,mid,"확실","일본어 잔존",n,line,line,"히라가나·가타카나가 남아 있습니다."))
                    if line.rstrip()!=line:self.issues.append(Issue(idx,mid,"검토","공백",n,line,line.rstrip(),"줄 끝 공백이 있습니다. 화면 배치 의도인지 확인하세요."))
                    if "\t" in line:self.issues.append(Issue(idx,mid,"확실","공백",n,line,line.replace("\t"," "),"탭 문자가 있습니다."))
                    if re.search(r"\S {2,}\S",line):self.issues.append(Issue(idx,mid,"검토","공백",n,line,re.sub(r"(?<=\S) {2,}(?=\S)"," ",line),"문장 중간에 연속 공백이 있습니다. 화면 정렬 의도인지 확인하세요."))
                    try:
                        size=int(row.get("font_size") or 12); width=float(self.font(size).getlength(line))
                        if width>196:self.issues.append(Issue(idx,mid,"검토","표시 폭",n,line,line,f"예상 폭 {width:.1f}px > 대사 안전 폭 196px. 실제 마스크를 확인하세요."))
                    except Exception:pass
                lines=text.splitlines()
                if len(lines)>3:self.issues.append(Issue(idx,mid,"검토","줄 수",0,text,text,f"대사가 {len(lines)}줄입니다. 게임 화면 허용 범위를 확인하세요."))
            self.refresh(); self.status.set(f"번역 {sum(bool(r.get('ko_text','').strip()) for r in self.rows):,}행 · 후보 {len(self.issues):,}건")
        except Exception as e:messagebox.showerror("검사 실패",str(e))

    def refresh(self):
        if not hasattr(self,"tree"):return
        q=self.query.get().strip().casefold(); cat=self.category.get(); sev=self.severity.get()
        self.visible=[i for i,x in enumerate(self.issues) if (cat=="전체" or x.category==cat) and (sev=="전체" or x.severity==sev) and (not q or q in (x.message_id+" "+x.text+" "+x.suggestion+" "+x.reason).casefold())]
        self.tree.delete(*self.tree.get_children())
        for n,i in enumerate(self.visible):
            x=self.issues[i]; self.tree.insert("","end",iid=str(i),values=(x.severity,x.category,x.message_id,x.line,x.text.replace("\n"," "),x.suggestion.replace("\n"," "),x.reason))
        if self.issues:self.status.set(f"표시 {len(self.visible):,} / 전체 {len(self.issues):,}")

    def select(self,_event=None):
        sel=self.tree.selection()
        if not sel:return
        x=self.issues[int(sel[0])]; parts=[]
        for idx,label in ((x.row_index-1,"[이전]"),(x.row_index,"[현재]"),(x.row_index+1,"[다음]")):
            if 0<=idx<len(self.rows):
                row=self.rows[idx]; mid=row.get("message_id","") or row.get("address",""); parts.append(f"{label} {mid}\n{row.get('ko_text','')}\n")
        parts.append(f"[검사 결과]\n등급: {x.severity} / 유형: {x.category}\n사유: {x.reason}\n\n[제안]\n{x.suggestion}")
        self.context.configure(state="normal"); self.context.delete("1.0","end"); self.context.insert("1.0","\n".join(parts)); self.context.configure(state="disabled")

    def export(self,kind):
        if not self.issues:messagebox.showwarning("결과 없음","먼저 전체 검사를 실행하세요."); return
        if not self.visible:messagebox.showwarning("표시 결과 없음","현재 필터에 해당하는 검사 결과가 없습니다."); return
        ext=".json" if kind=="json" else ".csv"; p=filedialog.asksaveasfilename(defaultextension=ext,initialfile="dialogue-spellcheck-report"+ext,filetypes=[(kind.upper(),"*"+ext)])
        if not p:return
        data=[asdict(self.issues[i]) for i in self.visible]
        if kind=="json":Path(p).write_text(json.dumps({"source":self.tsv.get(),"issues":data},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        else:
            with open(p,"w",encoding="utf-8-sig",newline="") as f:
                w=csv.DictWriter(f,fieldnames=list(data[0])); w.writeheader(); w.writerows(data)
        messagebox.showinfo("저장 완료",f"{len(data)}건을 저장했습니다.\n원본 TSV는 변경하지 않았습니다.")


if __name__=="__main__":App().mainloop()
