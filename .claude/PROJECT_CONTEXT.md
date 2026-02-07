# Texas Hold'em Tournament Points Management System

## Project Overview
**App Name:** 策略博弈研习社
**Type:** Single-page web application (PWA-ready)
**Language:** Chinese interface
**Tech Stack:** Vanilla HTML/CSS/JavaScript, localStorage persistence

## Project Structure
```
texasholdem/
├── index.html          # Main app (single file, ~2500 lines)
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
- Configurable blind structure (slow/medium/fast templates + custom)
- Settings: blind duration, starting chips, rebuy rules, think time
- Points system: customizable ratio (default 5:3:2 for 1st/2nd/3rd)
- Formula: 1 base point + extra based on participants × ratio

### 2. Cash Game Mode
- Track buy-ins/rebuys with timestamps
- Real-time PnL calculation per player
- Chip validation (zero-sum verification)
- Auto-transfer settlement suggestions (who pays whom)
- Import players from tournament records
- Auto-save recording mode

### 3. Leaderboard
- Total points rankings across all tournaments
- Shareable image generation for WeChat/social media (canvas-based)

### 4. Data Management
- Local storage persistence (`texasholdem_data` key)
- Export/import JSON
- Player management (add/remove)
- Tournament/Cash game history
- Delete individual records

## Key Data Structures

```javascript
data = {
  players: [],           // List of player names
  tournaments: [],       // Tournament records
  currentRatio: [5,3,2], // Points ratio for 1st/2nd/3rd
  cashGames: [],         // Cash game records
  cashSettings: { chipsPerHand: 1000, pricePerHand: 20 },
  blindTemplates: [],    // Preset blind structures
  tournamentSettings: { currentTemplateId: 'medium', customSettings: {...} }
}
```

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
- Tournament settings modal click handler was being overridden by `updateTournamentSettingsSummary()` - fixed by removing the overriding `onclick` assignment
