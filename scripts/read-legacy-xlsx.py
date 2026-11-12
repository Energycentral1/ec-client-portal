"""Reads an old "Customer Report" workbook (.xlsx, or a Google Sheet exported as .xlsx) into data/legacy/<slug>.json
for scripts/import-legacy.ts. Usage: python3 scripts/read-legacy-xlsx.py <workbook.xlsx> <client-slug> <source-url> [out-dir]

The reports share one template: a tab per channel, a header row, then one row per placement. Only numbers are read.
Lead tabs and lead links are never read (lead rows are personal data and stay out of the repo). Anything that does not
parse cleanly is left out and listed in the file's `notes`, never guessed.
"""
import sys, re, json, datetime, warnings
import openpyxl
warnings.filterwarnings("ignore")
TODAY = datetime.date.today()

def num(v):
    """A plain number, or '1,260', or '552 as of 7/30/24'. Anything else (NA, '321+100 = 421', text) is not a number."""
    if isinstance(v, bool) or v is None: return None
    if isinstance(v, (int, float)): return v if v == v and v >= 0 else None
    s = str(v).strip()
    m = re.fullmatch(r"([\d,]+(?:\.\d+)?)(?:\s+as of\b.*)?", s, re.I)
    if not m: return None
    return float(m.group(1).replace(",", ""))

def date(v):
    if isinstance(v, datetime.datetime): d = v.date()
    elif isinstance(v, datetime.date): d = v
    else:
        m = re.match(r"\s*(\d{1,2})/(\d{1,2})/(\d{2,4})", str(v or ""))
        if not m: return None
        y = int(m.group(3)); y += 2000 if y < 100 else 0
        try: d = datetime.date(y, int(m.group(1)), int(m.group(2)))
        except ValueError: return None
    return d.isoformat() if datetime.date(2019, 1, 1) <= d <= TODAY else None

def text(v): return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""
def whole(n): return int(round(n))

KIND = [("newsletter", "newsletter"), ("website", "website"), ("sponsorship", "sponsorship"), ("email", "email"), ("event", "events"),
        ("podcast", "podcast"), ("gated", "gated"), ("content report", "content"), ("content", "content")]
HEAD = {"newsletter": "START DATE", "website": "START DATE", "sponsorship": "START DATE", "email": "DATE", "events": "EVENT NAME",
        "podcast": "INTERVIEW DATE", "content": "DATE POSTED", "gated": "DATE OF POST"}

def read(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    rows, left = [], []
    for ws in wb.worksheets:
        title = ws.title.lower()
        if "yearly" in title or "lead" in title: continue
        kind = next((k for key, k in KIND if key in title), None)
        if not kind: continue
        grid = [[c for c in r] for r in ws.iter_rows()]
        hi = next((i for i, r in enumerate(grid) if any(text(c.value).upper().startswith(HEAD[kind]) for c in r[:3])), None)
        if hi is None: continue            # a "Content" cover tab, or a tab with no table
        heads = [text(c.value).upper() for c in grid[hi]]
        col = lambda *names: next((i for i, h in enumerate(heads) if any(n in h for n in names)), None)
        for r in grid[hi + 1:]:
            vals = [c.value for c in r]
            if not any(v is not None and text(v) for v in vals): continue
            first = text(vals[0])
            if re.match(r"(no upcoming|tbd|total|n/?a$)", first, re.I): continue
            where = f"{ws.title} / {first[:40]}"
            out = None
            if kind in ("newsletter", "website", "sponsorship"):
                d, e = date(vals[0]), date(vals[1]) if len(vals) > 1 else None
                nums = [num(v) for v in vals[2:8]]; nums = [n for n in nums if n is not None]
                if d and nums:
                    m = {"impressions": whole(nums[0])}
                    if len(nums) > 1 and (kind != "sponsorship" or col("CLICKS") is not None): m["clicks"] = whole(nums[1])
                    out = {"tab": kind, "date": d, "metrics": m}
                    if e and e != d: out["end_date"] = e
            elif kind == "email":
                d = date(vals[0]); nums = [num(v) for v in vals[1:4]]
                if d and all(n is not None for n in nums) and len(nums) == 3:
                    out = {"tab": "email", "date": d, "metrics": {"sent": whole(nums[0]), "opens": whole(nums[1]), "clicks": whole(nums[2])}}
            elif kind == "events":
                ci, ri, ai = col("AIR DATE"), col("REGISTRATION"), col("NUMBER OF ATTENDEES")
                d = date(vals[ci]) if ci is not None and ci < len(vals) else None
                m = {}
                if ri is not None and num(vals[ri]) is not None: m["registrants"] = whole(num(vals[ri]))
                if ai is not None and num(vals[ai]) is not None: m["attendees"] = whole(num(vals[ai]))
                if d and m: out = {"tab": "events", "date": d, "title": first, "metrics": m}
            elif kind == "podcast":
                ni = col("INTERVIEW NAME")
                m = {}
                for key, names in (("plays", ("MAIN EPISODE",)), ("short_form_views", ("SHORT FORM",)), ("impressions", ("IMPRESSION",)), ("clicks", ("CLICK",))):
                    i = col(*names)
                    if i is not None and i < len(vals) and num(vals[i]) is not None: m[key] = whole(num(vals[i]))
                d = date(vals[0])
                if d and m:
                    out = {"tab": "podcast", "date": d, "metrics": m}
                    if ni is not None and text(vals[ni]): out["title"] = text(vals[ni])
                    link = r[ni].hyperlink.target if ni is not None and r[ni].hyperlink else None
                    if link and link.startswith("https://"): out["live_url"] = link
            elif kind == "content":
                ti, li, vi, ki = col("POST TITLE"), col("POST LINK"), col("VIEWS"), col("LIKES")
                d = date(vals[0]); m = {}
                if vi is not None and num(vals[vi]) is not None: m["views"] = whole(num(vals[vi]))
                if ki is not None and num(vals[ki]) is not None: m["likes"] = whole(num(vals[ki]))
                if d and "views" in m:
                    out = {"tab": "content", "date": d, "metrics": m}
                    if ti is not None and text(vals[ti]): out["title"] = text(vals[ti])
                    link = text(vals[li]) if li is not None else ""
                    if not link.startswith("http") and li is not None and r[li].hyperlink: link = r[li].hyperlink.target or ""
                    if link.startswith("https://"): out["live_url"] = link.split()[0]
            elif kind == "gated":
                vi = col("VIEWS"); d = date(vals[0])
                v = num(vals[vi]) if vi is not None and vi < len(vals) else None
                if d and v is not None:
                    out = {"tab": "content", "date": d, "metrics": {"views": whole(v)}}
                    long = [text(x) for x in vals[3:] if len(text(x)) > 25 and not text(x).lower().startswith(("click", "see", "http"))]
                    if long: out["title"] = long[-1]
            if out: rows.append(out)
            elif date(vals[0]) or (kind == "events" and first): left.append(where)
    return rows, left

if __name__ == "__main__":
    path, slug, url = sys.argv[1:4]
    outdir = sys.argv[4] if len(sys.argv) > 4 else "data/legacy"
    rows, left = read(path)
    rows.sort(key=lambda r: (r["tab"], r["date"]), reverse=True)
    by = {}
    for r in rows: by[r["tab"]] = by.get(r["tab"], 0) + 1
    notes = "Read from the workbook by scripts/read-legacy-xlsx.py. " + ", ".join(f"{k} {v}" for k, v in sorted(by.items())) + "." \
        + (f" Left out, no clean number or date ({len(left)}): " + "; ".join(left[:25]) + ("; …" if len(left) > 25 else "") + "." if left else "") \
        + " The sheet's 'likes and comments' is one figure, stored as likes. Lead links were not read."
    json.dump({"client_slug": slug, "source_url": url, "extracted_on": TODAY.isoformat(), "notes": notes, "rows": rows}, open(f"{outdir}/{slug}.json", "w"), indent=1)
    print(f"{slug}: {len(rows)} rows ({', '.join(f'{k} {v}' for k, v in sorted(by.items()))}); left out {len(left)}" + (f": {' | '.join(left[:6])}" if left else ""))
