// ====== Tournament Settings ======
let currentBlindLevels = [];
let currentTemplateId = 'custom'; // 'custom' or template ID
const DEFAULT_TOURNAMENT_LEVELS = [
  { sb: 25, bb: 50, ante: 0 },
  { sb: 50, bb: 100, ante: 0 },
  { sb: 100, bb: 200, ante: 0 },
  { sb: 150, bb: 300, ante: 0 },
  { sb: 200, bb: 400, ante: 0 },
  { sb: 300, bb: 600, ante: 50 },
  { sb: 400, bb: 800, ante: 75 },
  { sb: 500, bb: 1000, ante: 100 }
];
const DEFAULT_TOURNAMENT_CONFIG = {
  blindDuration: 20,
  startingChips: 10000,
  rebuyEarlyLevels: 3,
  rebuyEarlyMax: 2,
  thinkTimeNormal: 20,
  thinkTimeAllin: 40
};

function cloneTournamentLevels(levels) {
  return JSON.parse(JSON.stringify(levels));
}

function parseTournamentInt(value, fallback, minValue) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return parsed >= minValue ? parsed : fallback;
}

function normalizeBlindLevels(levels, allowEmpty = false) {
  if (!Array.isArray(levels)) {
    return allowEmpty ? [] : cloneTournamentLevels(DEFAULT_TOURNAMENT_LEVELS);
  }

  const normalized = levels.map(level => {
    const sb = parseTournamentInt(level && level.sb, 0, 0);
    const bb = parseTournamentInt(level && level.bb, 0, 0);
    const ante = parseTournamentInt(level && level.ante, 0, 0);
    return { sb, bb, ante };
  }).filter(level => level.sb > 0 && level.bb > 0 && level.bb >= level.sb);

  if (normalized.length === 0 && !allowEmpty) {
    return cloneTournamentLevels(DEFAULT_TOURNAMENT_LEVELS);
  }
  return normalized;
}

function normalizeTournamentConfig(rawConfig, options = {}) {
  const cfg = rawConfig || {};
  const allowEmptyLevels = !!options.allowEmptyLevels;
  return {
    blindDuration: parseTournamentInt(cfg.blindDuration, DEFAULT_TOURNAMENT_CONFIG.blindDuration, 1),
    startingChips: parseTournamentInt(cfg.startingChips, DEFAULT_TOURNAMENT_CONFIG.startingChips, 1),
    rebuyEarlyLevels: parseTournamentInt(cfg.rebuyEarlyLevels, DEFAULT_TOURNAMENT_CONFIG.rebuyEarlyLevels, 0),
    rebuyEarlyMax: parseTournamentInt(cfg.rebuyEarlyMax, DEFAULT_TOURNAMENT_CONFIG.rebuyEarlyMax, 0),
    thinkTimeNormal: parseTournamentInt(cfg.thinkTimeNormal, DEFAULT_TOURNAMENT_CONFIG.thinkTimeNormal, 1),
    thinkTimeAllin: parseTournamentInt(cfg.thinkTimeAllin, DEFAULT_TOURNAMENT_CONFIG.thinkTimeAllin, 1),
    levels: normalizeBlindLevels(cfg.levels, allowEmptyLevels)
  };
}

function getActiveTournamentConfig() {
  const settings = data.tournamentSettings || {};
  const templateId = settings.currentTemplateId;
  if (templateId) {
    const template = data.blindTemplates.find(t => t.id === templateId);
    if (template) {
      const normalized = normalizeTournamentConfig(template);
      return {
        ...normalized,
        source: 'template',
        templateId: template.id,
        templateName: template.name
      };
    }
  }

  if (settings.customSettings) {
    const normalized = normalizeTournamentConfig(settings.customSettings);
      return {
      ...normalized,
      source: 'custom',
      templateId: null,
      templateName: 'Custom'
    };
  }

  const defaults = normalizeTournamentConfig({});
  return {
    ...defaults,
    source: 'default',
    templateId: null,
    templateName: 'Default'
  };
}

function readTournamentConfigFromForm(options = {}) {
  return normalizeTournamentConfig({
    blindDuration: document.getElementById('blind-duration').value,
    startingChips: document.getElementById('starting-chips').value,
    rebuyEarlyLevels: document.getElementById('rebuy-early-levels').value,
    rebuyEarlyMax: document.getElementById('rebuy-early-max').value,
    thinkTimeNormal: document.getElementById('think-time-normal').value,
    thinkTimeAllin: document.getElementById('think-time-allin').value,
    levels: cloneTournamentLevels(currentBlindLevels)
  }, options);
}

function openTournamentSettings() {
  const modal = document.getElementById('tournament-settings-modal');
  const settings = data.tournamentSettings;

  // Build template list
  const templateList = document.getElementById('template-list');
  templateList.innerHTML = '';
  const customBtn = document.createElement('button');
  customBtn.className = 'player-chip';
  customBtn.id = 'tpl-btn-custom';
  customBtn.textContent = 'Custom';
  customBtn.onclick = function() { selectTemplate('custom'); };
  templateList.appendChild(customBtn);
  data.blindTemplates.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'player-chip';
    btn.id = 'tpl-btn-' + t.id;
    btn.textContent = t.name;
    btn.onclick = function() { selectTemplate(t.id); };
    templateList.appendChild(btn);
  });

  // Select current template, fallback to custom when template no longer exists
  const hasActiveTemplate = !!(settings.currentTemplateId &&
    data.blindTemplates.some(t => t.id === settings.currentTemplateId));
  if (settings.currentTemplateId && !hasActiveTemplate) {
    settings.currentTemplateId = null;
    saveData();
  }
  currentTemplateId = hasActiveTemplate ? settings.currentTemplateId : 'custom';
  selectTemplate(currentTemplateId);

  modal.classList.add('open');
}

function closeTournamentSettings() {
  document.getElementById('tournament-settings-modal').classList.remove('open');
}

function selectTemplate(templateId) {
  currentTemplateId = templateId;

  // Update UI selection
  document.querySelectorAll('#template-list .player-chip').forEach(btn => {
    btn.classList.remove('selected');
  });
  const selectedBtn = document.getElementById('tpl-btn-' + templateId);
  if (selectedBtn) selectedBtn.classList.add('selected');

  const nameInput = document.getElementById('template-name-input');
  const actionsDiv = document.getElementById('template-actions');

  if (templateId === 'custom') {
    // Load custom settings
    const hasCustom = !!data.tournamentSettings.customSettings;
    const custom = normalizeTournamentConfig(data.tournamentSettings.customSettings || {}, {
      allowEmptyLevels: true
    });
    currentBlindLevels = hasCustom ? custom.levels : [];

    // Show template name input for new template
    nameInput.value = '';
    nameInput.placeholder = 'New template name';
    document.getElementById('current-template-name').style.display = '';

    // Show "Save as new template" button
    actionsDiv.innerHTML = '<button class="btn btn-sm btn-primary" onclick="saveAsNewTemplate()" style="width:100%;">Save as new template</button>';

    // Load form values
    document.getElementById('blind-duration').value = custom.blindDuration;
    document.getElementById('starting-chips').value = custom.startingChips;
    document.getElementById('rebuy-early-levels').value = custom.rebuyEarlyLevels;
    document.getElementById('rebuy-early-max').value = custom.rebuyEarlyMax;
    document.getElementById('think-time-normal').value = custom.thinkTimeNormal;
    document.getElementById('think-time-allin').value = custom.thinkTimeAllin;
  } else {
    // Load saved template
    const template = data.blindTemplates.find(t => t.id === templateId);
    if (!template) {
      currentTemplateId = 'custom';
      selectTemplate('custom');
      return;
    }
    if (template) {
      const normalizedTemplate = normalizeTournamentConfig(template);
      currentBlindLevels = normalizedTemplate.levels;

      // Show template name input for editing
      nameInput.value = template.name;
      document.getElementById('current-template-name').style.display = '';

      // Show edit/delete buttons
      actionsDiv.innerHTML = `
        <div style="display:flex;gap:8px;">
          <button class="btn btn-sm btn-primary" onclick="updateTemplateName()" style="flex:1;">Rename</button>
          <button class="btn btn-sm btn-green" onclick="updateTemplate()" style="flex:1;">Update</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTemplate('${templateId}')">Delete</button>
        </div>
      `;

      // Load form values
      document.getElementById('blind-duration').value = normalizedTemplate.blindDuration;
      document.getElementById('starting-chips').value = normalizedTemplate.startingChips;
      document.getElementById('rebuy-early-levels').value = normalizedTemplate.rebuyEarlyLevels;
      document.getElementById('rebuy-early-max').value = normalizedTemplate.rebuyEarlyMax;
      document.getElementById('think-time-normal').value = normalizedTemplate.thinkTimeNormal;
      document.getElementById('think-time-allin').value = normalizedTemplate.thinkTimeAllin;
    }
  }

  // Render blind levels
  if (currentBlindLevels.length === 0) {
    document.getElementById('blind-levels-list').innerHTML = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:12px;">Add a level below</div>';
  } else {
    renderBlindLevels();
  }
}

function saveAsNewTemplate() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  const nameInput = document.getElementById('template-name-input');
  const name = nameInput.value.trim();

  if (!name) {
    showToast('Enter a template name');
    return;
  }

  if (currentBlindLevels.length === 0) {
    showToast('Add blind levels first');
    return;
  }

  const newTemplate = {
    id: 'tpl_' + Date.now(),
    name: name,
    ...readTournamentConfigFromForm()
  };

  data.blindTemplates.push(newTemplate);
  saveData();

  // Refresh template list and select new template
  openTournamentSettings();
  selectTemplate(newTemplate.id);

  showToast('Template saved: ' + name);
}

function updateTemplateName() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  if (currentTemplateId === 'custom') return;

  const nameInput = document.getElementById('template-name-input');
  const newName = nameInput.value.trim();

  if (!newName) {
    showToast('Enter a template name');
    return;
  }

  const template = data.blindTemplates.find(t => t.id === currentTemplateId);
  if (template) {
    template.name = newName;
    saveData();

    // Refresh UI
    openTournamentSettings();
    selectTemplate(currentTemplateId);

    showToast('Template renamed');
  }
}

function updateTemplate() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  if (currentTemplateId === 'custom') return;

  const template = data.blindTemplates.find(t => t.id === currentTemplateId);
  if (template) {
    Object.assign(template, readTournamentConfigFromForm());

    saveData();
    showToast('Template updated');
  }
}

function deleteTemplate(templateId) {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  if (!confirm('Delete this template?')) return;

  data.blindTemplates = data.blindTemplates.filter(t => t.id !== templateId);

  // If this was the selected template, reset to custom
  if (data.tournamentSettings.currentTemplateId === templateId) {
    data.tournamentSettings.currentTemplateId = null;
  }

  saveData();

  // Refresh and select custom
  openTournamentSettings();
  selectTemplate('custom');

  showToast('Template deleted');
}

function saveCurrentSettings() {
  if (typeof requireClubWrite === 'function' && !requireClubWrite(false)) return;
  // Save current form values as the active settings
  if (currentTemplateId === 'custom') {
    data.tournamentSettings.currentTemplateId = null;
    data.tournamentSettings.customSettings = readTournamentConfigFromForm({ allowEmptyLevels: true });
  } else {
    // Using a template
    data.tournamentSettings.currentTemplateId = currentTemplateId;
    data.tournamentSettings.customSettings = null;
  }

  saveData();
  closeTournamentSettings();
  updateTournamentSettingsSummary();
  showToast('Settings saved');
}

function renderBlindLevels() {
  const container = document.getElementById('blind-levels-list');
  container.innerHTML = '';

  if (currentBlindLevels.length === 0) {
    container.innerHTML = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:12px;">No levels yet. Add one below.</div>';
    return;
  }

  currentBlindLevels.forEach((level, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-header" onclick="toggleBlindLevelEdit(${index})">
        <div>
          <div class="history-title">Level ${index + 1}</div>
          <div class="history-meta">${level.sb}/${level.bb} ${level.ante ? '+ Ante ' + level.ante : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="color:var(--text2);font-size:12px;">Tap to edit</span>
          <span>▸</span>
        </div>
      </div>
      <div class="history-detail" id="blind-detail-${index}">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px;">Small blind</label>
            <input type="number" class="cash-input" value="${level.sb}" onchange="updateBlindLevel(${index}, 'sb', this.value)" style="width:100%;">
          </div>
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px;">Big blind</label>
            <input type="number" class="cash-input" value="${level.bb}" onchange="updateBlindLevel(${index}, 'bb', this.value)" style="width:100%;">
          </div>
          <div style="flex:1;">
            <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:4px;">Ante</label>
            <input type="number" class="cash-input" value="${level.ante || 0}" onchange="updateBlindLevel(${index}, 'ante', this.value)" style="width:100%;">
          </div>
        </div>
        <button class="btn btn-sm btn-danger" onclick="removeBlindLevel(${index})" style="width:100%;">Delete level</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function toggleBlindLevelEdit(index) {
  const detail = document.getElementById(`blind-detail-${index}`);
  const arrow = detail.previousElementSibling.querySelector('span:last-child');
  detail.classList.toggle('open');
  arrow.textContent = detail.classList.contains('open') ? '▾' : '▸';
}

function addBlindLevel() {
  const lastLevel = currentBlindLevels[currentBlindLevels.length - 1];
  const newLevel = {
    sb: lastLevel ? lastLevel.bb : 25,
    bb: lastLevel ? lastLevel.bb * 2 : 50,
    ante: 0
  };
  currentBlindLevels.push(newLevel);
  renderBlindLevels();
}

function removeBlindLevel(index) {
  currentBlindLevels.splice(index, 1);
  renderBlindLevels();
}

function updateBlindLevel(index, field, value) {
  currentBlindLevels[index][field] = parseInt(value) || 0;
}

function updateTournamentSettingsSummary() {
  const summary = document.getElementById('tournament-settings-summary');
  if (!summary) return; // Element may not exist in all views
  const activeConfig = getActiveTournamentConfig();
  const templateName = activeConfig.templateName;
  const blindDuration = activeConfig.blindDuration;
  const startingChips = activeConfig.startingChips;
  const rebuyInfo = activeConfig.rebuyEarlyLevels > 0
    ? `Rebuys through level ${activeConfig.rebuyEarlyLevels} (max ${activeConfig.rebuyEarlyMax} per player)`
    : 'No rebuys for this game';

  summary.innerHTML = `
    <div>${templateName}</div>
    <div style="margin-top:4px;font-size:12px;color:var(--text2);">${blindDuration}min / level | ${startingChips}chips</div>
    <div style="margin-top:4px;font-size:12px;color:var(--text2);">${rebuyInfo}</div>
  `;

  // Add clickable style
  summary.style.cursor = 'pointer';
  summary.style.borderColor = 'var(--border)';
  summary.onmouseenter = () => {
    summary.style.background = 'rgba(255,255,255,0.06)';
  };
  summary.onmouseleave = () => {
    summary.style.background = 'transparent';
  };
}
