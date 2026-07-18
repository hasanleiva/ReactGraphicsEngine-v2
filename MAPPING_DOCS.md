# PFL API Data Mapping — Admin Guide

The **Data Mapping** button in the header auto-fills template fields from the PFL API (`https://api.pfl.uz/public/v1`).
Each template has its own config file so FIXTURES, STANDINGS, and FULL-TIME templates in the same folder can have different settings.

---

## 1. How It Works

1. User loads a template (e.g. `PRO/FIXTURES`).
2. "Data Mapping" button appears in the header.
3. User clicks it — a modal opens showing the template type.
4. Depending on the type, user may enter a **tour ID** (fixtures) or **match ID** (full-time).
5. App fetches from the PFL API and fills all template layers automatically.

---

## 2. Requirements

### `.env` file (project root)

```
PFL_API_KEY=your_api_key_here
```

Without this key all API requests will fail with "PFL_API_KEY not configured".

---

## 3. Config File: `[TEMPLATE_NAME].pfl.json`

Each template has its **own** config file, named after the template file itself.

**Pattern:** `uploads/templates/[FOLDER]/[TEMPLATE_NAME].pfl.json`

### Examples

| Template ID | Config file path |
|-------------|-----------------|
| `PRO/FIXTURES` | `uploads/templates/PRO/FIXTURES.pfl.json` |
| `PRO/STANDINGS` | `uploads/templates/PRO/STANDINGS.pfl.json` |
| `PRO/FULL-TIME` | `uploads/templates/PRO/FULL-TIME.pfl.json` |
| `1-LIGA/FIXTURES (GARB)` | `uploads/templates/1-LIGA/FIXTURES (GARB).pfl.json` |
| `1-LIGA/STANDINGS (MARKAZ)` | `uploads/templates/1-LIGA/STANDINGS (MARKAZ).pfl.json` |
| `UZSL/FIXTURES` | `uploads/templates/UZSL/FIXTURES.pfl.json` |

### Config Fields

```json
{
  "tournamentId": 1,
  "seasonId": null,
  "templateType": "fixtures",
  "matchCount": 7,
  "dropdownFile": "proliga.json",
  "groupId": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tournamentId` | number | **Yes** | PFL tournament ID — fill in the real value from PFL admin |
| `seasonId` | number \| null | No | Season ID. `null` = current/active season |
| `templateType` | string | No | `"fixtures"`, `"standings"`, or `"fulltime"`. Auto-detected from template name if omitted |
| `matchCount` | number | No | Matches per round for fixtures (default: 8) |
| `dropdownFile` | string | No | JSON file in `public/dropdown-data/` to use for team dropdowns |
| `groupId` | number \| null | No | Group ID for grouped standings (GARB/MARKAZ/SHARQ). `null` = no filter |

### Template Type Auto-Detection

If `templateType` is not set, detected from the template filename:

| Name contains | Type detected |
|---------------|--------------|
| `STANDINGS` | `standings` |
| `FULL` or `FULLTIME` | `fulltime` |
| anything else | `fixtures` |

---

## 4. All Config Files (fill in `tournamentId` and `groupId`)

### PRO league

```
uploads/templates/PRO/FIXTURES.pfl.json    → templateType: "fixtures",  dropdownFile: "proliga.json"
uploads/templates/PRO/STANDINGS.pfl.json   → templateType: "standings", dropdownFile: "proliga.json"
uploads/templates/PRO/FULL-TIME.pfl.json   → templateType: "fulltime",  dropdownFile: "proliga_fulltime.json"
```

### UZSL

```
uploads/templates/UZSL/FIXTURES.pfl.json   → tournamentId: ?, dropdownFile: "uzsl.json"
uploads/templates/UZSL/STANDINGS.pfl.json  → tournamentId: ?, dropdownFile: "uzsl.json"
uploads/templates/UZSL/FULL-TIME.pfl.json  → tournamentId: ?, dropdownFile: "uzsl.json"
```

### 1-LIGA (set groupId for each zone)

```
uploads/templates/1-LIGA/FIXTURES (GARB).pfl.json    → groupId: ? (GARB group ID)
uploads/templates/1-LIGA/FIXTURES (MARKAZ).pfl.json  → groupId: ? (MARKAZ group ID)
uploads/templates/1-LIGA/FIXTURES (SHARQ).pfl.json   → groupId: ? (SHARQ group ID)
uploads/templates/1-LIGA/STANDINGS (GARB).pfl.json   → groupId: ? (GARB group ID)
uploads/templates/1-LIGA/STANDINGS (MARKAZ).pfl.json → groupId: ? (MARKAZ group ID)
uploads/templates/1-LIGA/STANDINGS (SHARQ).pfl.json  → groupId: ? (SHARQ group ID)
```

### U19 (same structure as 1-LIGA)

```
uploads/templates/U19/FIXTURES (GARB).pfl.json    → groupId: ?
uploads/templates/U19/FIXTURES (MARKAZ).pfl.json  → groupId: ?
uploads/templates/U19/FIXTURES (SHARQ).pfl.json   → groupId: ?
uploads/templates/U19/STANDINGS (GARB).pfl.json   → groupId: ?
uploads/templates/U19/STANDINGS (MARKAZ).pfl.json → groupId: ?
uploads/templates/U19/STANDINGS (SHARQ).pfl.json  → groupId: ?
```

### U21

```
uploads/templates/U21/FIXTURES.pfl.json   → tournamentId: ?
uploads/templates/U21/STANDINGS.pfl.json  → tournamentId: ?
uploads/templates/U21/FULL-TIME.pfl.json  → tournamentId: ?
```

---

## 5. Dropdown JSON IDs

For team auto-fill to work, the `id` in your dropdown JSON files must match the **club IDs from the PFL API**.

**Files:** `public/dropdown-data/`

**Before** (placeholder IDs):
```json
[{ "id": "option-1", "text": "Aral", "logo": "/dropdown-data/logos/proliga/aral.png" }]
```

**After** (real API IDs):
```json
[{ "id": "42", "text": "Aral", "logo": "/dropdown-data/logos/proliga/aral.png" }]
```

**How to find club IDs:** Call `GET /api/pfl/clubs` — each club has an `id` field.

---

## 6. Template Layer Names Reference

### FIXTURES (Home1–8, Away1–8 …)

| API field | Layer name | Type |
|-----------|-----------|------|
| `homeClub.id` | `Home1` – `Home8` | dropdown |
| `awayClub.id` | `Away1` – `Away8` | dropdown |
| match date | `Date1` – `Date8` | text |
| match time | `Time1` – `Time8` | text |
| `score.home:score.away` | `Score1` – `Score8` | text |
| broadcast channel | `Channel1` – `Channel7` | text |
| round (user input) | `TUR` / `Tur` | text |

### STANDINGS (Team1–14 …)

| API field | Layer name | Type |
|-----------|-----------|------|
| `club.id` | `Team1` – `Team14` | dropdown |
| `points` | `1-OCHKO` – `14-OCHKO` | text |
| `goalsFor` | `1-GF` – `14-GF` | text |
| `played` | `1-O'YIN` – `14-O'YIN` | text |

### FULL-TIME

| API field | PRO layer | UZSL layer | Type |
|-----------|-----------|------------|------|
| `homeClub.id` | `HOMECLUB` | `HomeTeam` | dropdown |
| `awayClub.id` | `AWAYCLUB` | `AwayTeam` | dropdown |
| `score.home` | `HOMEGOALS` | `HomeScores` | text |
| `score.away` | `AWAYGOALS` | `AwayScores` | text |
| combined score | `SCORE` | — | text |

---

## 7. Adding a New Template

1. Upload template to the correct folder via the app
2. Create `[TEMPLATE_NAME].pfl.json` next to the template file
3. Set `tournamentId`, `templateType`, `dropdownFile`, and `groupId` as needed
4. If needed, create a matching dropdown JSON in `public/dropdown-data/` with real API club IDs

---

## 8. Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `PFL_API_KEY not configured` | Missing `.env` entry | Add `PFL_API_KEY=...` to `.env` and restart server |
| `No config found` | Config file missing | Create `[TEMPLATE_NAME].pfl.json` in the template folder |
| Teams don't fill but data loads | Dropdown IDs don't match API club IDs | Update `id` values in the dropdown JSON |
| `PFL API 401` | Wrong API key | Check key in `.env` |
| `PFL API 404` | Wrong `tournamentId` | Verify tournament ID with the PFL team |
