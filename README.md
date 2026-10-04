# RSB Taekwondo Championship 2026 system

RSB competition operations based on the SUKMA taekwondo system's public live view, schedule, brackets, result recording, corrections, CSV export, and team medal tally. The existing RSB Day 1 and Day 2 team lists supply all competitors and preassigned bout paths; officials do not need to draw athletes into brackets again.

## Run locally

The quickest local setup uses Docker Desktop. Copy `.env.example` to `.env`, replace both passwords, then run:

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Open <http://127.0.0.1:3000>. The local override binds only to your computer; the production Compose file exposes no host ports. The database stays in the `postgres_data` Docker volume. For a direct Node run instead, Node.js 20 or newer and PostgreSQL 17 are required. Install dependencies with `npm ci`, create a PostgreSQL database, then set either `DATABASE_URL` or the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE` variables.

```bash
DATABASE_URL='postgres://rsb:your-password@127.0.0.1:5432/rsb' ADMIN_PASSWORD='choose-a-private-password' npm start
```

For a private venue LAN with a direct Node run, set `HOST=0.0.0.0` and use the venue computer's IP address. Set a private `ADMIN_PASSWORD` before making the app available to other devices. If the password is omitted, the server prints a temporary random password on startup.

The public views are separate pages: **Live** (`/live`), **Schedule** (`/schedule`), **Brackets** (`/brackets`), **Results** (`/results`), and **Awards** (`/awards`). The separate control room is at <http://127.0.0.1:3000/admin>. Sign in there with the lead admin password, or with a ring's six-digit coordinator PIN after the lead admin sets it. Coordinators can record and correct results only for bouts assigned to their ring. Different coordinators can work at once; PostgreSQL locks each change so they cannot overwrite each other's updates. The winner advances through the existing RSB route automatically. A recorded result can be undone after entering a reason, provided no later result depends on it. Results, schedule changes, PIN hashes, and the audit log persist in PostgreSQL across restarts.

The admin dashboard has separate URLs for **Overview**, **Bout queue**, **Poomsae Pro**, **Awards desk**, **Delivered history**, **Bulk transfer**, **Add qualifying**, and **Staff PINs**. Overview shows competition totals, progress by ring, current ready bouts, and recent results. The bout queue shows all statuses by default, including waiting bouts; only ready bouts accept results. Coordinators cannot open Day 2 until every Day 1 ring is complete.

**Bulk transfer** uses source and destination bout lists. Mark the first and last source bouts, choose the destination ring, and mark the bout to insert after (for example, A47–A57 after B35). Transferred bouts keep their original A codes and bracket paths. **Add qualifying** filters destination matches by day, ring, category, and search. The admin can stage several new athletes and clubs, review the draft, and save them together. A qualifier's winner takes the selected athlete's slot in the existing match. New qualifiers inserted after A001 receive codes such as A001A and A001B. The destination match cannot already have a recorded result. On Day 1 Ring D, this page stages Poomsae Pro athletes for an existing or new category; entries receive the next D codes and join the single-round score sheet.

The public Live view shows one current ready bout per assigned ring for the selected day, including both athletes and clubs, followed by up to three upcoming bouts for that ring. Live codes are padded for display (`A001`); the underlying Tomato code (`A01`) remains in the source data and result export. Schedule, Brackets, and Results use ring cards to select A–J; Brackets shows connected round columns and full bout codes such as `A01`. Chung (blue) appears before Hong (red) in match cards.

| Day 1 rings | Event |
| --- | --- |
| A, B, C | Poomsae Carnival |
| D | Poomsae Pro — single-round marks |
| E, F, G, H | Kyorugi Class B Body Kick |
| I, J | Virtual |

## Data

- `csv/rsb_day_1.csv`: 1,201 entries from Class B, Poomsae Carnival, and Virtual Day 1.
- `csv/rsb_day_2.csv`: 477 entries from Class A and Virtual Day 2.
- `csv/rsb_poomsae_pro.csv`: 133 entries in 36 Ring D categories.
- `csv/rsb_team_sparring.csv`: 16 teams in six Day 2 Ring H brackets.
- `convert_rsb_pdfs.py`: reproducible converter for the five source PDFs.

The Tomato PDF lists show each athlete's path from final toward the first scheduled bout. The system reads the last nonempty bout code as that athlete's first contest. Bout codes are scoped to event and day. Red and blue corner assignments are preserved for every stage. The initial ring assignment uses the letter prefix of each Tomato bout code. Later transfers keep the original code while changing the assigned ring shown in Live and Schedule.

When an athlete enters a later bracket round directly, the public bracket draws a visual BYE slot in the previous round and connects it to that athlete's match. If both athletes enter directly, each gets a BYE slot, as in Day 2 A14. These BYE cards are display-only; they do not create extra result records.

Day 2 uses the same A–J ring cards as Day 1: A–G show individual Kyorugi, I–J show VR, and H shows the supplied Team Sparring bracket. Ring H Team Sparring can run alongside individual Kyorugi once its own bouts are ready.

The source PDFs visibly shorten 491 names; these are flagged in the CSV and shown as printed until a complete roster is supplied. Five Day 1 entries have no bout code and remain in the athlete data without a scheduled contest. The Virtual Day 2 PDF header says **3 October 2026** even though it was supplied in the Day 2 folder; the system follows the folder's Day 2 assignment. Confirm that date with the organizer before venue use.

## Check

```bash
npm run check
```

This checks the syntax of the server and browser scripts. Results are stored separately from the source CSVs.

## Awards desk

The public [Awards page](http://127.0.0.1:3000/awards) lists only finished categories, with podium calls and medal status. The Results page shows the team medal tally. When all bouts in a category finish, the system identifies the gold, silver, and semifinal bronze medalists and changes the category from **Not called** to **Called**. Awards staff can call the names again, mark each medal **Delivered**, or mark an athlete **Absent**. When every medalist is delivered or absent, the category becomes **Delivered**. Corrections can be made with **Reset**. The public pages refresh every 10 seconds.

The lead admin sets a six-digit **Awards desk** PIN under **Staff PINs**. Staff choose **Awards desk** at `/admin` sign-in. That role can work with awards only; it cannot change bout results or schedules. All Day 1 categories except Poomsae Sanction (listed as Poomsae Pro in the app) become **Delivered in Ring** when finished and require no awards desk action. Virtual categories on Day 2 retain their in-ring delivery rule.

## Poomsae Pro

The supplied sanction cut-off sheet seeds 133 Ring D entries in 36 categories. Ring D has a separate admin page at `/admin/poomsae-pro`, available to the lead admin and the Ring D coordinator. Each category is one round. Staff enter a mark from **0.000 to 10.000** for each entry; higher marks rank first and equal marks share rank. A saved mark can be revoked per athlete; this recalculates rankings and clears the category's recorded medal delivery until scores are final again. The public Ring D schedule and results show the marks and ranks. A category enters the public Awards page only after all of its marks are recorded. Rank 1 receives gold, rank 2 silver, and rank 3 bronze. Blank marks can be saved while a category is in progress.

Some Team Sparring names are shortened in the source PDF and remain shortened in the imported CSV. `import_new_events.py` rebuilds both new CSVs from the copies in `source/`.

## Dokploy deployment

Create a **Compose** service from this project with `compose.yaml`. Set a strong `ADMIN_PASSWORD` (at least 12 characters) and a separate strong `POSTGRES_PASSWORD` in the Compose environment. Add your public domain to service **`rsb`**, internal port **`3000`**, in Dokploy's Domains tab. The Compose file has no host port mapping; Dokploy routes traffic to the internal service. The private `db` service runs PostgreSQL and is not exposed publicly.

The image includes the Day 1, Day 2, Poomsae Pro, and Team Sparring CSVs plus `seed/initial-state.sql`, which imports the competition state into PostgreSQL only when the database is empty. The prepared seed retains the ring schedule and staff PINs but has no recorded winners, Poomsae marks, awards, or result audit entries. Later deploys preserve new scores, results, transfers, staff PINs, and audit history in the `postgres_data` volume. Back up the PostgreSQL database or named volume before a major update. If the local preview changes before the first Dokploy deployment, run `npm run seed:snapshot` to refresh the SQL seed from the local PostgreSQL database, then rebuild. That script refuses to package recorded competition results. The seed includes current PIN hashes; keep the deployment source private and rotate staff PINs after deployment if access changes. The old `data/results.json` is retained only as a migration backup and is never read by the running app.

Health check: `/healthz`. The container starts as a non-root user and requires `ADMIN_PASSWORD` in production.
# RSB-MTKD-26
