# Texas Hold'em Tournament Points Management System

## Project Overview
**App Name:** 策略博弈研习社
**Type:** Single-page web application (PWA-ready)
**Language:** Chinese interface
**Tech Stack:** Vanilla HTML/CSS/JavaScript, localStorage persistence

## Project Structure
```
texasholdem/
├── index.html          # Main app (single file, ~3000 lines)
├── apple-touch-icon.png  # PWA icon
├── icon.svg            # Icon source
├── .claude/            # Claude settings
│   ├── settings.local.json
│   └── PROJECT_CONTEXT.md  # This file
├── points/             # Points/leaderboard docs
├── tournament/         # Tournament rules docs
└── DEPLOY.md           # Deployment instructions (GitHub Pages)
```

## Core Features

### 1. Tournament Mode (锦标赛)
- Record tournament results with player rankings (1st, 2nd, 3rd + ties)
- Custom blind structure templates (user-created only, no presets)
- Settings: blind duration, starting chips, rebuy rules, think time
- Points system: customizable ratio (default 5:3:2 for 1st/2nd/3rd)
- Formula: 1 base point + extra based on participants × ratio

### 2. In-Game Tournament Mode (实时对局)
- Blind level timer with auto level-up and sound alerts
- Thinking timer (20s normal / 40s all-in) with timeout warning
- Rebuy tracking with limits (max X hands per player, only in first Y levels)
- Elimination tracking with auto-end when 1 player remains
- Pause/Resume functionality
- Rebuy summary display at bottom

### 3. Cash Game Mode
- Track buy-ins/rebuys with timestamps
- Real-time PnL calculation per player
- Chip validation (zero-sum verification)
- Auto-transfer settlement suggestions (who pays whom)
- Import players from tournament records
- Auto-save recording mode

### 4. Leaderboard
- Total points rankings across all tournaments
- Shareable image generation for WeChat/social media (canvas-based)

### 5. Data Management
- Local storage persistence (`texasholdem_data` key)
- Export/import JSON
- Player management (add/remove)
- Tournament/Cash game history
- Delete individual records
- Tournament index calculated by date (not array position)

## Key Data Structures

```javascript
data = {
  players: [],           // List of player names
  tournaments: [],       // Tournament records
  currentRatio: [5,3,2], // Points ratio for 1st/2nd/3rd
  cashGames: [],         // Cash game records
  cashSettings: { chipsPerHand: 1000, pricePerHand: 20 },
  blindTemplates: [],    // User-created blind templates (no presets)
  tournamentSettings: { currentTemplateId: null, customSettings: {...} }
}
```

## Template System
- No preset templates (slow/medium/fast removed)
- Users create custom templates with:
  - Blind levels (SB/BB/Ante)
  - Blind duration (minutes per level)
  - Starting chips
  - Rebuy rules (early levels, max per player)
  - Think time settings
- Templates can be renamed, updated, or deleted

## UI Navigation
- **比赛 (Match):** Mode selection (Tournament/Cash Game)
- **排行榜 (Leaderboard):** Total points display
- **历史 (History):** Past tournaments and cash games by date
- **设置 (Settings):** Ratio, cash settings, data export/import, player management

## Common Tasks

### Adding New Features
- Most UI changes happen in `index.html`
- Styles use CSS variables in `:root` (dark theme)
- Mobile-first design, max-width 600px

### Testing
- GitHub Pages deployment: push to main branch
- Test on mobile (PWA capable)

## Known Issues / Recent Fixes
- Missing closing `</script>` tag caused blank page - fixed
- Missing closing parenthesis in `saveCurrentSettings` - fixed
- Template name input was hidden in custom mode - fixed
- Tournament index calculation based on array position was wrong - fixed to use date ordering
- Rebuy rules not applied in in-game mode - fixed
- Auto-end game when 1 player remains - added

## Recent Discussion Summary (2025-02-07)
1. **Template Management**: Removed preset templates, users create custom templates only. Templates can be renamed, updated, deleted.
2. **In-Game Rebuy Rules**:
   - Rebuy limits are read from tournament settings
   - "前X级可补，每次最多Y手" means: can rebuy in first X levels, max Y hands per player
   - After level X, rebuy button is disabled
   - When player reaches Y hands, rebuy button is disabled
3. **Auto-End Tournament**: When only 1 player remains (all others eliminated), auto-end and show rankings
4. **Rebuy Summary**: Added summary at bottom showing each player's rebuy count (format: "2/2手")
5. **Tournament Index**: Calculated by date order, not array position (fixes issue where deleted tournaments caused wrong numbering)
