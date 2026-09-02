#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Locate Yaba Sanshiro's host mapping of Saturn High Work RAM, read-only."""

import argparse
import ctypes
import hashlib
import struct
from ctypes import wintypes
from pathlib import Path

RAW, USER, UOFF, EXE_LBA, EXE_BYTES = 2352, 2048, 16, 21, 319524
GUEST_BASE, RAM_SIZE = 0x06000000, 0x100000
PROCESS_QUERY_INFORMATION, PROCESS_VM_READ = 0x0400, 0x0010
MEM_COMMIT, PAGE_GUARD, PAGE_NOACCESS = 0x1000, 0x100, 0x01


class MBI(ctypes.Structure):
    _fields_ = [("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
                ("AllocationProtect", wintypes.DWORD), ("PartitionId", wintypes.WORD),
                ("RegionSize", ctypes.c_size_t), ("State", wintypes.DWORD),
                ("Protect", wintypes.DWORD), ("Type", wintypes.DWORD)]


def extract_exe(track1):
    data = bytearray()
    with open(track1, "rb") as f:
        for sector in range((EXE_BYTES + USER - 1) // USER):
            f.seek((EXE_LBA + sector) * RAW + UOFF)
            data.extend(f.read(USER))
    return bytes(data[:EXE_BYTES])


def read_mem(kernel, handle, address, size):
    buf = ctypes.create_string_buffer(size); got = ctypes.c_size_t()
    if not kernel.ReadProcessMemory(handle, ctypes.c_void_p(address), buf, size, ctypes.byref(got)):
        return b""
    return buf.raw[:got.value]


def transform(data, mode):
    if mode == "native": return data
    unit = 2 if mode == "swap16" else 4
    return b"".join(data[i:i+unit][::-1] for i in range(0, len(data), unit))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("track1_bin")
    ap.add_argument("--process", default="yabasanshiro.exe")
    ap.add_argument("--dump")
    args = ap.parse_args()
    exe = extract_exe(args.track1_bin)
    # Several independent signatures reduce the chance of matching a disc/cache copy.
    raw_probes = [(0x1000, exe[0x1000:0x1080]), (0x1E700, exe[0x1E700:0x1E780]), (0x2AE9C, exe[0x2AE9C:0x2AF1C])]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    pids = []
    snapshot = kernel.CreateToolhelp32Snapshot(0x2, 0)
    class PE(ctypes.Structure):
        _fields_=[("dwSize",wintypes.DWORD),("cntUsage",wintypes.DWORD),("th32ProcessID",wintypes.DWORD),("th32DefaultHeapID",ctypes.c_size_t),("th32ModuleID",wintypes.DWORD),("cntThreads",wintypes.DWORD),("th32ParentProcessID",wintypes.DWORD),("pcPriClassBase",ctypes.c_long),("dwFlags",wintypes.DWORD),("szExeFile",wintypes.WCHAR*260)]
    pe=PE(); pe.dwSize=ctypes.sizeof(pe)
    if kernel.Process32FirstW(snapshot,ctypes.byref(pe)):
        while True:
            if pe.szExeFile.lower()==args.process.lower(): pids.append(pe.th32ProcessID)
            if not kernel.Process32NextW(snapshot,ctypes.byref(pe)): break
    kernel.CloseHandle(snapshot)
    if not pids: raise SystemExit(f"process not found: {args.process}")

    found=[]
    for pid in pids:
        h=kernel.OpenProcess(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ,False,pid)
        if not h: continue
        try:
            address=0; mbi=MBI()
            while kernel.VirtualQueryEx(h,ctypes.c_void_p(address),ctypes.byref(mbi),ctypes.sizeof(mbi)):
                base=int(mbi.BaseAddress or 0); size=int(mbi.RegionSize)
                if mbi.State==MEM_COMMIT and not (mbi.Protect&(PAGE_GUARD|PAGE_NOACCESS)) and size>=0x30000:
                    chunk_size=4*1024*1024; overlap=0x100
                    for chunk_off in range(0,size,max(1,chunk_size-overlap)):
                        blob=read_mem(kernel,h,base+chunk_off,min(chunk_size,size-chunk_off))
                        if not blob: continue
                        for mode in ("native","swap16","swap32"):
                            probes=[(off,transform(sig,mode)) for off,sig in raw_probes]
                            start=0
                            while True:
                                pos=blob.find(probes[0][1],start)
                                if pos<0: break
                                host_ram=base+chunk_off+pos-(0x10000+probes[0][0])
                                ok=all(read_mem(kernel,h,host_ram+0x10000+off,len(sig))==sig for off,sig in probes[1:])
                                if ok and not any(x[0]==pid and x[1]==host_ram for x in found): found.append((pid,host_ram,h,mode))
                                start=pos+1
                nxt=base+size
                if nxt<=address: break
                address=nxt
        finally:
            # Keep no handle beyond this iteration; dump immediately for confirmed candidates.
            for fpid,host_ram,fh,mode in [x for x in found if x[0]==pid]:
                ram=read_mem(kernel,fh,host_ram,RAM_SIZE)
                print(f"pid={fpid} guest=0x{GUEST_BASE:08X} host=0x{host_ram:016X} layout={mode} bytes={len(ram)} sha256={hashlib.sha256(ram).hexdigest().upper()}")
                if args.dump:
                    dump_path = Path(args.dump)
                    dump_path.parent.mkdir(parents=True, exist_ok=True)
                    dump_path.write_bytes(ram); print(f"wrote {args.dump}")
            kernel.CloseHandle(h)
    if not found: raise SystemExit("Saturn High Work RAM mapping not found; keep the game running past boot and retry")


if __name__ == "__main__": main()
