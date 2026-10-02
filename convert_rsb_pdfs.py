"""Extract RSB Tomato competitor lists into one CSV per competition day."""

import csv
import re
from pathlib import Path

import fitz


ROOT = Path(__file__).parent
OUTPUT = ROOT / "csv"
OUTPUT.mkdir(exist_ok=True)
MATCH = re.compile(r"^([A-Z]\d+[a-z]?) \(([RB])\)$")
CATEGORY = re.compile(r"^(?:\d+\s*-\s*\d+|ABOVE\s+\d+)\s+.+$")
FIELDS = ["day", "event", "source_pdf", "source_page", "team", "competitor_no", "name", "name_truncated_in_pdf", "category", "first_bout", "first_corner", "bout_2", "corner_2", "bout_3", "corner_3", "bout_4", "corner_4", "bout_5", "corner_5"]


def rows_from_pdf(path: Path):
    event = path.stem.replace(" TM LIST", "").replace(" TM LSIT", "")
    day = int(path.parent.name.removeprefix("Day"))
    rows = []
    for page_no, page in enumerate(fitz.open(path), 1):
        lines = page.get_text().splitlines()
        team = next(line.removeprefix("TEAM:").strip() for line in lines if line.startswith("TEAM:"))
        start = lines.index("1 / 16") + 1
        end = next(i for i, line in enumerate(lines) if line.startswith("Printed by"))
        body = lines[start:end]
        boundaries = [i for i, line in enumerate(body) if re.fullmatch(r"\d{3}", line)]
        for number, start_index in enumerate(boundaries):
            part = body[start_index:boundaries[number + 1] if number + 1 < len(boundaries) else len(body)]
            category_index = next((i for i, item in enumerate(part[1:], 1) if CATEGORY.match(item)), None)
            if category_index is None:
                raise ValueError(f"Missing category: {path}:{page_no}: {part}")
            name = " ".join(item.strip() for item in part[1:category_index] if item.strip())
            # Two source rows contain a malformed bullet character before the name.
            name = re.sub(r"^â\s+", "", name).strip()
            bouts = part[category_index + 1:]
            if len(bouts) > 5 or any(not MATCH.fullmatch(b) for b in bouts):
                raise ValueError(f"Unexpected bouts: {path}:{page_no}: {part}")
            row = dict.fromkeys(FIELDS, "")
            row.update(day=day, event=event, source_pdf=str(path.relative_to(ROOT)), source_page=page_no,
                       team=team, competitor_no=part[0], name=name,
                       name_truncated_in_pdf="yes" if "..." in name else "no", category=part[category_index])
            for i, bout in enumerate(bouts, 1):
                match = MATCH.fullmatch(bout)
                row["first_bout" if i == 1 else f"bout_{i}"] = match.group(1)
                row["first_corner" if i == 1 else f"corner_{i}"] = match.group(2)
            rows.append(row)
    return rows


for day in (1, 2):
    rows = [row for path in sorted((ROOT / f"Day{day}").glob("*.pdf")) for row in rows_from_pdf(path)]
    path = OUTPUT / f"rsb_day_{day}.csv"
    with path.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{path}: {len(rows)} rows, {sum(r['name_truncated_in_pdf'] == 'yes' for r in rows)} truncated names")
