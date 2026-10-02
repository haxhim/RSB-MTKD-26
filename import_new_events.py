"""Rebuild RSB Poomsae Pro and Team Sparring CSVs from the supplied PDFs."""
import csv
import re
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).parent
CSV = ROOT / 'csv'
SOURCE = ROOT / 'source'
HEADER = ['day','event','source_pdf','source_page','team','competitor_no','name','name_truncated_in_pdf','category','first_bout','first_corner','bout_2','corner_2','bout_3','corner_3','bout_4','corner_4','bout_5','corner_5']

def clean(text):
    return ' '.join((text or '').split())

pro = []
with pdfplumber.open(SOURCE / 'poomsae_pro.pdf') as pdf:
    for page_no, page in enumerate(pdf.pages, 1):
        text = page.extract_text() or ''
        category = clean(text.splitlines()[2])
        expected = int(re.search(r'Entries:\s*(\d+)', text).group(1))
        table = page.find_tables()[0]
        extracted = 0
        for row in table.rows[1:]:
            y0, y1 = row.bbox[1], row.bbox[3]
            code = clean(page.crop((30, y0, 84, y1)).extract_text())
            name = clean(page.crop((194, y0, 462, y1)).extract_text())
            club = clean(page.crop((469, y0, 690, y1)).extract_text())
            if not re.fullmatch(r'D\d{3}', code) or not name or not club:
                raise ValueError(f'Invalid Poomsae Pro row on page {page_no}: {code!r}, {name!r}, {club!r}')
            pro.append({'day':1,'event':'POOMSAE PRO','source_pdf':'source/poomsae_pro.pdf','source_page':page_no,'team':club,'competitor_no':code,'name':name,'name_truncated_in_pdf':'yes' if '[?]' in name or '...' in name else 'no','category':category,'first_bout':code,'first_corner':''})
            extracted += 1
        if extracted != expected:
            raise ValueError(f'Page {page_no}: expected {expected}, found {extracted}')
if len(pro) != 133 or len({r['competitor_no'] for r in pro}) != 133:
    raise ValueError('Expected 133 unique Poomsae Pro entries')
with (CSV / 'rsb_poomsae_pro.csv').open('w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, HEADER); writer.writeheader(); writer.writerows(pro)

# Tomato prints some team members with ellipses. Keep the source text exactly as visible.
teams = [
    ('001','12 - 14 FTS','Dayang,Aryssa,','RSB TAEKWONDO CLUB','H05','B'),
    ('002','12 - 14 FTS','Qisya,Syasya,Aliya','RSB TAEKWONDO CLUB','H05','R'),
    ('003','12 - 14 MTS','MUHAMMAD DANIAL,MUHAMMAD SAM...','HYPERTIGER TAEKWONDO CLUB','H02','B','H03','B','H06','B'),
    ('004','12 - 14 MTS','Muhammad umar,Afi raid,Khalish adam','MACTS','H04','R','H06','R'),
    ('005','12 - 14 MTS','Muhammad aâ isy Rayyan,Haq adly day...','MACTS','H02','R','H03','B','H06','B'),
    ('006','12 - 14 MTS','Ashman,Rushidi,Adi amsyar','RSB TAEKWONDO CLUB','H03','R','H06','B'),
    ('007','12 - 14 MTS','PUTERA DANISH AIMAN,MOHAMAD ZAFRI,M...','SPT TAEKWONDO CLUB','H04','B','H06','R'),
    ('008','ABOVE 18 FTS','Adelyya,Syahirah,Syifa D','RSB TAEKWONDO CLUB','H08','B'),
    ('009','ABOVE 18 FTS',"WAN NUR FARHA 'AFINA,AINA MAISARA,NURIY NAZIHAH",'UNIVERSITY POLY-TECH MALAYSIA (UPTM)','H08','R'),
    ('010','15 - 17 MTS','MUHAMMAD DANISH HAKIM,MUHAMMAD RAFIQ Z...','BRAVO TAEKWONDO CLUB PENANG','H10','R'),
    ('011','15 - 17 MTS','Muhammad adam aqil,Auf radi bin azman,Pa...','MACTS','H07','R','H10','B'),
    ('012','15 - 17 MTS','ROSHEAAN,Rayyan,Amirul hadi','RSB TAEKWONDO CLUB','H07','B','H10','B'),
    ('013','9 - 11 MTS','Aryan naufal,Ammar harraz,Azka aldric','MACTS','H01','B'),
    ('014','9 - 11 MTS','Latif,Qaizer,Umar','RSB TAEKWONDO CLUB','H01','R'),
    ('015','ABOVE 18 MTS','MUHAMMAD NUR ASHIM HAZIM,MUNSHI MUHAMMAD ALIF FAK...','ACTION TAEKWONDO MARTIAL ART','H09','R'),
    ('016','ABOVE 18 MTS','MOHD AZRIL,MUHAMMAD DANISH FARHAN,NUR FAIQ A...','UNIVERSITY POLY-TECH MALAYSIA (UPTM)','H09','B'),
]
page_by_category = {'9 - 11 MTS':1,'12 - 14 FTS':2,'12 - 14 MTS':3,'ABOVE 18 FTS':4,'ABOVE 18 MTS':5,'15 - 17 MTS':6}
team_rows = []
for team in teams:
    number,category,name,club,*route = team
    row = {'day':2,'event':'TEAM SPARRING','source_pdf':'source/team_sparring.pdf','source_page':page_by_category[category], 'team':club,'competitor_no':number,'name':name,'name_truncated_in_pdf':'yes' if '...' in name else 'no','category':category}
    # Existing RSB CSVs store the final first, followed by earlier rounds.
    route_pairs = [(route[i], route[i+1]) for i in range(0, len(route), 2)][::-1]
    for (bout_key,corner_key), (bout,corner) in zip([('first_bout','first_corner'),('bout_2','corner_2'),('bout_3','corner_3'),('bout_4','corner_4'),('bout_5','corner_5')], route_pairs):
        row[bout_key],row[corner_key] = bout,corner
    team_rows.append(row)
with (CSV / 'rsb_team_sparring.csv').open('w', newline='', encoding='utf-8-sig') as f:
    writer = csv.DictWriter(f, HEADER);writer.writeheader();writer.writerows(team_rows)
print(f'Imported {len(pro)} Poomsae Pro entries and {len(team_rows)} Team Sparring teams')
