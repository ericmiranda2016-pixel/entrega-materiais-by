(() => {
  'use strict';

  const DEFAULT_CATALOG = {
    EQE: { total: 233, components: [{ name: 'Aramados baixos', meta: 60 }, { name: 'Aramados altos', meta: 38 }, { name: 'Caixarias', meta: 135 }] },
    HA2: { total: 240, components: [{ name: 'Aramados baixos', meta: 60 }, { name: 'Aramados altos', meta: 60 }, { name: 'Escapamentos', meta: 120 }] },
    'SA2/SA6': { total: 120, components: [{ name: 'Barcas', meta: 40 }, { name: 'Motores / Eixos', meta: 40 }, { name: 'Aramados de Caixas', meta: 40 }] },
    SC3: { total: 120, components: [{ name: 'Aramados baixos', meta: 30 }, { name: 'Aramados altos', meta: 30 }, { name: 'Caixarias', meta: 60 }] },
    PBP: { total: 387, components: [{ name: 'Aramados altos e baixos', meta: 60 }, { name: 'Caixarias', meta: 87 }, { name: 'Jantes', meta: 240 }] }
  };

  const DEFAULT_GOVERNANCE_SHIFTS = {
    'Turno A': { coordinator: '', leadership: '' },
    'Turno B': { coordinator: 'Anderson Andrade', leadership: 'Daniela Menezes' },
    'Turno C': { coordinator: '', leadership: '' },
    Geral: { coordinator: 'Anderson Andrade', leadership: 'Daniela Menezes' }
  };

  const LOTS_KEY = 'byd_active_lots_v1';
  const LOCAL_LOTS_KEY = 'byd_lotes';
  const UI_CONFIG_KEY = 'byd_ui_governance_v1';
  const SELECTED_LOT_KEY = 'byd_selected_lot_v1';

  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const safeJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; }
    catch (_) { return fallback; }
  };

  function cloneDefaultGovernance() {
    return Object.fromEntries(
      Object.entries(DEFAULT_GOVERNANCE_SHIFTS).map(([shift, data]) => [shift, { ...data }])
    );
  }

  function normalizeShiftLabel(value) {
    const raw = String(value || '').trim();
    if (!raw || /^geral$/i.test(raw) || /^todos$/i.test(raw)) return 'Geral';
    const match = raw.match(/([ABC])$/i);
    return match ? `Turno ${match[1].toUpperCase()}` : 'Turno B';
  }

  function normalizeLotRow(lot) {
    const source = lot || {};
    return {
      id: source.ID_Lote || source.id || '',
      name: String(source.Nome_Lote || source.name || '').trim(),
      model: String(source.Modelo_Base || source.model || '').trim(),
      createdAt: source.Data_Criacao || source.createdAt || '',
      createdLocalAt: Number(source.createdLocalAt) || 0,
      shift: source.Turno_Vinculado || source.shift || '',
      Ativo: String(source.Ativo || 'SIM').trim().toUpperCase()
    };
  }

  function isActiveLot(lot) {
    return !['NAO', 'NÃO', 'INATIVO', 'FALSE', '0'].includes(String(lot.Ativo || 'SIM').toUpperCase());
  }

  function sameLot(left, right) {
    if (left.id && right.id && String(left.id) === String(right.id)) return true;
    return left.name.toLocaleLowerCase('pt-BR') === right.name.toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(left.model) === normalizeModelKey(right.model);
  }

  function isLotQueuedLocally(lot) {
    try {
      return DB.getQueue().some((item) =>
        ['criar_lote', 'salvar_lote'].includes(item.action) && (
          (lot.id && item.ID_Lote === lot.id) ||
          (String(item.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR') === lot.name.toLocaleLowerCase('pt-BR') &&
           normalizeModelKey(item.Modelo_Base) === normalizeModelKey(lot.model))
        )
      );
    } catch (_) {
      return false;
    }
  }

  function mergeLotCollections(remoteRows, localRows, authoritativeRemote = false) {
    const remote = remoteRows.map(normalizeLotRow);
    const merged = remote.filter(isActiveLot).map(({ Ativo, ...lot }) => lot);
    const now = Date.now();
    localRows.map(normalizeLotRow).forEach((lot) => {
      if (!lot.name || !lot.model || !isActiveLot(lot)) return;
      if (remote.some((remoteLot) => sameLot(remoteLot, lot))) return;
      if (merged.some((existingLot) => sameLot(existingLot, lot))) return;
      if (authoritativeRemote) {
        const isRecentLocal = lot.createdLocalAt > 0 && (now - lot.createdLocalAt) < 45000;
        if (!isRecentLocal && !isLotQueuedLocally(lot)) return;
      }
      const { Ativo, ...activeLot } = lot;
      merged.push(activeLot);
    });
    return merged;
  }

  let CATALOG = cloneCatalog(DEFAULT_CATALOG);
  let uiConfig = {
    shifts: cloneDefaultGovernance()
  };
  let session = null;
  let SESSAO = null;
  let activeLots = mergeLotCollections([], [
    ...safeJson(LOTS_KEY, []),
    ...safeJson(LOCAL_LOTS_KEY, []),
    ...safeJson('Cadastro_Lista_Lotes', [])
  ]);
  if (!Array.isArray(activeLots)) activeLots = [];
  let lotProgress = safeJson('Progresso_Lotes', []);
  if (!Array.isArray(lotProgress)) lotProgress = [];
  let records = DB.getCache();
  if (!Array.isArray(records)) records = [];
  let tripItems = [];
  let lastSavedTrip = [];
  let adminUsers = [];
  let allResources = DB.getCachedResources();
  let adminDataOffline = false;
  let selectedLotId = localStorage.getItem(SELECTED_LOT_KEY) || '';
  let editingUserOriginal = '';
  let selectedComponent = '';
  let quantity = 0;
  let evidenceFile = null;
  let evidenceObjectUrl = '';
  let currentToastTimer;
  let pollingTimer = null;
  let silentSyncPending = false;

  function cloneCatalog(source) {
    return Object.fromEntries(Object.entries(source).map(([key, value]) => [
      key, { total: value.total, components: value.components.map((item) => ({ ...item })) }
    ]));
  }

  function showToast(message, duration = 3200) {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(currentToastTimer);
    currentToastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
  }

  function profile() {
    return session ? String(session.Perfil || '').toUpperCase() : '';
  }

  function isGeneralAdmin() {
    return profile() === 'ADMIN_GERAL';
  }

  function isLeader() {
    return profile() === 'LIDER_TURNO';
  }

  function canOpenAdminViews() {
    return isGeneralAdmin() || isLeader();
  }

  function currentOperator() {
    return session ? session.Nome || (session.user && session.user.Nome) || '' : '';
  }

  function currentShift() {
    const shift = session && session.Turno ? session.Turno : 'Turno A';
    if (String(shift).toUpperCase() === 'TODOS') return 'Geral';
    return /^Turno\s+/i.test(shift) || shift === 'Geral' ? shift : `Turno ${shift}`;
  }

  function linkedShift() {
    return session && session.Turno_Vinculado ? session.Turno_Vinculado : currentShift();
  }

  function turnKey(value) {
    return String(value || '').replace(/^Turno\s+/i, '').trim().toUpperCase();
  }

  function governanceForShift(shift = currentShift()) {
    const key = normalizeShiftLabel(shift);
    const shifts = (uiConfig && uiConfig.shifts) || cloneDefaultGovernance();
    const entry = shifts[key] || { coordinator: '', leadership: '' };
    return {
      coordinator: String(entry.coordinator || '').trim(),
      leadership: String(entry.leadership || '').trim()
    };
  }

  function loginError(message) {
    el('loginFeedback').textContent = message;
  }

  function showLogin(message = '') {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = null;
    DB.stopRealtime();
    session = null;
    SESSAO = null;
    DB.clearSession();
    el('appShell').hidden = true;
    el('loginView').hidden = false;
    el('loginPin').value = '';
    loginError(message);
    setTimeout(() => el('loginMatricula').focus(), 0);
  }

  function renderSessionHeader() {
    el('operatorSummary').innerHTML = `<span title="${escapeHtml(currentOperator())}">${escapeHtml(currentOperator())}</span>
      <span class="user-role">${escapeHtml(profile())}</span>`;
    const general = isGeneralAdmin();
    el('shiftSummary').hidden = general;
    el('generalShiftSelect').hidden = !general;
    el('generalShiftSelect').value = currentShift();
    el('shiftSummary').textContent = currentShift();
  }

  function renderAccess() {
    const admin = canOpenAdminViews();
    document.querySelectorAll('.admin-only').forEach((item) => { item.hidden = !admin; });
    document.querySelectorAll('.admin-general-only').forEach((item) => { item.hidden = !isGeneralAdmin(); });
    document.querySelectorAll('.admin-general-only input, .admin-general-only select, .admin-general-only textarea, .admin-general-only button')
      .forEach((control) => { control.disabled = !isGeneralAdmin(); });
    document.querySelectorAll('[data-view="cockpit"], [data-view="settings"]').forEach((item) => {
      item.setAttribute('aria-hidden', String(!admin));
      item.tabIndex = admin ? 0 : -1;
    });
    el('navInner').style.gridTemplateColumns = admin ? 'repeat(3, minmax(0, 1fr))' : '1fr';
    renderSessionHeader();
    applyUserFormPermissions();
    applyResourceFormPermissions();
    if (!admin && !el('operationView').classList.contains('active')) {
      document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
      el('operationView').classList.add('active');
      document.querySelectorAll('.nav-button').forEach((button) =>
        button.classList.toggle('active', button.dataset.view === 'operation')
      );
    }
  }

  function showApp() {
    el('loginView').hidden = true;
    el('appShell').hidden = false;
    renderAccess();
    resetUserForm();
    resetResourceForm();
    mudarAba('operation');
  }

  function goToLoginIfUnauthorized(error) {
    if (error && error.code === 'AUTH_REQUIRED') {
      showLogin('Sua sessão expirou ou foi revogada. Entre novamente.');
      return true;
    }
    if (error && error.code === 'FORBIDDEN') {
      showToast('Seu perfil não tem permissão para esta ação.', 5000);
      return true;
    }
    return false;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const button = el('loginButton');
    const matricula = el('loginMatricula').value.trim();
    const pin = el('loginPin').value.trim();
    const turno = el('loginShift').value;
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(matricula) || !/^\d{4}$/.test(pin)) {
      loginError('Informe uma matrícula válida e PIN com 4 dígitos.');
      return;
    }
    button.disabled = true;
    loginError('Validando acesso no banco...');
    try {
      const authenticated = await DB.authenticate({ Matricula: matricula, PIN: pin, Turno: turno });
      if (authenticated.expiresIn) authenticated.expiresAt = Date.now() + authenticated.expiresIn * 1000;
      session = DB.setSession(authenticated);
      SESSAO = session;
      localStorage.setItem('byd_operator', currentOperator());
      localStorage.setItem('byd_shift', currentShift());
      el('loginFeedback').textContent = '';
      showApp();
      loadGovernanceConfig();
      await loadAuthenticatedData();
    } catch (error) {
      loginError(error.code === 'INVALID_CREDENTIALS'
        ? 'Matrícula, PIN ou status inválido.'
        : error.message || 'Falha ao autenticar.');
    } finally {
      button.disabled = false;
    }
  }

  async function loadAuthenticatedData() {
    renderAccess();
    try {
      const snapshot = await DB.sincronizarLeitura();
      applySnapshot(snapshot);
      if (!snapshot.offline) setLastRefreshTime();
    } catch (error) {
      if (goToLoginIfUnauthorized(error)) return;
      showToast(error.message || 'Não foi possível sincronizar os dados.');
      records = DB.getCache();
      allResources = DB.getCachedResources();
      activeLots = readCachedLots();
      const cachedProgress = DB.getLotProgress();
      lotProgress = cachedProgress.length ? cachedProgress : deriveLocalProgress();
      if (canOpenAdminViews()) adminUsers = offlineUsers();
    }
    session = DB.getSession() || session;
    SESSAO = session;
    loadGovernanceConfig();
    renderModelSelect();
    renderOperationResources();
    fillGovernanceForm();
    renderUsers();
    renderResources();
    refreshViews();
    startRealtimeAndPolling();
  }

  function offlineUsers() {
    return visibleUsers(DB.getCachedUsers());
  }

  function visibleUsers(users) {
    if (isGeneralAdmin()) {
      const filter = el('userShiftFilter') ? el('userShiftFilter').value : 'ALL';
      if (filter === 'ALL') return users;
      return users.filter((u) => turnKey(u.Turno_Vinculado) === turnKey(filter));
    }
    if (isLeader()) {
      return users.filter((user) =>
        String(user.Perfil).toUpperCase() === 'OPERADOR' &&
        turnKey(user.Turno_Vinculado) === turnKey(linkedShift())
      );
    }
    return [];
  }

  function visibleResourcesForAdmin(resources) {
    if (isGeneralAdmin()) {
      const filter = el('resourceShiftFilter') ? el('resourceShiftFilter').value : 'ALL';
      if (filter === 'ALL') return resources;
      return resources.filter((r) => turnKey(r.Turno_Vinculado) === turnKey(filter));
    }
    if (isLeader()) {
      return resources.filter((r) => turnKey(r.Turno_Vinculado) === turnKey(linkedShift()));
    }
    return [];
  }

  function allowedResourcesForShift(tipo, targetShift = currentShift()) {
    const active = allResources.filter((r) =>
      String(r.Tipo).toUpperCase() === tipo &&
      String(r.Ativo).toUpperCase() === 'SIM'
    );
    if (targetShift === 'Geral') {
      return active;
    }
    const shiftKey = turnKey(targetShift);
    return active.filter((r) => {
      const resTurn = turnKey(r.Turno_Vinculado);
      return resTurn === shiftKey || resTurn === 'TODOS';
    });
  }

  function renderOperationResources() {
    const shift = currentShift();
    const drivers = allowedResourcesForShift('MOTORISTA', shift);
    const fleets = allowedResourcesForShift('FROTA', shift);

    const prevDriver = el('driverInput').value;
    const prevFleet = el('fleetInput').value;

    const formatOptionLabel = (item) =>
      shift === 'Geral' ? `${item.Nome} (${item.Turno_Vinculado})` : item.Nome;

    const driverSelect = el('driverInput');
    driverSelect.replaceChildren(
      new Option(drivers.length ? 'Selecione o motorista...' : `Nenhum motorista ativo no ${shift}`, ''),
      ...drivers.map((item) => new Option(formatOptionLabel(item), item.Nome))
    );
    if (drivers.some((d) => d.Nome === prevDriver)) driverSelect.value = prevDriver;

    const fleetSelect = el('fleetInput');
    fleetSelect.replaceChildren(
      new Option(fleets.length ? 'Selecione a frota...' : `Nenhuma frota ativa no ${shift}`, ''),
      ...fleets.map((item) => new Option(formatOptionLabel(item), item.Nome))
    );
    if (fleets.some((f) => f.Nome === prevFleet)) fleetSelect.value = prevFleet;

    renderResourceChips('driverChips', drivers, 'driverInput');
    renderResourceChips('fleetChips', fleets, 'fleetInput');

    const hint = el('resourceLockHint');
    if (hint) {
      hint.textContent = (!drivers.length || !fleets.length)
        ? `Atenção: peça ao líder do ${shift} ou ao Admin Geral para cadastrar motoristas e frotas em Configurações.`
        : `Exibindo apenas motoristas (${drivers.length}) e frotas (${fleets.length}) autorizados para ${shift}.`;
    }
  }

  function renderResourceChips(containerId, items, selectId) {
    const container = el(containerId);
    const select = el(selectId);
    container.innerHTML = items.map((item) =>
      `<button class="chip${select.value === item.Nome ? ' selected' : ''}" type="button" data-choice="${escapeHtml(item.Nome)}">${escapeHtml(item.Nome)}</button>`
    ).join('');
    container.onclick = (event) => {
      const button = event.target.closest('[data-choice]');
      if (!button) return;
      select.value = button.dataset.choice;
      container.querySelectorAll('.chip').forEach((chip) => chip.classList.toggle('selected', chip === button));
    };
    select.onchange = () => {
      container.querySelectorAll('.chip').forEach((chip) =>
        chip.classList.toggle('selected', chip.dataset.choice === select.value)
      );
    };
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    session = DB.getSession() || session;
    SESSAO = session;
    if (Array.isArray(snapshot.TB_Apontamentos)) records = snapshot.TB_Apontamentos;
    if (Array.isArray(snapshot.Cadastro_Recursos_Turno)) allResources = snapshot.Cadastro_Recursos_Turno;
    if (Array.isArray(snapshot.Cadastro_Modelos)) applyModels(snapshot.Cadastro_Modelos);
    const hasAuthoritativeLots = !snapshot.offline && Array.isArray(snapshot.Cadastro_Lista_Lotes);
    if (Array.isArray(snapshot.Cadastro_Lista_Lotes)) {
      activeLots = mergeLotCollections(snapshot.Cadastro_Lista_Lotes, activeLots, hasAuthoritativeLots);
      persistLots();
    } else {
      activeLots = readCachedLots();
    }
    if (Array.isArray(snapshot.Progresso_Lotes) && snapshot.Progresso_Lotes.length) {
      lotProgress = mergeSnapshotProgress(snapshot.Progresso_Lotes);
    } else {
      lotProgress = deriveLocalProgress();
    }
    if (hasAuthoritativeLots) {
      const allowedKeys = new Set(activeLots.map((lot) =>
        `${normalizeModelKey(lot.model)}|${String(lot.name || '').trim().toLocaleLowerCase('pt-BR')}`
      ));
      lotProgress = lotProgress.filter((progress) => allowedKeys.has(progressKey(progress)));
    }
    localStorage.setItem('Progresso_Lotes', JSON.stringify(lotProgress));
    if (Array.isArray(snapshot.Config_Usuarios)) adminUsers = visibleUsers(snapshot.Config_Usuarios);
    else if (canOpenAdminViews()) adminUsers = offlineUsers();
    adminDataOffline = Boolean(snapshot.offline);
    renderAccess();
    if (!hasAuthoritativeLots) mergeExistingLots(lotProgress);
    renderOperationResources();
    renderUsers();
    renderResources();
    renderLots();
  }

  function readCachedLots() {
    return mergeLotCollections([], [
      ...safeJson('Cadastro_Lista_Lotes', []),
      ...safeJson(LOCAL_LOTS_KEY, []),
      ...safeJson(LOTS_KEY, [])
    ]);
  }

  function persistAdminCache() {
    const cached = DB.getAdminCache() || {};
    DB.setAdminCache({ ...cached, users: adminUsers, resources: allResources, models: modelList(), records });
  }

  function normalizeModelKey(model) {
    const normalized = String(model || '').trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'SA2' || normalized === 'SA6' || normalized === 'SA2/SA6') return 'SA2/SA6';
    return Object.keys(CATALOG).find((key) => key.toUpperCase() === normalized) || '';
  }

  function modelList() {
    return Object.entries(CATALOG).map(([Modelo_Base, definition]) => ({
      Modelo_Base,
      Componentes: definition.components.map((component) => ({ Nome: component.name, Meta: component.meta })),
      Total_Meta: definition.total
    }));
  }

  function applyModels(models) {
    if (!Array.isArray(models) || !models.length) return;
    const next = cloneCatalog(DEFAULT_CATALOG);
    models.forEach((item) => {
      const key = normalizeModelKey(item.Modelo_Base);
      if (!key || !Array.isArray(item.Componentes) || item.Componentes.length < 3) return;
      const components = item.Componentes.map((component) => ({
        name: String(component.Nome || '').trim(),
        meta: Number(component.Meta)
      }));
      const total = Number(item.Total_Meta);
      if (components.some((component) => !component.name || !Number.isInteger(component.meta) || component.meta < 0)) return;
      if (!Number.isInteger(total) || total <= 0) return;
      next[key] = { total, components };
    });
    CATALOG = next;
  }

  function normalizeProgressMeta(progress) {
    const model = normalizeModelKey(progress.Modelo_Base);
    const definition = CATALOG[model];
    const existingItems = Array.isArray(progress.Itens) ? progress.Itens : [];
    const sentByComponent = new Map(existingItems.map((item) => [
      String(item.Componente || '').trim().toLocaleLowerCase('pt-BR'),
      Number(item.Enviado) || 0
    ]));
    const sentFromItems = existingItems.reduce((sum, item) => sum + (Number(item.Enviado) || 0), 0);
    const sent = Math.max(Number(progress.Total_Enviado) || 0, sentFromItems);
    if (Number(progress.Total_Meta) > 0) {
      const total = Number(progress.Total_Meta);
      const items = existingItems.map((item) => ({
        ...item,
        Saldo: Math.max(0, (Number(item.Meta) || 0) - (Number(item.Enviado) || 0))
      }));
      return {
        ...progress,
        Itens: items,
        Total_Enviado: sent,
        Total_Saldo: Math.max(0, total - sent),
        Concluido: sent >= total
      };
    }
    if (!definition || definition.total <= 0) {
      return { ...progress, Total_Meta: 0, Total_Enviado: sent, Concluido: false };
    }
    const items = definition.components.map((component) => {
      const enviado = sentByComponent.get(component.name.toLocaleLowerCase('pt-BR')) || 0;
      return {
        Componente: component.name,
        Meta: component.meta,
        Enviado: enviado,
        Saldo: Math.max(0, component.meta - enviado)
      };
    });
    return {
      ...progress,
      Itens: items,
      Total_Meta: definition.total,
      Total_Enviado: sent,
      Total_Saldo: Math.max(0, definition.total - sent),
      Concluido: sent >= definition.total
    };
  }

  function progressKey(progress) {
    return `${normalizeModelKey(progress.Modelo_Base)}|${String(progress.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR')}`;
  }

  function mergeSnapshotProgress(remoteRows) {
    const remote = remoteRows.map(normalizeProgressMeta);
    const derived = deriveLocalProgress().map(normalizeProgressMeta);
    const activeKeys = new Set(activeLots.map((lot) =>
      `${normalizeModelKey(lot.model)}|${String(lot.name || '').trim().toLocaleLowerCase('pt-BR')}`
    ));
    const pendingIds = new Set();
    DB.getQueue().forEach((item) => {
      if (Array.isArray(item.itens)) {
        item.itens.forEach((record) => {
          if (record.ID_Apontamento) pendingIds.add(String(record.ID_Apontamento));
        });
      } else if (item.ID_Apontamento) {
        pendingIds.add(String(item.ID_Apontamento));
      }
    });
    const pendingKeys = new Set(records.filter((record) => pendingIds.has(String(record.ID_Apontamento)))
      .map((record) => `${normalizeModelKey(record.Modelo_Base)}|${String(record.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR')}`));
    const derivedByKey = new Map(derived.map((progress) => [progressKey(progress), progress]));
    const merged = remote.map((progress) => {
      const key = progressKey(progress);
      return pendingKeys.has(key) ? derivedByKey.get(key) || progress : progress;
    });
    const mergedKeys = new Set(merged.map(progressKey));
    derived.forEach((progress) => {
      const key = progressKey(progress);
      if (!mergedKeys.has(key) && (activeKeys.has(key) || pendingKeys.has(key))) {
        merged.push(progress);
        mergedKeys.add(key);
      }
    });
    return merged;
  }

  function deriveLocalProgress() {
    const groups = new Map();
    function ensure(name, model, lot = null) {
      const key = `${normalizeModelKey(model)}|${String(name || '').trim().toLocaleLowerCase('pt-BR')}`;
      if (!groups.has(key)) {
        const definition = CATALOG[normalizeModelKey(model)];
        groups.set(key, {
          ID_Lote: lot && lot.id || '',
          Nome_Lote: String(name || '').trim(),
          Modelo_Base: String(model || '').trim(),
          Turno_Vinculado: lot && lot.shift || '',
          Data_Criacao: lot && lot.createdAt || '',
          Itens: (definition?.components || []).map((component) => ({
            Componente: component.name,
            Meta: component.meta,
            Enviado: 0,
            Saldo: component.meta
          })),
          MovidoHoje: false
        });
      }
      return groups.get(key);
    }
    activeLots.forEach((lot) => ensure(lot.name, lot.model, lot));
    records.forEach((record) => {
      const progress = ensure(record.Nome_Lote, record.Modelo_Base);
      if (normalizeDate(record.Data_Ref, record.DataHora) === dateRef()) progress.MovidoHoje = true;
      if (record.Status === 'ESTORNADO') return;
      const component = progress.Itens.find((item) =>
        item.Componente.toLocaleLowerCase('pt-BR') === String(record.Componente || '').toLocaleLowerCase('pt-BR')
      );
      if (component) component.Enviado += Number(record.Qtd_Enviada) || 0;
    });
    return [...groups.values()].map((progress) => {
      progress.Itens.forEach((item) => { item.Saldo = Math.max(0, item.Meta - item.Enviado); });
      progress.Total_Meta = progress.Itens.reduce((sum, item) => sum + item.Meta, 0);
      progress.Total_Enviado = progress.Itens.reduce((sum, item) => sum + item.Enviado, 0);
      progress.Total_Saldo = progress.Itens.reduce((sum, item) => sum + item.Saldo, 0);
      progress.Concluido = progress.Total_Meta > 0 && progress.Total_Enviado >= progress.Total_Meta;
      return progress;
    });
  }

  function currentLot() {
    return activeLots.find((lot) => lot.id === selectedLotId) || null;
  }

  function persistLots() {
    const rows = activeLots.map((lot) => ({
      ID_Lote: lot.id,
      Nome_Lote: lot.name,
      Modelo_Base: lot.model,
      Turno_Vinculado: /^Turno\s+/i.test(lot.shift || '') ? lot.shift : `Turno ${lot.shift || 'A'}`,
      Ativo: 'SIM',
      Data_Criacao: lot.createdAt,
      createdLocalAt: lot.createdLocalAt || 0
    }));
    localStorage.setItem(LOTS_KEY, JSON.stringify(activeLots));
    localStorage.setItem(LOCAL_LOTS_KEY, JSON.stringify(rows));
    localStorage.setItem('Cadastro_Lista_Lotes', JSON.stringify(rows));
  }

  function mergeExistingLots(progressRows) {
    let changed = false;
    progressRows.forEach((progress) => {
      const model = normalizeModelKey(progress.Modelo_Base);
      const name = String(progress.Nome_Lote || '').trim();
      if (!model || !name || progressIsComplete(progress)) return;
      const exists = activeLots.some((lot) =>
        lot.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR') &&
        normalizeModelKey(lot.model) === model
      );
      if (!exists) {
        activeLots.push({
          id: progress.ID_Lote || `SHEET-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}-${model}`,
          name,
          model,
          createdAt: progress.Data_Criacao || new Date().toISOString(),
          shift: progress.Turno_Vinculado || currentShift()
        });
        changed = true;
      }
    });
    if (changed) persistLots();
  }

  function renderLots() {
    const select = el('activeLotSelect');
    const deleteBtn = el('deleteBatchButton');
    const lots = activeLots.filter((lot) => !lotIsComplete(lot));
    if (!lots.length) {
      select.replaceChildren(new Option('Nenhum lote • crie um novo', ''));
      selectedLotId = '';
      localStorage.removeItem(SELECTED_LOT_KEY);
      if (deleteBtn) deleteBtn.disabled = true;
      renderSelectedLot();
      return;
    }
    select.replaceChildren(...lots.map((lot) => new Option(
      `${lot.name}  ·  ${lot.model} · ${lot.shift || 'Lote andando'}`,
      lot.id
    )));
    if (!lots.some((lot) => lot.id === selectedLotId)) selectedLotId = lots[lots.length - 1].id;
    select.value = selectedLotId;
    localStorage.setItem(SELECTED_LOT_KEY, selectedLotId);
    if (deleteBtn) deleteBtn.disabled = false;
    renderSelectedLot();
  }

  function lotProgressFor(lot) {
    if (!lot) return null;
    return lotProgress.find((progress) =>
      String(progress.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR') ===
        String(lot.name || '').trim().toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(progress.Modelo_Base) === normalizeModelKey(lot.model)
    ) || null;
  }

  function progressItemFor(lot, componentName) {
    const progress = lotProgressFor(lot);
    return progress && Array.isArray(progress.Itens)
      ? progress.Itens.find((item) =>
        String(item.Componente || '').trim().toLocaleLowerCase('pt-BR') ===
        String(componentName || '').trim().toLocaleLowerCase('pt-BR')
      )
      : null;
  }

  function sentForLotComponent(lot, componentName) {
    const progressItem = progressItemFor(lot, componentName);
    if (progressItem) return Number(progressItem.Enviado) || 0;
    return records.reduce((sum, record) => {
      const sameLot = String(record.Nome_Lote || '').trim().toLowerCase() === lot.name.trim().toLowerCase();
      const sameModel = normalizeModelKey(record.Modelo_Base) === normalizeModelKey(lot.model);
      const sameComponent = String(record.Componente || '').trim().toLowerCase() === componentName.trim().toLowerCase();
      return sum + (sameLot && sameModel && sameComponent && record.Status !== 'ESTORNADO' ? Number(record.Qtd_Enviada) || 0 : 0);
    }, 0);
  }

  function stagedQuantity(lot, componentName) {
    return tripItems.reduce((sum, item) =>
      sum + (normalizeModelKey(item.Modelo_Base) === normalizeModelKey(lot.model) &&
        item.Nome_Lote.toLocaleLowerCase('pt-BR') === lot.name.toLocaleLowerCase('pt-BR') &&
        item.Componente.toLocaleLowerCase('pt-BR') === componentName.toLocaleLowerCase('pt-BR')
        ? Number(item.Qtd_Enviada) || 0 : 0), 0);
  }

  function componentSaldo(lot, component) {
    return Math.max(0, component.meta - sentForLotComponent(lot, component.name) - stagedQuantity(lot, component.name));
  }

  function lotIsComplete(lot) {
    const progress = lotProgressFor(lot);
    const total = progress && Number(progress.Total_Meta) > 0
      ? Number(progress.Total_Meta)
      : Number(CATALOG[normalizeModelKey(lot.model)]?.total) || 0;
    if (total <= 0) return false;
    const itemSent = progress && Array.isArray(progress.Itens)
      ? progress.Itens.reduce((sum, item) => sum + (Number(item.Enviado) || 0), 0)
      : 0;
    const sent = Math.max(
      progress ? Number(progress.Total_Enviado) || 0 : 0,
      itemSent,
      progress ? 0 : records.reduce((sum, record) => {
        const sameLot = String(record.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR') ===
          String(lot.name || '').trim().toLocaleLowerCase('pt-BR');
        const sameModel = normalizeModelKey(record.Modelo_Base) === normalizeModelKey(lot.model);
        return sum + (sameLot && sameModel && record.Status !== 'ESTORNADO' ? Number(record.Qtd_Enviada) || 0 : 0);
      }, 0)
    );
    return sent >= total;
  }

  function progressIsComplete(progress) {
    const model = normalizeModelKey(progress.Modelo_Base);
    const total = Number(progress.Total_Meta) > 0
      ? Number(progress.Total_Meta)
      : Number(CATALOG[model]?.total) || 0;
    const sentFromItems = Array.isArray(progress.Itens)
      ? progress.Itens.reduce((sum, item) => sum + (Number(item.Enviado) || 0), 0)
      : 0;
    const sent = Math.max(Number(progress.Total_Enviado) || 0, sentFromItems);
    return total > 0 && sent >= total;
  }

  function renderSelectedLot() {
    const lot = currentLot();
    const grid = el('componentGrid');
    if (!lot) {
      el('batchMeta').innerHTML = '<span class="meta-badge">Lote não selecionado</span>';
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Crie um lote para carregar os componentes do catálogo.</div>';
      el('componentMetaLabel').textContent = 'AGUARDANDO LOTE';
      selectedComponent = '';
      updateQuantityDisplay();
      return;
    }
    const definition = CATALOG[normalizeModelKey(lot.model)];
    if (!definition) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Modelo sem catálogo de metas.</div>';
      return;
    }
    el('batchMeta').innerHTML = `
      <span class="meta-badge">MODELO <strong>${escapeHtml(lot.model)}</strong></span>
      <span class="meta-badge">META TOTAL <strong>${definition.total} paletes</strong></span>
      <span class="meta-badge">COMPONENTES <strong>${definition.components.length}</strong></span>`;
    if (!definition.components.some((component) => component.name === selectedComponent) ||
        componentSaldo(lot, definition.components.find((component) => component.name === selectedComponent)) <= 0) {
      const next = definition.components.find((component) => componentSaldo(lot, component) > 0);
      selectedComponent = next ? next.name : definition.components[0].name;
    }
    grid.innerHTML = definition.components.map((component) => `
      <button class="component-button${component.name === selectedComponent ? ' selected' : ''}" type="button" data-component="${escapeHtml(component.name)}" ${componentSaldo(lot, component) <= 0 ? 'disabled' : ''}>
        <span class="component-name">${escapeHtml(component.name)}</span>
        <span class="component-target">META ${component.meta} · ENVIADO ${sentForLotComponent(lot, component.name)} · SALDO ${componentSaldo(lot, component)}</span>
      </button>`).join('');
    renderQuantityControls();
  }

  function renderQuantityControls() {
    const lot = currentLot();
    const definition = lot && CATALOG[normalizeModelKey(lot.model)];
    const component = definition && definition.components.find((item) => item.name === selectedComponent);
    const saldo = lot && component ? componentSaldo(lot, component) : 0;
    el('componentMetaLabel').textContent = component ? `META ${component.meta} · SALDO ${saldo}` : 'SELECIONE O MATERIAL';
    el('metaCompleteButton').textContent = `✓ COMPLETAR SALDO (${saldo})`;
    el('metaCompleteButton').disabled = saldo <= 0;
    updateQuantityDisplay();
  }

  function updateQuantityDisplay() {
    el('quantityInput').value = String(quantity);
    const lot = currentLot();
    const definition = lot && CATALOG[normalizeModelKey(lot.model)];
    const component = definition && definition.components.find((item) => item.name === selectedComponent);
    const saldo = lot && component ? componentSaldo(lot, component) : 0;
    const warning = el('quantityWarning');
    const exceeds = quantity > saldo;
    warning.textContent = exceeds ? `Quantidade excede o saldo pendente de ${saldo} paletes.` : '';
    warning.classList.toggle('visible', exceeds);
    el('addTripItemButton').disabled = !lot || !component || quantity <= 0 || exceeds;
  }

  function renderPendingLots() {
    const container = el('pendingLotsList');
    const pending = lotProgress.filter((progress) => !progressIsComplete(progress));
    if (!pending.length) {
      container.innerHTML = '<div class="empty-state">Nenhum lote pendente no pátio. Os lotes concluídos foram baixados automaticamente.</div>';
      return;
    }
    container.innerHTML = pending.map((progress, progressIndex) => {
      const lot = activeLots.find((candidate) =>
        candidate.name.toLocaleLowerCase('pt-BR') === String(progress.Nome_Lote || '').toLocaleLowerCase('pt-BR') &&
        normalizeModelKey(candidate.model) === normalizeModelKey(progress.Modelo_Base)
      ) || {
        id: progress.ID_Lote || `SHEET-${progressIndex}`,
        name: progress.Nome_Lote,
        model: progress.Modelo_Base,
        shift: progress.Turno_Vinculado
      };
      const components = Array.isArray(progress.Itens) ? progress.Itens.filter((item) => Number(item.Saldo) > 0) : [];
      return `<article class="pending-lot">
        <h3 class="pending-lot-title">${escapeHtml(progress.Nome_Lote)} · ${escapeHtml(progress.Modelo_Base)}${progress.Turno_Vinculado ? ` · ${escapeHtml(progress.Turno_Vinculado)}` : ''}</h3>
        ${components.map((item) => {
          const meta = Number(item.Meta) || 0;
          const sent = Number(item.Enviado) || 0;
          const balance = Number(item.Saldo) || 0;
          const percent = meta > 0 ? Math.min(100, (sent / meta) * 100) : 0;
          return `<button class="pending-component" type="button" data-progress-index="${progressIndex}" data-component="${escapeHtml(item.Componente)}">
            <span class="pending-component-meta"><span>${escapeHtml(item.Componente)}: ${sent}/${meta} • Faltam ${balance}</span><span>Enviar ${Math.max(0, balance - stagedQuantity(lot, item.Componente))}</span></span>
            <span class="pending-track"><span style="width:${percent}%"></span></span>
          </button>`;
        }).join('')}
      </article>`;
    }).join('');
  }

  function renderTripItems() {
    const container = el('tripItemsList');
    const total = tripItems.reduce((sum, item) => sum + (Number(item.Qtd_Enviada) || 0), 0);
    el('tripSummary').textContent = `${tripItems.length} ${tripItems.length === 1 ? 'item' : 'itens'} | ${total} paletes`;
    if (!tripItems.length) {
      container.innerHTML = '<div class="empty-state">Adicione um ou mais materiais para montar a carga.</div>';
      return;
    }
    container.innerHTML = tripItems.map((item, index) => `
      <article class="trip-item">
        <div>
          <h4 class="trip-item-title">${escapeHtml(item.Nome_Lote)} · ${escapeHtml(item.Componente)}</h4>
          <p class="trip-item-meta">${escapeHtml(item.Modelo_Base)} · ${Number(item.Qtd_Enviada)} paletes</p>
        </div>
        <button class="button button-danger remove-trip-item" type="button" data-index="${index}" aria-label="Remover item da viagem">Remover</button>
      </article>`).join('');
  }

  function selectPendingComponent(event) {
    const button = event.target.closest('.pending-component');
    if (!button) return;
    const progress = lotProgress[Number(button.dataset.progressIndex)];
    if (!progress) return;
    let lot = activeLots.find((candidate) =>
      candidate.name.toLocaleLowerCase('pt-BR') === String(progress.Nome_Lote || '').toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(candidate.model) === normalizeModelKey(progress.Modelo_Base)
    );
    if (!lot) {
      lot = {
        id: progress.ID_Lote || `SHEET-${lotProgress.indexOf(progress)}`,
        name: progress.Nome_Lote,
        model: progress.Modelo_Base,
        createdAt: progress.Data_Criacao || new Date().toISOString(),
        shift: progress.Turno_Vinculado || currentShift()
      };
      activeLots.push(lot);
      persistLots();
    }
    selectedLotId = lot.id;
    selectedComponent = button.dataset.component;
    const component = CATALOG[normalizeModelKey(lot.model)].components.find((item) => item.name === selectedComponent);
    quantity = component ? componentSaldo(lot, component) : 0;
    renderLots();
    el('activeLotSelect').value = selectedLotId;
    updateQuantityDisplay();
  }

  function dateRef(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function nowParts() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return {
      DataHora: date.toISOString(),
      Data_Ref: dateRef(date),
      Hora_Ref: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    };
  }

  function formatTime(record) {
    const time = String(record.Hora_Ref || '');
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return time.length === 5 ? `${time}:00` : time.slice(0, 8);
    const date = new Date(record.DataHora);
    return Number.isNaN(date.getTime()) ? '--:--:--' :
      [date.getHours(), date.getMinutes(), date.getSeconds()].map((value) => String(value).padStart(2, '0')).join(':');
  }

  function formatDate(record) {
    const match = String(record.Data_Ref || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;
    const date = new Date(record.DataHora || record.Data_Ref);
    if (Number.isNaN(date.getTime())) return '--/--/----';
    return [date.getDate(), date.getMonth() + 1, date.getFullYear()]
      .map((value, index) => index < 2 ? String(value).padStart(2, '0') : String(value)).join('/');
  }

  function reportText(items, driver, fleet) {
    const first = items[0] || {};
    const total = items.reduce((sum, item) => sum + (Number(item.Qtd_Enviada) || 0), 0);
    const lots = [...new Set(items.map((item) => {
      const name = String(item.Nome_Lote || '').trim();
      const model = String(item.Modelo_Base || '').trim();
      return name ? (model ? `${name} (${model})` : name) : '';
    }).filter(Boolean))];
    return [
      '📦 RELATÓRIO DE TRANSPORTE DE MATERIAL',
      '',
      ...(lots.length ? [`🏷️ Lote: ${lots.join(' / ')}`] : []),
      `👤 Motorista: ${driver || first.Motorista || ''}`,
      `🚛 Frota: ${fleet || first.Frota || ''}`,
      '📋 Materiais da Carga:',
      ...items.map((item) => `• ${item.Nome_Lote || ''} — ${item.Componente || ''} (${Number(item.Qtd_Enviada) || 0} paletes)`),
      `📦 Total Geral: ${total} paletes`,
      `🕗 Horário: ${formatTime(first)}`,
      `📅 Data: ${formatDate(first)}`
    ].join('\n');
  }

  function copyTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_) {}
    textarea.remove();
    return copied;
  }

  function copyText(text) {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return Promise.resolve(copyTextFallback(text));
    try {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => copyTextFallback(text));
    } catch (_) {
      return Promise.resolve(copyTextFallback(text));
    }
  }

  function downloadFile(file, filename) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function shareTripReport(items, driver, fleet, file = null) {
    if (!Array.isArray(items) || !items.length) throw new Error('Adicione ao menos um material para compartilhar a viagem.');
    const text = reportText(items, driver, fleet);
    const copied = copyText(text);
    if (file) {
      if (!navigator.share || !navigator.canShare || !navigator.canShare({ files: [file] })) {
        await copied;
        showToast('Este navegador não permite compartilhar arquivos. A foto foi baixada para anexar ao relatório.');
        downloadFile(file, `evidencia-${items[0].ID_Viagem || 'byd'}.jpg`);
        return;
      }
      try {
        const [copySucceeded] = await Promise.all([copied, navigator.share({ files: [file], text })]);
        if (!copySucceeded) showToast('Relatório compartilhado. Não foi possível copiar o texto.');
      } catch (error) {
        if (error.name !== 'AbortError') showToast(`Não foi possível compartilhar a evidência: ${error.message}`);
      }
      return;
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    if (!await copied) showToast('WhatsApp aberto; a cópia automática falhou neste navegador.');
  }

  async function shareReport(record, file = null) {
    const items = record.ID_Viagem
      ? records.filter((candidate) => candidate.ID_Viagem === record.ID_Viagem && candidate.Status !== 'ESTORNADO')
      : [record];
    return shareTripReport(items.length ? items : [record], record.Motorista, record.Frota, file);
  }

  function normalizeDate(dateValue, dateTimeValue) {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const date = new Date(dateTimeValue || dateValue);
    return Number.isNaN(date.getTime()) ? '' : dateRef(date);
  }

  function renderHistory() {
    const today = dateRef();
    const history = records.filter((record) =>
      normalizeDate(record.Data_Ref, record.DataHora) === today &&
      (currentShift() === 'Geral' || turnKey(record.Turno) === turnKey(currentShift()))
    ).sort((a, b) => String(b.DataHora || '').localeCompare(String(a.DataHora || '')));
    const container = el('historyList');
    if (!history.length) {
      container.innerHTML = '<div class="empty-state">Nenhum lançamento registrado neste turno hoje.</div>';
      return;
    }
    const tripCounts = new Map();
    history.forEach((record) => {
      if (record.ID_Viagem) tripCounts.set(record.ID_Viagem, (tripCounts.get(record.ID_Viagem) || 0) + 1);
    });
    container.innerHTML = history.map((record) => {
      const voided = record.Status === 'ESTORNADO';
      const tripLabel = record.ID_Viagem
        ? `<p class="history-sub"><span class="status-tag" style="background:rgba(56,189,248,.12);color:#7DD3FC">VIAGEM ${escapeHtml(String(record.ID_Viagem).slice(-8))} · ${tripCounts.get(record.ID_Viagem)} item(ns)</span></p>`
        : '';
      return `<article class="history-item">
        <div class="history-top">
          <div>
            <h3 class="history-name">${escapeHtml(record.Nome_Lote || 'Lote')} · ${escapeHtml(record.Componente || 'Material')}</h3>
            ${tripLabel}
            <p class="history-sub">${escapeHtml(record.Modelo_Base || '')} · ${escapeHtml(record.Motorista || 'Motorista não informado')} · ${escapeHtml(record.Frota || 'Frota não informada')} · ${escapeHtml(formatTime(record))}</p>
          </div>
          <div style="text-align:right">
            <span class="status-tag ${voided ? 'void' : 'ok'}">${voided ? 'ESTORNADO' : 'REGISTRADO'}</span>
            <div class="history-qty" style="margin-top:5px">${escapeHtml(String(record.Qtd_Enviada ?? 0))} paletes</div>
          </div>
        </div>
        ${voided && record.Motivo_Estorno ? `<p class="history-sub">Motivo do estorno: ${escapeHtml(record.Motivo_Estorno)}</p>` : ''}
        <div class="history-actions">
          <button class="button button-cyan resend-button" type="button" data-id="${escapeHtml(record.ID_Apontamento)}">📲 Reenviar WhatsApp</button>
          <button class="button button-danger reverse-button" type="button" data-id="${escapeHtml(record.ID_Apontamento)}" ${voided ? 'disabled' : ''}>Estornar</button>
          <button class="button edit-record-button" type="button" data-id="${escapeHtml(record.ID_Apontamento)}">✏️ Editar</button>
        </div>
      </article>`;
    }).join('');
  }

  function updateSyncStatus() {
    const status = el('syncStatus');
    let pending = [];
    try { pending = DB.getQueue(); } catch (_) {}
    status.classList.toggle('offline', !navigator.onLine);
    status.classList.toggle('pending', navigator.onLine && pending.length > 0);
    if (!navigator.onLine) {
      status.textContent = `● Offline · ${pending.length} na fila`;
    } else if (pending.length) {
      status.textContent = `● Enviando ${pending.length} pendência(s)...`;
    } else if (DB.isRealtimeConnected()) {
      status.textContent = '⚡ Tempo Real (<0,3s)';
    } else {
      status.textContent = '● Sincronizado';
    }
  }

  function setLastRefreshTime(date = new Date()) {
    const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map((value) => String(value).padStart(2, '0')).join(':');
    el('lastRefreshLabel').textContent = `Atualizado às ${time}`;
  }

  async function silentSync() {
    if (!session || silentSyncPending || !navigator.onLine || document.visibilityState === 'hidden') return;
    silentSyncPending = true;
    try {
      const snapshot = await DB.sincronizarLeitura();
      if (snapshot && !snapshot.offline) {
        applySnapshot(snapshot);
        refreshViews();
        setLastRefreshTime();
      }
    } catch (error) {
      if (error.code === 'AUTH_REQUIRED') goToLoginIfUnauthorized(error);
    } finally {
      silentSyncPending = false;
    }
  }

  function startRealtimeAndPolling() {
    DB.subscribeRealtime(
      (snapshot) => {
        applySnapshot(snapshot);
        refreshViews();
        setLastRefreshTime();
      },
      () => {
        updateSyncStatus();
      }
    );

    if (pollingTimer) clearInterval(pollingTimer);
    if (!session) return;
    pollingTimer = setInterval(() => {
      if (!DB.isRealtimeConnected()) silentSync();
    }, 6000);
  }

  function cockpitContext() {
    const gov = governanceForShift(currentShift());
    return {
      operator: currentOperator(),
      shift: currentShift(),
      profile: profile(),
      coordinator: gov.coordinator,
      leadership: gov.leadership,
      activeLots,
      progressLots: lotProgress,
      models: modelList()
    };
  }

  function refreshViews() {
    renderHistory();
    renderSelectedLot();
    renderPendingLots();
    renderTripItems();
    updateSyncStatus();
    if (window.Cockpit && typeof Cockpit.update === 'function') {
      Cockpit.update(records, cockpitContext());
    }
  }

  async function compressPhoto(file) {
    const objectUrl = URL.createObjectURL(file);
    let image;
    try {
      if ('createImageBitmap' in window) {
        try { image = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
        catch (_) { image = null; }
      }
      if (!image) {
        image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
          element.src = objectUrl;
        });
      }
      const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas indisponível para comprimir a evidência.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
      if (!blob) throw new Error('Falha ao comprimir a evidência fotográfica.');
      return new File([blob], `evidencia-byd-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
      if (image && typeof image.close === 'function') image.close();
      URL.revokeObjectURL(objectUrl);
    }
  }

  function clearEvidence() {
    evidenceFile = null;
    el('photoInput').value = '';
    el('photoPreview').removeAttribute('src');
    el('photoPreview').classList.remove('visible');
    el('removePhotoButton').hidden = true;
    el('photoHint').textContent = 'Foto comprimida até 1024 px';
    if (evidenceObjectUrl) URL.revokeObjectURL(evidenceObjectUrl);
    evidenceObjectUrl = '';
  }

  function addTripItem() {
    const lot = currentLot();
    const definition = lot && CATALOG[normalizeModelKey(lot.model)];
    const component = definition && definition.components.find((item) => item.name === selectedComponent);
    if (!currentOperator()) throw new Error('Sessão inválida. Entre novamente.');
    if (currentShift() === 'Geral') throw new Error('Selecione um turno específico antes de gravar o lançamento.');
    if (!lot) throw new Error('Crie ou selecione um lote ativo.');
    if (!component) throw new Error('Selecione um componente do catálogo.');
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Informe uma quantidade de paletes maior que zero.');
    const saldo = componentSaldo(lot, component);
    if (quantity > saldo) throw new Error(`Quantidade excede o saldo pendente de ${saldo} paletes.`);
    tripItems.push({
      Nome_Lote: lot.name,
      Modelo_Base: lot.model,
      Componente: component.name,
      Qtd_Enviada: quantity
    });
    quantity = 0;
    renderSelectedLot();
    renderPendingLots();
    renderTripItems();
  }

  function createTripPayload() {
    if (!tripItems.length) throw new Error('Adicione ao menos um material à viagem.');
    if (currentShift() === 'Geral') throw new Error('Selecione um turno específico antes de gravar a viagem.');
    const driver = el('driverInput').value.trim();
    const fleet = el('fleetInput').value.trim();
    const allowedDrivers = allowedResourcesForShift('MOTORISTA', currentShift()).map((d) => d.Nome);
    const allowedFleets = allowedResourcesForShift('FROTA', currentShift()).map((f) => f.Nome);
    if (!driver || !allowedDrivers.includes(driver)) {
      throw new Error('Selecione um motorista cadastrado para este turno.');
    }
    if (!fleet || !allowedFleets.includes(fleet)) {
      throw new Error('Selecione uma frota cadastrada para este turno.');
    }
    const totals = new Map();
    tripItems.forEach((item) => {
      const key = `${normalizeModelKey(item.Modelo_Base)}|${item.Nome_Lote.toLocaleLowerCase('pt-BR')}|${item.Componente.toLocaleLowerCase('pt-BR')}`;
      totals.set(key, (totals.get(key) || 0) + Number(item.Qtd_Enviada));
    });
    for (const [key, total] of totals) {
      const [model, lotName, componentName] = key.split('|');
      const lot = activeLots.find((candidate) =>
        normalizeModelKey(candidate.model) === model &&
        candidate.name.toLocaleLowerCase('pt-BR') === lotName
      );
      const component = CATALOG[model]?.components.find((item) => item.name.toLocaleLowerCase('pt-BR') === componentName);
      if (!lot || !component || total > component.meta - sentForLotComponent(lot, component.name)) {
        throw new Error(`O saldo de ${lotName} · ${componentName} mudou. Atualize os dados e revise a viagem.`);
      }
    }
    const now = nowParts();
    const tripId = `TR-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      action: 'criar_viagem',
      ID_Viagem: tripId,
      itens: tripItems.map((item) => ({
        ID_Apontamento: `AP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        ID_Viagem: tripId,
        DataHora: now.DataHora,
        Data_Ref: now.Data_Ref,
        Hora_Ref: now.Hora_Ref,
        Operador: currentOperator(),
        Turno: currentShift(),
        Nome_Lote: item.Nome_Lote,
        Modelo_Base: item.Modelo_Base,
        Componente: item.Componente,
        Qtd_Enviada: Number(item.Qtd_Enviada),
        Motorista: driver,
        Frota: fleet,
        Status: 'ENTREGUE',
        Motivo_Estorno: ''
      }))
    };
  }

  function upsertProgressForRecord(record, delta) {
    let progress = lotProgress.find((item) =>
      String(item.Nome_Lote || '').toLocaleLowerCase('pt-BR') === String(record.Nome_Lote || '').toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(item.Modelo_Base) === normalizeModelKey(record.Modelo_Base)
    );
    if (!progress) {
      const lot = activeLots.find((item) =>
        item.name.toLocaleLowerCase('pt-BR') === String(record.Nome_Lote || '').toLocaleLowerCase('pt-BR') &&
        normalizeModelKey(item.model) === normalizeModelKey(record.Modelo_Base)
      );
      const definition = CATALOG[normalizeModelKey(record.Modelo_Base)];
      if (!definition) return;
      progress = {
        ID_Lote: lot && lot.id || '',
        Nome_Lote: record.Nome_Lote,
        Modelo_Base: record.Modelo_Base,
        Turno_Vinculado: lot && lot.shift || record.Turno,
        Data_Criacao: lot && lot.createdAt || record.DataHora,
        Itens: definition.components.map((component) => ({
          Componente: component.name,
          Meta: component.meta,
          Enviado: 0,
          Saldo: component.meta
        })),
        MovidoHoje: true
      };
      lotProgress.push(progress);
    }
    const component = progress.Itens.find((item) =>
      item.Componente.toLocaleLowerCase('pt-BR') === String(record.Componente || '').toLocaleLowerCase('pt-BR')
    );
    if (!component) return;
    component.Enviado = Math.max(0, (Number(component.Enviado) || 0) + delta);
    component.Saldo = Math.max(0, Number(component.Meta) - component.Enviado);
    progress.MovidoHoje = true;
    progress.Total_Meta = progress.Itens.reduce((sum, item) => sum + Number(item.Meta || 0), 0);
    progress.Total_Enviado = progress.Itens.reduce((sum, item) => sum + Number(item.Enviado || 0), 0);
    progress.Total_Saldo = progress.Itens.reduce((sum, item) => sum + Number(item.Saldo || 0), 0);
    progress.Concluido = progress.Total_Meta > 0 && progress.Total_Enviado >= progress.Total_Meta;
    localStorage.setItem('Progresso_Lotes', JSON.stringify(lotProgress));
  }

  function addRecordToCache(record) {
    records = [record, ...records.filter((item) => item.ID_Apontamento !== record.ID_Apontamento)];
    DB.setCache(records);
  }

  function queued(payload) {
    return DB.getQueue().some((item) => {
      if (item.action !== payload.action) return false;
      if (payload.ID_Apontamento) return item.ID_Apontamento === payload.ID_Apontamento;
      if (payload.ID_Lote) return item.ID_Lote === payload.ID_Lote;
      if (payload.ID_Viagem) return item.ID_Viagem === payload.ID_Viagem;
      if (payload.Modelo_Base) return item.Modelo_Base === payload.Modelo_Base;
      return item.Matricula_Original === payload.Matricula_Original &&
        item.Matricula === payload.Matricula;
    });
  }

  async function saveTrip() {
    const button = el('saveRecordButton');
    button.disabled = true;
    try {
      const payload = createTripPayload();
      try {
        await DB.sendOrQueue(payload);
        showToast('⚡ Viagem gravada e sincronizada em tempo real!');
      } catch (error) {
        if (!queued(payload)) {
          if (goToLoginIfUnauthorized(error)) return;
          throw error;
        }
        showToast('Sem conexão: viagem salva na fila do celular.');
      }
      payload.itens.forEach((record) => {
        addRecordToCache(record);
        upsertProgressForRecord(record, Number(record.Qtd_Enviada));
      });
      lastSavedTrip = payload.itens;
      tripItems = [];
      quantity = 0;
      renderLots();
      refreshViews();
      setLastRefreshTime();
    } catch (error) {
      showToast(error.message || 'Não foi possível gravar a viagem.', 5000);
    } finally {
      button.disabled = false;
    }
  }

  async function syncNow() {
    const button = el('syncButton');
    button.disabled = true;
    try {
      const result = await DB.syncAll();
      if (result.snapshot) applySnapshot(result.snapshot);
      else if (Array.isArray(result.records)) records = result.records;
      session = DB.getSession() || session;
      SESSAO = session;
      loadGovernanceConfig();
      fillGovernanceForm();
      mergeExistingLots(lotProgress);
      renderLots();
      DB.setCache(records);
      refreshViews();
      if (result.snapshot && !result.snapshot.offline) setLastRefreshTime();
      showToast(`Sincronizado! ${result.sent || 0} pendência(s) enviada(s).`);
    } catch (error) {
      if (!goToLoginIfUnauthorized(error)) showToast(error.message || 'Falha ao sincronizar.', 5000);
    } finally {
      button.disabled = false;
      updateSyncStatus();
    }
  }

  function loadGovernanceConfig() {
    const defaults = cloneDefaultGovernance();
    const stored = safeJson(UI_CONFIG_KEY, {});
    const shifts = cloneDefaultGovernance();

    if (stored && typeof stored.shifts === 'object' && stored.shifts !== null) {
      Object.keys(shifts).forEach((shiftKey) => {
        if (stored.shifts[shiftKey]) {
          shifts[shiftKey] = {
            coordinator: String(stored.shifts[shiftKey].coordinator ?? defaults[shiftKey].coordinator),
            leadership: String(stored.shifts[shiftKey].leadership ?? defaults[shiftKey].leadership)
          };
        }
      });
    } else if (stored && (stored.coordinator || stored.leadership)) {
      shifts['Turno B'] = {
        coordinator: String(stored.coordinator || defaults['Turno B'].coordinator),
        leadership: String(stored.leadership || defaults['Turno B'].leadership)
      };
      shifts.Geral = { ...shifts['Turno B'] };
    }

    uiConfig = { shifts };
  }

  function persistUiConfig() {
    if (isGeneralAdmin()) {
      const current = safeJson(UI_CONFIG_KEY, {});
      localStorage.setItem(UI_CONFIG_KEY, JSON.stringify({
        ...current,
        shifts: uiConfig.shifts
      }));
    }
  }

  function ensureGovernanceShiftSelector() {
    let shiftSelect = el('governanceShiftSelect');
    if (shiftSelect) return shiftSelect;

    const coordInput = el('settingsCoordinator');
    const coordLabel = coordInput ? coordInput.closest('label') : null;
    if (!coordLabel || !coordLabel.parentNode) return null;

    const wrapper = document.createElement('label');
    wrapper.innerHTML = `
      <span class="field-label">Turno da Liderança</span>
      <select id="governanceShiftSelect" class="control">
        <option value="Turno A">Turno A</option>
        <option value="Turno B">Turno B</option>
        <option value="Turno C">Turno C</option>
        <option value="Geral">Geral (Visão Consolidada)</option>
      </select>`;
    coordLabel.parentNode.insertBefore(wrapper, coordLabel);

    shiftSelect = el('governanceShiftSelect');
    shiftSelect.addEventListener('change', () => {
      const selected = normalizeShiftLabel(shiftSelect.value);
      const gov = governanceForShift(selected);
      el('settingsCoordinator').value = gov.coordinator;
      el('settingsLeadership').value = gov.leadership;
    });
    return shiftSelect;
  }

  function fillGovernanceForm(targetShift = null) {
    el('settingsApiUrl').value = DB.getApiUrl();
    const shiftSelect = ensureGovernanceShiftSelector();
    const activeShiftKey = normalizeShiftLabel(
      targetShift || (shiftSelect && shiftSelect.value) || currentShift()
    );
    if (shiftSelect) {
      shiftSelect.value = activeShiftKey;
      shiftSelect.disabled = !isGeneralAdmin();
    }
    const gov = governanceForShift(activeShiftKey);
    el('settingsCoordinator').value = gov.coordinator;
    el('settingsLeadership').value = gov.leadership;
  }

  async function testConnection() {
    if (!isGeneralAdmin()) {
      showToast('Somente ADMIN_GERAL pode testar a conexão.');
      return;
    }
    const button = el('testConnectionButton');
    button.disabled = true;
    try {
      const result = await DB.testConnection();
      showToast(result.message || 'Conexão autenticada com sucesso.', 4500);
    } catch (error) {
      if (!goToLoginIfUnauthorized(error)) showToast(error.message || 'Falha ao testar conexão.', 5000);
    } finally {
      button.disabled = false;
    }
  }

  function saveGovernance(event) {
    event.preventDefault();
    if (!isGeneralAdmin()) return;
    const currentUrl = DB.getApiUrl();
    const requestedUrl = el('settingsApiUrl').value.trim();
    const shiftSelect = ensureGovernanceShiftSelector();
    const targetShift = normalizeShiftLabel(shiftSelect ? shiftSelect.value : currentShift());

    if (!uiConfig.shifts) uiConfig.shifts = cloneDefaultGovernance();
    uiConfig.shifts[targetShift] = {
      coordinator: el('settingsCoordinator').value.trim(),
      leadership: el('settingsLeadership').value.trim()
    };
    persistUiConfig();

    if (requestedUrl !== currentUrl) {
      try {
        DB.setApiUrl(requestedUrl);
      } catch (error) {
        showToast(error.message, 5000);
        return;
      }
      showToast(requestedUrl
        ? `Governança do ${targetShift} e URL atualizadas.`
        : `Governança do ${targetShift} salva e espelho removido.`);
    } else {
      showToast(`Liderança do ${targetShift} salva com sucesso.`);
    }
    refreshViews();
  }

  function modelComponents(model) {
    return CATALOG[normalizeModelKey(model)]?.components || [];
  }

  function renderModelSelect(selected = '') {
    const select = el('settingsModelSelect');
    const current = selected || select.value || Object.keys(CATALOG)[0];
    select.replaceChildren(...Object.keys(CATALOG).map((model) => new Option(model, model)));
    select.value = CATALOG[current] ? current : Object.keys(CATALOG)[0];
    loadModelEditor();
  }

  function loadModelEditor() {
    const model = el('settingsModelSelect').value;
    const definition = CATALOG[model];
    const container = el('modelComponentsEditor');
    const slots = [0, 1, 2, 3].map((index) => {
      const existing = definition.components[index] || { name: '', meta: 0 };
      const isOptional = index === 3;
      return `
      <div class="model-editor-grid">
        <label>
          <span class="field-label">Componente ${index + 1}${isOptional ? ' (Opcional)' : ''}</span>
          <input class="control model-component-name" data-slot="${index}" maxlength="100" ${isOptional ? 'placeholder="Deixe vazio se usar 3"' : 'required'} value="${escapeHtml(existing.name)}">
        </label>
        <label>
          <span class="field-label">Meta</span>
          <input class="control model-component-meta" data-slot="${index}" type="number" min="0" step="1" ${isOptional ? '' : 'required'} value="${existing.meta}">
        </label>
      </div>`;
    }).join('');

    container.innerHTML = slots + `
      <p class="muted-small">O Componente 4 é opcional: preencha nome e meta apenas nos modelos que precisarem de 4 materiais.</p>
      <label>
        <span class="field-label">Total_Meta</span>
        <input id="modelTotalInput" class="control" type="number" min="0" step="1" value="${definition.total}" readonly>
      </label>`;

    container.querySelectorAll('.model-component-meta, .model-component-name').forEach((input) =>
      input.addEventListener('input', updateModelTotal)
    );
    updateModelTotal();
  }

  function updateModelTotal() {
    const names = [...document.querySelectorAll('.model-component-name')];
    const metas = [...document.querySelectorAll('.model-component-meta')];
    const total = metas.reduce((sum, input, index) => {
      const value = Number(input.value) || 0;
      if (index === 3 && !names[index]?.value.trim() && value === 0) return sum;
      return sum + value;
    }, 0);
    el('modelTotalInput').value = String(total);
  }

  function captureModelForm() {
    const names = [...document.querySelectorAll('.model-component-name')];
    const metas = [...document.querySelectorAll('.model-component-meta')];
    const components = [];
    for (let index = 0; index < names.length; index++) {
      const nome = names[index].value.trim();
      const metaRaw = metas[index].value.trim();
      const meta = metaRaw === '' ? 0 : Number(metaRaw);
      if (index === 3 && !nome && meta === 0) continue;
      components.push({ Nome: nome, Meta: meta, slot: index + 1 });
    }
    return {
      Modelo_Base: el('settingsModelSelect').value,
      Componentes: components,
      Total_Meta: components.reduce((sum, item) => sum + (Number(item.Meta) || 0), 0)
    };
  }

  async function saveModel() {
    if (!isGeneralAdmin()) {
      showToast('Somente ADMIN_GERAL pode alterar materiais e metas.');
      return;
    }
    const captured = captureModelForm();
    if (captured.Componentes.length < 3 || captured.Componentes.some((item) => !item.Nome || !Number.isInteger(item.Meta) || item.Meta < 0)) {
      showToast('Informe o nome e metas inteiras válidas (preencha o nome do Componente 4 ou zere a meta dele).', 4500);
      return;
    }
    const cleanComponents = captured.Componentes.map(({ Nome, Meta }) => ({ Nome, Meta }));
    const payload = {
      action: 'salvar_modelo',
      Modelo_Base: captured.Modelo_Base,
      Componentes: cleanComponents,
      Total_Meta: captured.Total_Meta
    };
    const button = el('saveModelButton');
    button.disabled = true;
    try {
      try {
        await DB.sendOrQueue(payload);
        showToast('⚡ Modelo e metas atualizados em tempo real!');
      } catch (error) {
        if (!queued(payload)) {
          if (goToLoginIfUnauthorized(error)) return;
          throw error;
        }
        showToast('Modelo salvo na fila offline.');
      }
      const updated = {
        Modelo_Base: payload.Modelo_Base,
        Componentes: payload.Componentes,
        Total_Meta: payload.Total_Meta
      };
      applyModels([updated, ...modelList().filter((item) => item.Modelo_Base !== updated.Modelo_Base)]);
      lotProgress = deriveLocalProgress();
      localStorage.setItem('Progresso_Lotes', JSON.stringify(lotProgress));
      renderModelSelect(updated.Modelo_Base);
      persistAdminCache();
      renderSelectedLot();
      refreshViews();
    } catch (error) {
      showToast(error.message || 'Não foi possível salvar o modelo.', 5000);
    } finally {
      button.disabled = false;
    }
  }

  // =========================================================================
  // GESTÃO DE EQUIPE POR TURNO (USUARIOS)
  // =========================================================================
  function renderUsers() {
    const container = el('usersList');
    const status = el('userManagementStatus');
    const source = DB.getCachedUsers();
    const list = visibleUsers(source);
    adminUsers = list;
    status.textContent = isLeader()
      ? `Mostrando ${list.length} operador(es) vinculados ao ${linkedShift()}.`
      : `Mostrando ${list.length} usuário(s) cadastrados.`;
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">Nenhum funcionário encontrado para este filtro/turno.</div>';
      return;
    }
    container.innerHTML = list.slice().sort((a, b) =>
      String(a.Nome).localeCompare(String(b.Nome), 'pt-BR')
    ).map((user) => {
      const self = user.Matricula === session.Matricula;
      const active = String(user.Ativo).toUpperCase() === 'SIM';
      const role = String(user.Perfil).toUpperCase();
      const isAdminRole = role !== 'OPERADOR';
      return `<article class="user-row">
        <div>
          <div class="user-name">${escapeHtml(user.Nome)}${self ? ' (você)' : ''}</div>
          <div class="user-detail">Matrícula ${escapeHtml(user.Matricula)}</div>
        </div>
        <span class="role-tag${isAdminRole ? ' admin' : ''}">${escapeHtml(role)}</span>
        <span class="user-detail">${escapeHtml(user.Turno_Vinculado)}</span>
        <span class="user-status${active ? '' : ' inactive'}">${active ? 'ATIVO' : 'BLOQUEADO'}</span>
        <div class="user-actions">
          <button class="button edit-user" type="button" data-id="${escapeHtml(user.Matricula)}">✏️ Editar</button>
        </div>
      </article>`;
    }).join('');
  }

  function applyUserFormPermissions() {
    const role = el('newUserRole');
    const turn = el('newUserShift');
    if (isLeader()) {
      role.value = 'OPERADOR';
      turn.value = linkedShift();
      role.disabled = true;
      turn.disabled = true;
    } else {
      role.disabled = !isGeneralAdmin();
      turn.disabled = !isGeneralAdmin();
    }
  }

  function handleUserRoleChange() {
    if (!isGeneralAdmin()) return;
    if (el('newUserRole').value === 'ADMIN_GERAL') {
      el('newUserShift').value = 'TODOS';
    } else if (el('newUserShift').value === 'TODOS') {
      el('newUserShift').value = currentShift() === 'Geral' ? 'Turno A' : currentShift();
    }
  }

  function resetUserForm() {
    editingUserOriginal = '';
    el('userOriginalMatricula').value = '';
    el('userForm').reset();
    el('newUserRole').value = 'OPERADOR';
    el('newUserShift').value = isLeader()
      ? linkedShift()
      : (currentShift() === 'Geral' ? 'Turno A' : currentShift());
    el('newUserActive').value = 'SIM';
    el('createUserButton').textContent = '＋ Cadastrar funcionário';
    el('cancelUserEditButton').hidden = true;
    applyUserFormPermissions();
  }

  function openUserEdit(matricula) {
    const user = adminUsers.find((item) => String(item.Matricula) === String(matricula));
    if (!user) return;
    editingUserOriginal = String(user.Matricula);
    el('userOriginalMatricula').value = editingUserOriginal;
    el('newUserMatricula').value = user.Matricula;
    el('newUserName').value = user.Nome;
    el('newUserPin').value = String(user.PIN || '');
    el('newUserRole').value = user.Perfil;
    el('newUserShift').value = user.Turno_Vinculado;
    el('newUserActive').value = user.Ativo;
    el('createUserButton').textContent = 'Salvar alterações';
    el('cancelUserEditButton').hidden = false;
    applyUserFormPermissions();
    el('newUserName').focus();
  }

  function updateLocalUser(payload) {
    const original = String(payload.Matricula_Original || '');
    const updated = {
      Matricula: String(payload.Matricula),
      Nome: String(payload.Nome),
      PIN: String(payload.PIN),
      Perfil: String(payload.Perfil),
      Turno_Vinculado: String(payload.Turno_Vinculado),
      Ativo: String(payload.Ativo)
    };
    const all = DB.getCachedUsers().filter((user) =>
      user.Matricula !== original && user.Matricula !== updated.Matricula
    );
    const nextAll = [...all, updated];
    localStorage.setItem('Config_Usuarios', JSON.stringify(nextAll));
    persistAdminCache();
    renderUsers();
  }

  function updateActiveSessionFromUser(payload) {
    const original = String(payload.Matricula_Original || '');
    if (original !== session.Matricula && payload.Matricula !== session.Matricula) return false;
    if (String(payload.Ativo).toUpperCase() !== 'SIM') {
      showLogin('A matrícula desta sessão foi bloqueada.');
      return true;
    }
    const newTurn = payload.Perfil === 'ADMIN_GERAL'
      ? currentShift()
      : payload.Turno_Vinculado;
    session = DB.setSession({
      ...session,
      Matricula: payload.Matricula,
      Nome: payload.Nome,
      Perfil: payload.Perfil,
      Turno: newTurn,
      Turno_Vinculado: payload.Turno_Vinculado,
      user: {
        Matricula: payload.Matricula,
        Nome: payload.Nome,
        Perfil: payload.Perfil,
        Turno_Vinculado: payload.Turno_Vinculado,
        Ativo: payload.Ativo
      }
    });
    SESSAO = session;
    localStorage.setItem('byd_operator', session.Nome);
    localStorage.setItem('byd_shift', session.Turno);
    renderAccess();
    return true;
  }

  async function saveUser(payload) {
    try {
      const result = await DB.sendOrQueue(payload);
      if (result.sessionRevoked) {
        showLogin('A sessão foi encerrada porque o acesso foi bloqueado.');
        return false;
      }
      updateActiveSessionFromUser(payload);
      if (Array.isArray(result.users)) {
        localStorage.setItem('Config_Usuarios', JSON.stringify(result.users));
      } else {
        updateLocalUser(payload);
      }
      adminDataOffline = false;
      persistAdminCache();
      renderUsers();
      resetUserForm();
      refreshViews();
      showToast(result.mensagem || 'Usuário salvo com sucesso.');
      return true;
    } catch (error) {
      if (!queued(payload)) {
        if (error.code === 'DUPLICATE_MATRICULA') {
          alert('Matrícula já cadastrada para outro funcionário.');
          return false;
        }
        if (goToLoginIfUnauthorized(error)) return false;
        showToast(error.message || 'Não foi possível salvar o funcionário.', 5000);
        return false;
      }
      const changesCurrentUser = payload.Matricula_Original === session.Matricula ||
        payload.Matricula === session.Matricula;
      if (changesCurrentUser) updateActiveSessionFromUser(payload);
      updateLocalUser(payload);
      resetUserForm();
      refreshViews();
      showToast('Alteração salva na fila offline.');
      return true;
    }
  }

  async function createUser(event) {
    event.preventDefault();
    const payload = {
      action: 'salvar_usuario',
      Matricula_Original: el('userOriginalMatricula').value.trim(),
      Matricula: el('newUserMatricula').value.trim(),
      Nome: el('newUserName').value.trim(),
      PIN: el('newUserPin').value.trim(),
      Perfil: isLeader() ? 'OPERADOR' : el('newUserRole').value,
      Turno_Vinculado: isLeader() ? linkedShift() : el('newUserShift').value,
      Ativo: el('newUserActive').value
    };
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(payload.Matricula) ||
        !payload.Nome || !/^\d{4}$/.test(payload.PIN)) {
      showToast('Matrícula, nome e PIN de exatamente 4 dígitos são obrigatórios.');
      return;
    }
    const duplicate = DB.getCachedUsers().some((user) =>
      String(user.Matricula) === payload.Matricula &&
      String(user.Matricula) !== payload.Matricula_Original
    );
    if (duplicate) {
      alert('Matrícula já cadastrada para outro funcionário.');
      return;
    }
    if (!['ADMIN_GERAL', 'LIDER_TURNO', 'OPERADOR'].includes(payload.Perfil)) {
      showToast('Perfil inválido.');
      return;
    }
    if (payload.Perfil === 'ADMIN_GERAL') payload.Turno_Vinculado = 'TODOS';
    if (isLeader()) {
      payload.Perfil = 'OPERADOR';
      payload.Turno_Vinculado = linkedShift();
    }
    await saveUser(payload);
  }

  function handleUsersList(event) {
    const edit = event.target.closest('.edit-user');
    if (edit) openUserEdit(edit.dataset.id);
  }

  // =========================================================================
  // GESTÃO DE MOTORISTAS E FROTAS POR TURNO (RECURSOS_TURNO)
  // =========================================================================
  function applyResourceFormPermissions() {
    const shiftSelect = el('resourceShift');
    if (!shiftSelect) return;
    if (isLeader()) {
      shiftSelect.value = linkedShift();
      shiftSelect.disabled = true;
    } else {
      shiftSelect.disabled = !isGeneralAdmin();
    }
  }

  function resetResourceForm() {
    if (!el('resourceForm')) return;
    el('resourceEditId').value = '';
    el('resourceForm').reset();
    el('resourceType').value = 'MOTORISTA';
    el('resourceShift').value = isLeader()
      ? linkedShift()
      : (currentShift() === 'Geral' ? 'Turno B' : currentShift());
    el('resourceActive').value = 'SIM';
    el('saveResourceButton').textContent = '＋ Cadastrar motorista / frota';
    el('cancelResourceEditButton').hidden = true;
    applyResourceFormPermissions();
  }

  function renderResources() {
    const container = el('resourcesList');
    const status = el('resourceManagementStatus');
    if (!container) return;
    const list = visibleResourcesForAdmin(allResources);
    status.textContent = isLeader()
      ? `Mostrando ${list.length} motorista(s) e frota(s) exclusivos do ${linkedShift()}.`
      : `Mostrando ${list.length} recurso(s) cadastrados entre os turnos.`;

    if (!list.length) {
      container.innerHTML = '<div class="empty-state">Nenhum motorista ou frota cadastrado neste turno ainda.</div>';
      return;
    }

    container.innerHTML = list.slice().sort((a, b) => {
      const typeCmp = String(a.Tipo).localeCompare(String(b.Tipo));
      if (typeCmp !== 0) return typeCmp;
      return String(a.Nome).localeCompare(String(b.Nome), 'pt-BR');
    }).map((res) => {
      const active = String(res.Ativo).toUpperCase() === 'SIM';
      const isFleet = String(res.Tipo).toUpperCase() === 'FROTA';
      return `<article class="user-row">
        <div>
          <div class="user-name">${escapeHtml(res.Nome)}</div>
          <div class="user-detail">${isFleet ? 'Veículo / Rebocador' : 'Condutor autorizado'}</div>
        </div>
        <span class="role-tag${isFleet ? ' fleet' : ''}">${escapeHtml(res.Tipo)}</span>
        <span class="user-detail">${escapeHtml(res.Turno_Vinculado)}</span>
        <span class="user-status${active ? '' : ' inactive'}">${active ? 'ATIVO' : 'BLOQUEADO'}</span>
        <div class="user-actions">
          <button class="button edit-resource" type="button" data-id="${escapeHtml(res.ID_Recurso)}">✏️ Editar</button>
        </div>
      </article>`;
    }).join('');
  }

  function openResourceEdit(id) {
    const res = allResources.find((item) => String(item.ID_Recurso) === String(id));
    if (!res) return;
    el('resourceEditId').value = res.ID_Recurso;
    el('resourceType').value = res.Tipo;
    el('resourceName').value = res.Nome;
    el('resourceShift').value = res.Turno_Vinculado;
    el('resourceActive').value = res.Ativo;
    el('saveResourceButton').textContent = 'Salvar alteração';
    el('cancelResourceEditButton').hidden = false;
    applyResourceFormPermissions();
    el('resourceName').focus();
  }

  async function saveResource(event) {
    event.preventDefault();
    const payload = {
      action: 'salvar_recurso',
      ID_Recurso: el('resourceEditId').value.trim(),
      Tipo: el('resourceType').value,
      Nome: el('resourceName').value.trim().toUpperCase(),
      Turno_Vinculado: isLeader() ? linkedShift() : el('resourceShift').value,
      Ativo: el('resourceActive').value
    };
    if (!payload.Nome) {
      showToast('Informe o nome do motorista ou identificação da frota.');
      return;
    }
    const button = el('saveResourceButton');
    button.disabled = true;
    try {
      const result = await DB.sendOrQueue(payload);
      if (Array.isArray(result.resources)) {
        allResources = result.resources;
      } else {
        const idx = allResources.findIndex((r) => r.ID_Recurso === payload.ID_Recurso);
        const item = { ...payload, ID_Recurso: payload.ID_Recurso || `local-${Date.now()}` };
        if (idx >= 0) allResources[idx] = item;
        else allResources.push(item);
        localStorage.setItem('Cadastro_Recursos_Turno', JSON.stringify(allResources));
      }
      resetResourceForm();
      renderResources();
      renderOperationResources();
      showToast(result.mensagem || 'Cadastro salvo e liberado para o turno!');
    } catch (error) {
      if (!queued(payload)) {
        if (goToLoginIfUnauthorized(error)) return;
        showToast(error.message || 'Erro ao salvar motorista/frota.', 5000);
        return;
      }
      resetResourceForm();
      renderResources();
      renderOperationResources();
      showToast('Salvo na fila offline.');
    } finally {
      button.disabled = false;
    }
  }

  function handleResourcesList(event) {
    const edit = event.target.closest('.edit-resource');
    if (edit) openResourceEdit(edit.dataset.id);
  }

  // =========================================================================
  // EDIÇÃO E ESTORNO DE LANÇAMENTOS
  // =========================================================================
  function openEdit(record) {
    el('editRecordId').value = record.ID_Apontamento;
    el('editLotName').value = record.Nome_Lote || '';
    el('editModelSelect').replaceChildren(...Object.keys(CATALOG).map((model) => new Option(model, model)));
    const model = normalizeModelKey(record.Modelo_Base) || Object.keys(CATALOG)[0];
    el('editModelSelect').value = model;
    el('editQuantityInput').value = String(record.Qtd_Enviada ?? 1);

    const shift = record.Turno || currentShift();
    const drivers = allowedResourcesForShift('MOTORISTA', shift).map((d) => d.Nome);
    if (record.Motorista && !drivers.includes(record.Motorista)) drivers.unshift(record.Motorista);
    el('editDriverInput').replaceChildren(...drivers.map((name) => new Option(name, name)));
    el('editDriverInput').value = record.Motorista || '';

    const fleets = allowedResourcesForShift('FROTA', shift).map((f) => f.Nome);
    if (record.Frota && !fleets.includes(record.Frota)) fleets.unshift(record.Frota);
    el('editFleetInput').replaceChildren(...fleets.map((name) => new Option(name, name)));
    el('editFleetInput').value = record.Frota || '';

    renderEditComponents(record.Componente);
    el('editModal').showModal();
  }

  function renderEditComponents(selected = '') {
    const components = modelComponents(el('editModelSelect').value);
    el('editComponentSelect').replaceChildren(...components.map((component) => new Option(component.name, component.name)));
    if (components.some((component) => component.name === selected)) el('editComponentSelect').value = selected;
  }

  async function submitEdit(event) {
    event.preventDefault();
    const record = records.find((item) => item.ID_Apontamento === el('editRecordId').value);
    if (!record) {
      showToast('Lançamento não encontrado no histórico.', 5000);
      return;
    }
    const quantity = Number(el('editQuantityInput').value);
    const payload = {
      action: 'editar_apontamento',
      ID_Apontamento: record.ID_Apontamento,
      Nome_Lote: el('editLotName').value.trim(),
      Modelo_Base: el('editModelSelect').value,
      Componente: el('editComponentSelect').value,
      Qtd_Enviada: quantity,
      Motorista: el('editDriverInput').value.trim(),
      Frota: el('editFleetInput').value.trim()
    };
    if (!payload.Nome_Lote || !payload.Componente || !Number.isInteger(quantity) || quantity <= 0) {
      showToast('Confira lote, componente e quantidade.', 5000);
      return;
    }
    const button = el('saveEditButton');
    button.disabled = true;
    try {
      try {
        await DB.sendOrQueue(payload);
        showToast('⚡ Lançamento atualizado em tempo real.');
      } catch (error) {
        if (!queued(payload)) {
          if (goToLoginIfUnauthorized(error)) return;
          throw error;
        }
        showToast('Edição salva na fila offline.');
      }
      const previousRecord = { ...record };
      if (previousRecord.Status !== 'ESTORNADO') {
        upsertProgressForRecord(previousRecord, -Number(previousRecord.Qtd_Enviada));
      }
      Object.assign(record, {
        Nome_Lote: payload.Nome_Lote,
        Modelo_Base: payload.Modelo_Base,
        Componente: payload.Componente,
        Qtd_Enviada: payload.Qtd_Enviada,
        Motorista: payload.Motorista,
        Frota: payload.Frota
      });
      if (record.Status !== 'ESTORNADO') upsertProgressForRecord(record, Number(payload.Qtd_Enviada));
      const lot = activeLots.find((item) =>
        item.name.toLowerCase() === record.Nome_Lote.toLowerCase() &&
        normalizeModelKey(item.model) === normalizeModelKey(record.Modelo_Base) &&
        turnKey(item.shift) === turnKey(record.Turno)
      );
      if (lot) lot.model = record.Modelo_Base;
      persistLots();
      DB.setCache(records);
      el('editModal').close();
      renderLots();
      refreshViews();
    } catch (error) {
      showToast(error.message || 'Não foi possível editar o lançamento.', 5000);
    } finally {
      button.disabled = false;
    }
  }

  async function handleHistoryClick(event) {
    const resend = event.target.closest('.resend-button');
    const reverse = event.target.closest('.reverse-button');
    const edit = event.target.closest('.edit-record-button');
    if (resend) {
      const record = records.find((item) => item.ID_Apontamento === resend.dataset.id);
      if (record) await shareReport(record);
      return;
    }
    if (edit) {
      const record = records.find((item) => item.ID_Apontamento === edit.dataset.id);
      if (record) openEdit(record);
      return;
    }
    if (!reverse) return;
    const record = records.find((item) => item.ID_Apontamento === reverse.dataset.id);
    if (!record || record.Status === 'ESTORNADO') return;
    el('reverseRecordId').value = record.ID_Apontamento;
    el('reverseReasonInput').value = '';
    el('reverseModal').showModal();
  }

  async function submitReverse(event) {
    event.preventDefault();
    const record = records.find((item) => item.ID_Apontamento === el('reverseRecordId').value);
    const reason = el('reverseReasonInput').value.trim();
    if (!record || record.Status === 'ESTORNADO' || !reason) return;
    const payload = {
      action: 'reverse',
      ID_Apontamento: record.ID_Apontamento,
      Status: 'ESTORNADO',
      Motivo_Estorno: reason
    };
    const button = el('confirmReverseButton');
    button.disabled = true;
    try {
      try {
        await DB.sendOrQueue(payload);
        showToast('⚡ Lançamento estornado em tempo real.');
      } catch (error) {
        if (!queued(payload)) {
          if (goToLoginIfUnauthorized(error)) return;
          throw error;
        }
        showToast('Estorno salvo na fila offline.');
      }
      record.Status = 'ESTORNADO';
      record.Motivo_Estorno = reason;
      upsertProgressForRecord(record, -Number(record.Qtd_Enviada));
      DB.setCache(records);
      el('reverseModal').close();
      refreshViews();
    } catch (error) {
      showToast(error.message || 'Não foi possível estornar o lançamento.', 5000);
    } finally {
      button.disabled = false;
    }
  }

  function mudarAba(view) {
    if (!session) {
      showLogin('Faça login para acessar o sistema.');
      return false;
    }
    if (view !== 'operation' && !canOpenAdminViews()) {
      document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
      el('operationView').classList.add('active');
      document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === 'operation'));
      showToast('Acesso restrito a ADMIN_GERAL ou LIDER_TURNO.', 4500);
      return false;
    }
    const views = { operation: 'operationView', cockpit: 'cockpitView', settings: 'settingsView' };
    if (!views[view]) return false;
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
    el(views[view]).classList.add('active');
    document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'cockpit' && window.Cockpit && typeof Cockpit.update === 'function') {
      Cockpit.update(records, cockpitContext());
    }
    if (view === 'settings') {
      renderAccess();
      fillGovernanceForm();
      renderUsers();
      renderResources();
    }
    return true;
  }

  function changeGeneralShift() {
    if (!isGeneralAdmin()) return;
    const turn = el('generalShiftSelect').value;
    if (!['Turno A', 'Turno B', 'Turno C', 'Geral'].includes(turn)) return;
    session = DB.setSession({ ...session, Turno: turn });
    SESSAO = session;
    localStorage.setItem('byd_shift', turn);
    renderAccess();
    fillGovernanceForm(turn);
    renderOperationResources();
    renderLots();
    refreshViews();
  }

  function updateLoginShiftForUser() {
    const matricula = el('loginMatricula').value.trim();
    const user = DB.getCachedUsers().find((item) => String(item.Matricula) === matricula);
    const select = el('loginShift');
    const generalOption = select.querySelector('[data-admin-general="true"]');
    const isGeneral = user && String(user.Perfil).toUpperCase() === 'ADMIN_GERAL';
    generalOption.hidden = !isGeneral;
    if (isGeneral) {
      select.disabled = false;
      return;
    }
    if (user && ['LIDER_TURNO', 'OPERADOR'].includes(String(user.Perfil).toUpperCase())) {
      select.value = user.Turno_Vinculado;
      select.disabled = true;
      return;
    }
    select.disabled = false;
    if (select.value === 'Geral') select.value = 'Turno A';
  }

  async function createLot(event) {
    event.preventDefault();
    const model = el('newLotModel').value;
    const name = el('newLotName').value.trim();
    if (currentShift() === 'Geral') {
      showToast('Selecione um turno específico antes de abrir um lote.');
      return;
    }
    if (!name || !CATALOG[model]) {
      showToast('Informe um nome e um modelo válido para o lote.');
      return;
    }
    const duplicate = activeLots.some((lot) =>
      lot.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(lot.model) === normalizeModelKey(model)
    );
    if (duplicate) {
      showToast('Este lote já está ativo no catálogo.');
      return;
    }
    const lot = {
      id: `LOT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      name,
      model,
      createdAt: new Date().toISOString(),
      createdLocalAt: Date.now(),
      shift: currentShift()
    };
    const payload = {
      action: 'salvar_lote',
      ID_Lote: lot.id,
      Nome_Lote: lot.name,
      Modelo_Base: lot.model,
      Turno_Vinculado: lot.shift,
      Data_Criacao: lot.createdAt
    };
    activeLots.push(lot);
    selectedLotId = lot.id;
    selectedComponent = CATALOG[model].components[0].name;
    quantity = 0;
    persistLots();
    el('batchModal').close();
    el('batchForm').reset();
    renderLots();
    refreshViews();
    try {
      await DB.sendOrQueue(payload);
    } catch (error) {
      if (!queued(payload)) {
        activeLots = activeLots.filter((item) => item.id !== lot.id);
        DB.removeLotFromLocal({ ID_Lote: lot.id, Nome_Lote: lot.name, Modelo_Base: lot.model });
        renderLots();
        refreshViews();
        if (goToLoginIfUnauthorized(error)) return;
        showToast(error.message || 'Não foi possível salvar o lote.', 5000);
        return;
      }
    }
    renderLots();
    refreshViews();
    showToast(DB.getQueue().some((item) => item.ID_Lote === lot.id)
      ? `Lote ${name} salvo na fila offline.`
      : `⚡ Lote ${name} criado e visível para todos os operadores!`);
  }

  async function deleteSelectedLot() {
    const lot = currentLot();
    if (!lot) {
      showToast('Selecione um lote para excluir.');
      return;
    }
    const hasStagedItems = tripItems.some((item) =>
      String(item.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR') === lot.name.toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(item.Modelo_Base) === normalizeModelKey(lot.model)
    );
    if (hasStagedItems) {
      showToast('Remova os materiais deste lote da carga atual antes de excluí-lo.', 4500);
      return;
    }
    const hasActiveRecords = records.some((record) =>
      String(record.Status || '').toUpperCase() !== 'ESTORNADO' &&
      String(record.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR') === lot.name.toLocaleLowerCase('pt-BR') &&
      normalizeModelKey(record.Modelo_Base) === normalizeModelKey(lot.model)
    );
    if (hasActiveRecords) {
      showToast('Este lote possui lançamentos ativos. Estorne-os antes de excluir o lote.', 5000);
      return;
    }
    if (!window.confirm(`Deseja realmente excluir o lote "${lot.name} (${lot.model})"?`)) {
      return;
    }

    const button = el('deleteBatchButton');
    if (button) button.disabled = true;

    const payload = {
      action: 'excluir_lote',
      ID_Lote: lot.id,
      Nome_Lote: lot.name,
      Modelo_Base: lot.model
    };

    try {
      activeLots = activeLots.filter((item) => !sameLot(item, lot));
      lotProgress = lotProgress.filter((progress) =>
        !(String(progress.Nome_Lote || '').trim().toLocaleLowerCase('pt-BR') === lot.name.toLocaleLowerCase('pt-BR') &&
          normalizeModelKey(progress.Modelo_Base) === normalizeModelKey(lot.model))
      );
      DB.removeLotFromLocal({ ID_Lote: lot.id, Nome_Lote: lot.name, Modelo_Base: lot.model });
      persistLots();
      localStorage.setItem('Progresso_Lotes', JSON.stringify(lotProgress));
      selectedLotId = '';
      quantity = 0;
      renderLots();
      refreshViews();

      try {
        await DB.sendOrQueue(payload);
        showToast(`Lote ${lot.name} excluído em tempo real.`);
      } catch (error) {
        if (queued(payload)) {
          showToast(`Lote ${lot.name} removido localmente; exclusão na fila.`);
          updateSyncStatus();
          return;
        }
        if (goToLoginIfUnauthorized(error)) return;
        showToast(error.message || 'Não foi possível excluir o lote.', 5000);
        await silentSync();
      }
    } finally {
      if (button) button.disabled = activeLots.filter((item) => !lotIsComplete(item)).length === 0;
    }
  }

  function openNewLot() {
    if (currentShift() === 'Geral') {
      showToast('Selecione um turno específico antes de abrir um lote.');
      return;
    }
    el('newLotModel').replaceChildren(...Object.keys(CATALOG).map((model) => new Option(model, model)));
    el('newLotModel').value = 'EQE';
    el('newLotName').value = '';
    el('batchModal').showModal();
    setTimeout(() => el('newLotName').focus(), 50);
  }

  function updateSyncStatusOnOnline() {
    updateSyncStatus();
    if (navigator.onLine && session && DB.getQueue().length) syncNow();
  }

  function logout() {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = null;
    showLogin('');
    el('loginMatricula').value = '';
    el('loginPin').value = '';
    el('loginShift').value = 'Turno A';
    el('loginShift').disabled = false;
    el('loginShift').querySelector('[data-admin-general="true"]').hidden = true;
  }

  function attachEvents() {
    el('loginForm').addEventListener('submit', handleLogin);
    el('loginMatricula').addEventListener('input', updateLoginShiftForUser);
    el('logoutButton').addEventListener('click', logout);
    el('syncButton').addEventListener('click', syncNow);
    el('generalShiftSelect').addEventListener('change', changeGeneralShift);
    el('newBatchButton').addEventListener('click', openNewLot);
    el('deleteBatchButton').addEventListener('click', deleteSelectedLot);
    el('batchForm').addEventListener('submit', createLot);
    el('addTripItemButton').addEventListener('click', () => {
      try {
        addTripItem();
      } catch (error) {
        showToast(error.message || 'Não foi possível adicionar o material.', 4500);
      }
    });
    el('tripItemsList').addEventListener('click', (event) => {
      const button = event.target.closest('.remove-trip-item');
      if (!button) return;
      tripItems.splice(Number(button.dataset.index), 1);
      renderLots();
      refreshViews();
    });
    el('pendingLotsList').addEventListener('click', selectPendingComponent);
    el('componentGrid').addEventListener('click', (event) => {
      const button = event.target.closest('[data-component]');
      if (!button) return;
      selectedComponent = button.dataset.component;
      quantity = 0;
      renderSelectedLot();
    });
    el('activeLotSelect').addEventListener('change', () => {
      selectedLotId = el('activeLotSelect').value;
      localStorage.setItem(SELECTED_LOT_KEY, selectedLotId);
      selectedComponent = '';
      quantity = 0;
      renderSelectedLot();
    });
    el('quantitySteps').addEventListener('click', (event) => {
      const button = event.target.closest('[data-step]');
      const lot = currentLot();
      const definition = lot && CATALOG[normalizeModelKey(lot.model)];
      const component = definition && definition.components.find((item) => item.name === selectedComponent);
      if (button && component) {
        quantity = Math.max(0, quantity + Number(button.dataset.step));
        updateQuantityDisplay();
      }
      if (event.target.closest('#metaCompleteButton') && component) {
        quantity = componentSaldo(lot, component);
        updateQuantityDisplay();
      }
    });
    document.querySelectorAll('.quantity-arrow').forEach((button) => button.addEventListener('click', () => {
      quantity = Math.max(0, quantity + Number(button.dataset.step));
      updateQuantityDisplay();
    }));
    el('quantityInput').addEventListener('input', () => {
      quantity = Math.max(0, Math.floor(Number(el('quantityInput').value) || 0));
      updateQuantityDisplay();
    });
    el('saveRecordButton').addEventListener('click', saveTrip);
    el('shareCurrentButton').addEventListener('click', async () => {
      try {
        const now = nowParts();
        const items = tripItems.length
          ? tripItems.map((item) => ({ ...item, ...now }))
          : lastSavedTrip;
        await shareTripReport(items, el('driverInput').value.trim(), el('fleetInput').value.trim(), evidenceFile);
      } catch (error) {
        showToast(error.message || 'Não foi possível compartilhar o relatório.', 5000);
      }
    });
    el('photoInput').addEventListener('change', async () => {
      const source = el('photoInput').files[0];
      if (!source) return;
      el('photoHint').textContent = 'Comprimindo evidência…';
      try {
        evidenceFile = await compressPhoto(source);
        if (evidenceObjectUrl) URL.revokeObjectURL(evidenceObjectUrl);
        evidenceObjectUrl = URL.createObjectURL(evidenceFile);
        el('photoPreview').src = evidenceObjectUrl;
        el('photoPreview').classList.add('visible');
        el('removePhotoButton').hidden = false;
        el('photoHint').textContent = `${Math.max(1, Math.round(evidenceFile.size / 1024))} KB · JPEG até 1024 px`;
      } catch (error) {
        clearEvidence();
        showToast(error.message || 'Falha ao processar a foto.', 5000);
      }
    });
    el('removePhotoButton').addEventListener('click', clearEvidence);
    el('historyList').addEventListener('click', handleHistoryClick);
    el('reverseForm').addEventListener('submit', submitReverse);
    el('editForm').addEventListener('submit', submitEdit);
    el('editModelSelect').addEventListener('change', () => renderEditComponents());

    // Equipe por turno
    el('userForm').addEventListener('submit', createUser);
    el('usersList').addEventListener('click', handleUsersList);
    el('cancelUserEditButton').addEventListener('click', resetUserForm);
    el('newUserRole').addEventListener('change', handleUserRoleChange);
    if (el('userShiftFilter')) el('userShiftFilter').addEventListener('change', renderUsers);

    // Motoristas e frotas por turno
    if (el('resourceForm')) el('resourceForm').addEventListener('submit', saveResource);
    if (el('resourcesList')) el('resourcesList').addEventListener('click', handleResourcesList);
    if (el('cancelResourceEditButton')) el('cancelResourceEditButton').addEventListener('click', resetResourceForm);
    if (el('resourceShiftFilter')) el('resourceShiftFilter').addEventListener('change', renderResources);

    el('settingsModelSelect').addEventListener('change', loadModelEditor);
    el('loadModelButton').addEventListener('click', loadModelEditor);
    el('saveModelButton').addEventListener('click', saveModel);
    el('governanceForm').addEventListener('submit', saveGovernance);
    el('testConnectionButton').addEventListener('click', testConnection);
    document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => {
      el(button.dataset.close).close();
    }));
    document.querySelectorAll('.nav-button').forEach((button) =>
      button.addEventListener('click', () => mudarAba(button.dataset.view))
    );
    window.addEventListener('online', updateSyncStatusOnOnline);
    window.addEventListener('offline', updateSyncStatus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') silentSync();
    });
    window.addEventListener('focus', silentSync);
  }

  async function restoreSession() {
    const saved = DB.getSession();
    const valid = saved && saved.Matricula && saved.Nome &&
      ['OPERADOR', 'LIDER_TURNO', 'ADMIN_GERAL'].includes(saved.Perfil) &&
      (saved.Perfil === 'ADMIN_GERAL'
        ? ['Turno A', 'Turno B', 'Turno C', 'Geral'].includes(saved.Turno)
        : ['Turno A', 'Turno B', 'Turno C'].includes(saved.Turno_Vinculado)) &&
      (!saved.expiresAt || saved.expiresAt > Date.now());
    if (!valid) {
      showLogin();
      return;
    }
    session = DB.setSession(saved);
    SESSAO = session;
    showApp();
    await loadAuthenticatedData();
  }

  function initialize() {
    loadGovernanceConfig();
    attachEvents();
    Object.keys(CATALOG).forEach((model) => el('newLotModel').add(new Option(model, model)));
    renderOperationResources();
    renderLots();
    renderModelSelect();
    resetUserForm();
    resetResourceForm();
    updateLoginShiftForUser();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
    }
    restoreSession();
  }

  initialize();
})();