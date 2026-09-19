// Shared matching for every player search. The dictionary is bundled for offline use.
const playerSearchTokens = new Map();
let playerSearchHistory = { scope: '', names: new Map() };
function normalizePlayerSearchValue(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
}
function getPlayerSearchTokens(name) {
  if (!playerSearchTokens.has(name)) {
    const text = String(name ?? '');
    const syllables = typeof pinyinPro !== 'undefined'
      ? pinyinPro.pinyin(text, { toneType: 'none', type: 'array', v: true })
      : Array.from(text);
    const initials = syllables.map((part, i) => /\p{Script=Han}/u.test(Array.from(text)[i] || '') ? part[0] : part).join('');
    const wordInitials = text.split(/\s+/u).map(word => word[0] || '').join('');
    playerSearchTokens.set(name, [text, syllables.join(''), initials, wordInitials].map(normalizePlayerSearchValue));
  }
  return playerSearchTokens.get(name);
}
function getPlayerSearchInitials(name) { return getPlayerSearchTokens(name)[2]; }
function playerSearchScope() {
  if (typeof clubState === 'undefined' || typeof getRemoteUser !== 'function') return '';
  return clubState.active?.status === 'approved' ? `${getRemoteUser()?.id || ''}:${clubState.active.id}` : '';
}
function playerSearchAliases(name) {
  return playerSearchHistory.scope === playerSearchScope() ? playerSearchHistory.names.get(name)?.aliases || [] : [];
}
function playerSearchMatch(name, keyword) {
  const query = normalizePlayerSearchValue(keyword);
  if (!query) return { score: 0, previous: '' };
  const tokens = getPlayerSearchTokens(name);
  if (tokens[0] === query) return { score: 0, previous: '' };
  if (tokens.some(token => token.includes(query))) return { score: 1, previous: '' };
  const previous = playerSearchAliases(name).find(alias => getPlayerSearchTokens(alias).some(token => token.includes(query)));
  return { score: previous ? 2 : Infinity, previous: previous || '' };
}
function doesPlayerMatchKeyword(name, keyword) { return Number.isFinite(playerSearchMatch(name, keyword).score); }
function searchPlayerNames(names, keyword) {
  return names.map(name => ({ name, match: playerSearchMatch(name, keyword) }))
    .filter(row => Number.isFinite(row.match.score)).sort((a,b) => a.match.score - b.match.score).map(row => row.name);
}
function playerSearchPreviousHtml(name, keyword) {
  const previous = playerSearchMatch(name, keyword).previous;
  const safe = previous.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  return previous ? `<small class="player-search-previous">Previously: ${safe}</small>` : '';
}
// Reuse the existing membership-protected details endpoint. Keep historical names
// in memory only, scoped to the signed-in account and club, with bounded requests.
async function loadPlayerSearchHistory(keyword) {
  if (!normalizePlayerSearchValue(keyword)) return;
  const scope = playerSearchScope();
  if (!scope || typeof remoteState === 'undefined' || !remoteState.client) return;
  if (playerSearchHistory.scope !== scope) playerSearchHistory = { scope, names: new Map() };
  const cache = playerSearchHistory;
  const clubId = clubState.active.id;
  const now = Date.now();
  const names = (data.players || []).filter(name => !cache.names.has(name) || now - cache.names.get(name).time > 300000);
  names.forEach(name => cache.names.set(name, { aliases: cache.names.get(name)?.aliases || [], time: now }));
  let changed = false;
  await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
    while (names.length && playerSearchScope() === scope && cache === playerSearchHistory) {
      const name = names.shift();
      try {
        const result = await remoteState.client.rpc('poker_player_details', { club_id: clubId, player_name: name });
        if (result.error || playerSearchScope() !== scope || cache !== playerSearchHistory) continue;
        const aliases = [...new Set((result.data?.history || []).flatMap(change => [change.old_name, change.new_name]).filter(alias => alias && alias !== name))];
        cache.names.set(name, { aliases, time: now });
        changed = true;
      } catch (_) { /* Current-name search remains available if the network fails. */ }
    }
  }));
  if (!changed || playerSearchScope() !== scope || cache !== playerSearchHistory) return;
  if (document.getElementById('page-settings')?.classList.contains('active')) renderSettings();
  if (document.getElementById('player-picker-modal')?.classList.contains('open')) renderPlayerPickerList();
  if (document.getElementById('page-history')?.classList.contains('active')) updateCashLeaderboardSearchResults();
}
