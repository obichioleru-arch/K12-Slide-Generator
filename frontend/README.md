# District Slide Generator

An internal tool for education data analysts that generates executive PowerPoint presentation slides from uploaded Excel or CSV data files.

---

## What It Does

Upload a data file, select a slide category and template, and download a fully formatted `.pptx` file — charts updated, placeholders replaced, ready to present.

---

## Folder Structure

```
district-slide-tool/
  backend/
    main.py                         ← FastAPI server (start here)
    requirements.txt
    calculations/
      tsi.py                        ← TSI slide calculators
      ccmr.py                       ← CCMR slide calculators
      postsecondary.py              ← Postsecondary enrollment calculator
    templates/                      ← PowerPoint templates (do not move)
      tsi_status_template.pptx
      tsi_status_slide_template.pptx
      tsi_leaderboard_template.pptx
      ccmr_yoy_breakdown_template.pptx
      postsecondary_enrollment_template.pptx
    uploads/                        ← Auto-created; stores incoming files
    outputs/                        ← Auto-created; stores generated .pptx files
  frontend/
    src/
      App.jsx                       ← Main React component
      App.css                       ← Styles
      main.jsx
    package.json
    vite.config.js
  README.md
```

---

## How to Start

### Backend

```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

Backend runs at: `http://127.0.0.1:8000`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at: `http://localhost:5173` (or 5174 if 5173 is taken)

---

## Working Slide Types

| Category                  | Slide Name               | slide_type                  |
|---------------------------|--------------------------|-----------------------------|
| TSI                       | TSI Status Trends        | `tsi_status_trends`         |
| TSI                       | TSI Status               | `tsi_status`                |
| TSI                       | TSI Leaderboard          | `tsi_leaderboard`           |
| CCMR A-F Status           | CCMR YOY Breakdown       | `ccmr_yoy_breakdown`        |
| Postsecondary Enrollment  | Postsecondary Enrollment | `postsecondary_enrollment`  |

---

## How to Add a New Slide

1. **Create the PowerPoint template** and place it in `backend/templates/`.
   - Add `{{District}}` and `{{Campus}}` text boxes where needed.
   - Include a placeholder chart that will be replaced by the tool.

2. **Create a calculator function** in `backend/calculations/`.
   - Accept a `pandas.DataFrame` as input.
   - Return a dict with `slide_data` (text replacements) and `chart_data` (categories + series).
   - Raise `ValueError` with a clear message if required columns are missing.

3. **Register the slide** in `backend/main.py`:
   - Add an entry to `CATEGORY_MENU` under the correct category.
   - Add an entry to `SLIDE_REGISTRY` with template path, output prefix, calculator function, and layout profile.
   - Add a `format_chart_for_slide_type` block for the new `layout_profile` value.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `node` not recognized | Install Node.js from https://nodejs.org |
| `uvicorn` not found | Run `pip install -r requirements.txt` inside `backend/` |
| Backend not connected (red badge) | Start backend first; check terminal for errors |
| File not accepted | Use `.xlsx`, `.xls`, or `.csv` |
| Template missing error | Check that the `.pptx` file exists in `backend/templates/` |
| PowerPoint opens an old download | Clear your Downloads folder; the tool generates a new timestamped file each run |
| Chart shows zeros | Column names in your file may not match expected names; check the error message for details |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Health check + available slides |
| GET | `/health` | Detailed health check including template existence |
| GET | `/categories` | List of category names |
| GET | `/category-menu` | Full menu (categories → slides) |
| GET | `/slide-types` | List of registered slide type keys |
| POST | `/generate-slide` | Generate a slide; returns `.pptx` file |

---

## Notes

- `uploads/` and `outputs/` are created automatically on first run.
- Generated files include a timestamp in the filename to avoid stale downloads.
- No database, no auth, no drag-and-drop — by design.
