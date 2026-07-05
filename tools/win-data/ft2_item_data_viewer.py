#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ft2-win-data 추출 결과(json)를 보고 고치는 뷰어. 두 형식을 자동으로 구분한다.

  - item/magic/race-data-kr.json : [{id, name, comment}, ...] 리스트
  - EVENT*-dialogue-kr.json      : {source, events:[{label, lines:[{offset,text}], ...}]}

좌측 목록에서 항목을 고르면 우측 입력 필드에 뜨고, 값을 고치고 저장하면
같은 JSON 파일에 그대로 반영된다(이벤트 대사 형식도 원래 중첩 구조로
되돌려서 저장한다). 이벤트 형식에서는 "이름"이 대사가 속한 라벨이라
여러 줄이 같은 값을 공유하므로 읽기 전용으로 표시한다.

실행:
    python tools/ft2_item_data_viewer.py [json_path]
"""

import json
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PATH = ROOT / "tmp" / "ft2-win-data" / "item-data-kr.json"


def strip_trailing_line_whitespace(text):
    """줄 끝 공백만 제거한다. 강제 개행(\\n)과 줄 내부 공백은 그대로 둔다."""
    return "\n".join(line.rstrip(" \t\r") for line in text.split("\n"))


LINE_KEYS = ("lines", "narration")


def flatten_event_doc(doc):
    """{source, events:[{label, lines:[...], narration:[...]}]} -> 평평한 레코드 리스트."""
    records = []
    for event_index, event in enumerate(doc.get("events", [])):
        label = event.get("label", "")
        for kind in LINE_KEYS:
            for line_index, line in enumerate(event.get(kind, [])):
                name = label if kind == "lines" else f"{label} [narration]"
                records.append(
                    {
                        "id": line.get("offset", ""),
                        "name": name,
                        "comment": line.get("text", ""),
                        "_event_index": event_index,
                        "_kind": kind,
                        "_line_index": line_index,
                    }
                )
    return records


def apply_records_to_event_doc(doc, records):
    """평평한 레코드의 comment 값을 원래 events 중첩 구조에 다시 써 넣는다."""
    for rec in records:
        event = doc["events"][rec["_event_index"]]
        event[rec["_kind"]][rec["_line_index"]]["text"] = rec.get("comment", "")
    return doc


class ItemDataViewer(tk.Tk):
    def __init__(self, json_path):
        super().__init__()
        self.title("FT2 Item Data Viewer")
        self.geometry("980x600")
        self.minsize(760, 480)

        self.json_path = Path(json_path)
        self.records = []
        self.selected_index = None
        self.dirty = False
        self.doc_format = "flat"  # "flat" | "event"
        self.raw_doc = None  # event 포맷일 때 저장 시 되돌려 쓸 원본 문서

        self._build_ui()
        self.load(self.json_path)

    def _build_ui(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        top = ttk.Frame(self, padding=8)
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="File").grid(row=0, column=0, sticky="w")
        self.path_var = tk.StringVar(value=str(self.json_path))
        ttk.Entry(top, textvariable=self.path_var).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(top, text="Open...", command=self.browse_open).grid(row=0, column=2, padx=2)
        ttk.Button(top, text="Reload", command=lambda: self.load(Path(self.path_var.get()))).grid(row=0, column=3, padx=2)

        ttk.Label(top, text="Filter").grid(row=1, column=0, sticky="w", pady=(6, 0))
        self.filter_var = tk.StringVar()
        self.filter_var.trace_add("write", lambda *_: self._refresh_list())
        ttk.Entry(top, textvariable=self.filter_var).grid(row=1, column=1, sticky="ew", padx=4, pady=(6, 0))

        main = ttk.PanedWindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=8, pady=(0, 4))

        left = ttk.Frame(main)
        left.rowconfigure(0, weight=1)
        left.columnconfigure(0, weight=1)
        main.add(left, weight=2)

        self.tree = ttk.Treeview(left, columns=("id", "name"), show="headings", selectmode="browse")
        self.tree.heading("id", text="ID")
        self.tree.heading("name", text="이름")
        self.tree.column("id", width=70, anchor="e")
        self.tree.column("name", width=200, anchor="w")
        self.tree.grid(row=0, column=0, sticky="nsew")
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        scroll = ttk.Scrollbar(left, orient="vertical", command=self.tree.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=scroll.set)

        right = ttk.Frame(main, padding=(8, 0, 0, 0))
        right.columnconfigure(1, weight=1)
        right.rowconfigure(2, weight=1)
        main.add(right, weight=3)

        ttk.Label(right, text="ID").grid(row=0, column=0, sticky="w", pady=2)
        self.id_var = tk.StringVar()
        ttk.Entry(right, textvariable=self.id_var, state="readonly").grid(row=0, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="이름").grid(row=1, column=0, sticky="w", pady=2)
        self.name_var = tk.StringVar()
        self.name_entry = ttk.Entry(right, textvariable=self.name_var)
        self.name_entry.grid(row=1, column=1, sticky="ew", pady=2)

        ttk.Label(right, text="설명").grid(row=2, column=0, sticky="nw", pady=2)
        self.comment_text = tk.Text(right, wrap="word", height=12)
        self.comment_text.grid(row=2, column=1, sticky="nsew", pady=2)

        buttons = ttk.Frame(right)
        buttons.grid(row=3, column=1, sticky="e", pady=(6, 0))
        ttk.Button(buttons, text="변경 적용", command=self.apply_selected).pack(side="left", padx=4)
        ttk.Button(buttons, text="JSON 저장", command=self.save).pack(side="left")

        status = ttk.Frame(self, padding=(8, 0, 8, 8))
        status.grid(row=2, column=0, sticky="ew")
        self.status_var = tk.StringVar()
        ttk.Label(status, textvariable=self.status_var).pack(side="left")

    def browse_open(self):
        chosen = filedialog.askopenfilename(
            initialdir=str(self.json_path.parent), filetypes=[("JSON", "*.json")]
        )
        if chosen:
            self.load(Path(chosen))

    def load(self, path):
        if not path.exists():
            messagebox.showerror("Not found", f"파일이 없습니다:\n{path}")
            return
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            messagebox.showerror("Load failed", str(exc))
            return

        if isinstance(doc, dict) and "events" in doc:
            self.doc_format = "event"
            self.raw_doc = doc
            self.records = flatten_event_doc(doc)
        else:
            self.doc_format = "flat"
            self.raw_doc = None
            self.records = doc

        for rec in self.records:
            if rec.get("comment"):
                rec["comment"] = strip_trailing_line_whitespace(rec["comment"])

        self.name_entry.configure(state="readonly" if self.doc_format == "event" else "normal")
        self.json_path = path
        self.path_var.set(str(path))
        self.selected_index = None
        self.dirty = False
        self._refresh_list()
        self._set_status(f"{len(self.records)}개 항목 로드 ({self.doc_format}): {path}")

    def _refresh_list(self):
        self.tree.delete(*self.tree.get_children())
        needle = self.filter_var.get().strip().lower()
        for idx, rec in enumerate(self.records):
            if needle and needle not in str(rec.get("id", "")) and needle not in rec.get("name", "").lower():
                continue
            self.tree.insert("", "end", iid=str(idx), values=(rec.get("id", ""), rec.get("name", "")))

    def _on_select(self, _event=None):
        selection = self.tree.selection()
        if not selection:
            return
        self.selected_index = int(selection[0])
        rec = self.records[self.selected_index]
        self.id_var.set(str(rec.get("id", "")))
        self.name_var.set(rec.get("name", ""))
        self.comment_text.delete("1.0", "end")
        self.comment_text.insert("1.0", rec.get("comment", ""))

    def apply_selected(self):
        if self.selected_index is None:
            return
        rec = self.records[self.selected_index]
        rec["name"] = self.name_var.get()
        rec["comment"] = strip_trailing_line_whitespace(self.comment_text.get("1.0", "end-1c"))
        self.dirty = True
        self._refresh_list()
        self.tree.selection_set(str(self.selected_index))
        self._set_status(f"항목 {rec.get('id', '')} 변경 적용 (아직 파일에 저장 안 됨)")

    def save(self):
        if self.selected_index is not None:
            self.apply_selected()

        if self.doc_format == "event":
            doc = apply_records_to_event_doc(self.raw_doc, self.records)
            self.json_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            plain = [{"id": r.get("id", ""), "name": r.get("name", ""), "comment": r.get("comment", "")} for r in self.records]
            self.json_path.write_text(json.dumps(plain, ensure_ascii=False, indent=2), encoding="utf-8")

        self.dirty = False
        self._set_status(f"저장 완료: {self.json_path}")

    def _set_status(self, text):
        self.status_var.set(text)


def main():
    json_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PATH
    app = ItemDataViewer(json_path)
    app.mainloop()


if __name__ == "__main__":
    main()
