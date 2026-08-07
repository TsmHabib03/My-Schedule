# QCU Schedule UI Revision - TODO

## Step 1: Edit `assets/js/app.js`
- [x] Add Techboc Building (HB) to `QCU_DEFAULTS.buildings`
- [x] Update `renderBuildings()` → image-based building cards
- [x] Refine `cardTemplate()` → compact class cards
- [x] Update `renderSchedule()` → add Code column, modern table, today highlight, current class highlight
- [x] Update `openBuildingModal()` for new building layout
- [x] Remove 24-hour time toggle logic (force 12-hour)

## Step 2: Edit `index.html`
- [x] Replace campus photo with `Techboc HB bautista.jpg`
- [x] Keep caption "Quezon City University, San Bartolome Campus"
- [x] Clean up "View all" / "Class Cards" header

## Step 3: Edit `schedule.html`
- [x] Add missing "Code" column in table header
- [x] Update description text

## Step 4: Edit `settings.html`
- [x] Remove 24-hour time toggle row

## Step 5: Edit `assets/css/styles.css`
- [x] Institutional QCU-style design
- [x] Image-based building cards
- [x] Redesigned Full Schedule table (sticky header, alternating rows, today highlight, current highlight)
- [x] Compact class cards
- [x] Remove AI-slop styling
- [x] Responsive mobile layout
- [x] General spacing/typography polish

## Step 6: Populate `data/schedule.json` & `data/buildings.json`
- [x] Write actual schedule data
- [x] Write actual buildings data including Techboc Building

## Step 7: Update `service-worker.js`
- [x] Bump cache to v3
- [x] Add new building images to precache
