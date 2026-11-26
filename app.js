(() => {
  'use strict';

  const STORAGE_KEYS = {
    SESSION: 'byd_session_v2',
    CACHE: 'byd_cache_v2',
    DRAFT_TRIP: 'byd_draft_trip_v2'
  };

  const DEFAULT_MODELS = [
    {
      Modelo_Base: 'EQE',
      Total_Meta: 233,
      Componentes: [
        { Nome: 'Aramados baixos', Meta: 60 },
        { Nome: 'Aramados altos', Meta: 38 },
        { Nome: 'Caixarias', Meta: 135 }
      ]
    },
    {
      Modelo_Base: 'HA2',
      Total_Meta: 240,
      Componentes: [
        { Nome: 'Aramados baixos', Meta: 60 },
        { Nome: 'Aramados altos', Meta: 60 },
        { Nome: 'Escapamentos', Meta: 120 }
      ]
    },
    {
      Modelo_Base: 'SA2/SA6',
      Total_Meta: 120,
      Componentes: [
        { Nome: 'Barcas', Meta: 40 },
        { Nome: 'Motores / Eixos', Meta: 40 },
        { Nome: 'Aramados de Caixas', Meta: 40 }
      ]
    },
    {
      Modelo_Base: 'SC3',
      Total_Meta: 120,
      Componentes: [
        { Nome: 'Aramados baixos', Meta: 30 },
        { Nome: 'Aramados altos', Meta: 30 },
        { Nome: 'Caixarias', Meta: 60 }
      ]
    },
    {
      Modelo_Base: 'PBP',
      Total_Meta: 387,
      Componentes: [
        { Nome: 'Aramados altos e baixos', Meta: 60 },
        { Nome: 'Caixarias', Meta: 87 },
        { Nome: 'Jantes', Meta: 240 }
      ]
    }
  ];

  const state = {
    session: null,
    activeView: 'operation',
    activeShift: 'Turno B',
    selectedLotKey: '',
    selectedComponent: '',
    tripItems: [],
    photoDataUrl: '',
    data: {
      records: [],
      activeLots: [],
      models: JSON.parse(JSON.stringify(DEFAULT_MODELS)),
      resources: [],
      users: [],
      settings: {
        apiUrl: '',
        coordinator: 'Anderson Andrade',
        leadership: 'Daniela Menezes'
      }
    }
  };

  const el = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[ch]));
  }

  function todayIso(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  }

  function formatBrDate(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '--/--/----';
  }

  function nowTimeStr(date = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }

  function normModel(model) {
    const s = String(model || '').trim().toUpperCase().replace(/\s+/g, '');
    if (s === 'SA2' || s === 'SA6' || s === 'SA2/SA6') return 'SA2/SA6';
    return s;
  }

  function normTurn(shift) {
    const s = String(shift || '').trim();
    if (!s || /^geral$/i.test(s) || /^todos$/i.test(s) || /^all$/i.test(s)) return 'Geral';
    const m = s.match(/([ABC])$/i);
    return m ? `Turno ${m[1].toUpperCase()}` : s;
  }

  function normRecordDate(r) {
    const m = String(r.Data_Ref || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(r.DataHora || '');
    return Number.isNaN(d.getTime()) ? '' : todayIso(d);
  }

  function showToast(message) {
    const toast = el('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }

  function setSyncBadge(mode, text) {
    const pill = el('syncStatus');
    if (!pill) return;
    pill.className = 'sync-pill';
    if (mode === 'pending') pill.classList.add('pending');
    if (mode === 'offline') pill.classList.add('offline');
    pill.textContent = text;
  }

  function saveLocalCache() {
    try {
      localStorage.setItem(STORAGE_KEYS.CACHE, JSON.stringify(state.data));
      localStorage.setItem(STORAGE_KEYS.DRAFT_TRIP, JSON.stringify(state.tripItems));
    } catch (_) {}
  }

  function loadLocalCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state.data = {
            ...state.data,
            ...parsed,
            models: Array.isArray(parsed.models) && parsed.models.length
              ? parsed.models
              : JSON.parse(JSON.stringify(DEFAULT_MODELS))
          };
        }
      }
      const draft = localStorage.getItem(STORAGE_KEYS.DRAFT_TRIP);
      if (draft) {
        const items = JSON.parse(draft);
        if (Array.isArray(items)) state.tripItems = items;
      }
    } catch (_) {}
  }

  function dbApi() {
    return window.DB || window.db || null;
  }

  function isAdminGeneral() {
    return state.session && String(state.session.role || '').toUpperCase() === 'ADMIN_GERAL';
  }

  function isAdminOrLeader() {
    if (!state.session) return false;
    const role = String(state.session.role || '').toUpperCase();
    return role === 'ADMIN_GERAL' || role === 'LIDER_TURNO';
  }

  function getModelCatalog() {
    const map = {};
    (state.data.models || DEFAULT_MODELS).forEach((m) => {
      const key = normModel(m.Modelo_Base);
      if (!key) return;
      const comps = Array.isArray(m.Componentes) ? m.Componentes : [];
      map[key] = {
        Modelo_Base: key,
        Total_Meta: Number(m.Total_Meta) || comps.reduce((s, c) => s + (Number(c.Meta) || 0), 0),
        Componentes: comps.map((c) => ({
          Nome: String(c.Nome || '').trim(),
          Meta: Number(c.Meta) || 0
        }))
      };
    });
    return map;
  }

  function getConsolidatedLots() {
    const catalog = getModelCatalog();
    const map = new Map();

    const ensure = (name, model, shift = '') => {
      const lName = String(name || '').trim();
      const mKey = normModel(model);
      if (!lName || !mKey) return null;
      const key = `${mKey}|${lName.toLocaleLowerCase('pt-BR')}`;
      if (!map.has(key)) {
        const def = catalog[mKey] || { Total_Meta: 0, Componentes: [] };
        map.set(key, {
          key,
          name: lName,
          model: mKey,
          shift: normTurn(shift) === 'Geral' ? '' : normTurn(shift),
          totalMeta: def.Total_Meta,
          components: def.Componentes.map((c) => ({
            name: c.Nome,
            meta: c.Meta,
            sent: 0
          })),
          hasRecords: false
        });
      }
      return map.get(key);
    };

    (state.data.activeLots || []).forEach((lot) => {
      ensure(
        lot.Nome_Lote || lot.name,
        lot.Modelo_Base || lot.model,
        lot.Turno_Vinculado || lot.shift
      );
    });

    (state.data.records || []).forEach((r) => {
      if (String(r.Status || '').toUpperCase() === 'ESTORNADO') return;
      const entry = ensure(r.Nome_Lote, r.Modelo_Base, r.Turno);
      if (!entry) return;
      entry.hasRecords = true;
      const compName = String(r.Componente || '').trim();
      const qty = Number(r.Qtd_Enviada) || 0;
      const found = entry.components.find(
        (c) => c.name.toLocaleLowerCase('pt-BR') === compName.toLocaleLowerCase('pt-BR')
      );
      if (found) {
        found.sent += qty;
      } else {
        entry.components.push({ name: compName, meta: 0, sent: qty });
      }
    });

    // Soma também os itens ainda na carga atual (não gravados) para evitar estouro de saldo
    state.tripItems.forEach((item) => {
      const entry = ensure(item.lotName, item.model, state.activeShift);
      if (!entry) return;
      const found = entry.components.find(
        (c) => c.name.toLocaleLowerCase('pt-BR') === String(item.component || '').trim().toLocaleLowerCase('pt-BR')
      );
      if (found) found.draft = (found.draft || 0) + (Number(item.quantity) || 0);
    });

    return [...map.values()].filter((lot) => {
      if (state.activeShift === 'Geral') return true;
      return !lot.shift || lot.shift === state.activeShift;
    });
  }

  /* =========================================================
     RELATÓRIO WHATSAPP (COM LOTE NO TOPO)
     ========================================================= */
  function formatTransportReport({ items = [], driver = '', fleet = '', date = '', time = '' }) {
    const uniqueLots = [...new Set(
      items
        .map((item) => String(item.lotName || item.Nome_Lote || item.lote || '').trim())
        .filter(Boolean)
    )];

    const lotLine = uniqueLots.length > 1
      ? `🚚 Lotes: ${uniqueLots.join(', ')}`
      : `🚚 Lote: ${uniqueLots[0] || 'NÃO INFORMADO'}`;

    const materialLines = items.map((item) => {
      const lot = String(item.lotName || item.Nome_Lote || item.lote || '').trim();
      const comp = String(item.component || item.Componente || item.material || '').trim();
      const qty = Number(item.quantity ?? item.Qtd_Enviada ?? item.qtd ?? 0);
      return `- ${lot} — ${comp} (${qty} ${qty === 1 ? 'palete' : 'paletes'})`;
    });

    const totalPallets = items.reduce(
      (sum, item) => sum + Number(item.quantity ?? item.Qtd_Enviada ?? item.qtd ?? 0),
      0
    );

    return [
      '📦 RELATÓRIO DE TRANSPORTE DE MATERIAL 📦',
      '',
      lotLine,
      `👤 Motorista: ${String(driver || 'NÃO INFORMADO').trim().toUpperCase()}`,
      `🚛 Frota: ${String(fleet || 'NÃO INFORMADA').trim()}`,
      '📋 Materiais da Carga:',
      ...materialLines,
      `📦 Total Geral: ${totalPallets} ${totalPallets === 1 ? 'palete' : 'paletes'}`,
      `🕗 Horário: ${time || nowTimeStr()}`,
      `📅 Data: ${date || formatBrDate(todayIso())}`
    ].join('\n');
  }

  function openWhatsAppWithText(text) {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  /* =========================================================
     SINCRONIZAÇÃO COM SUPABASE / DB.JS
     ========================================================= */
  async function syncData(silent = false) {
    const api = dbApi();
    if (!api) {
      setSyncBadge('offline', '● Modo Local');
      renderAll();
      return;
    }

    setSyncBadge('pending', '↻ Sincronizando…');
    try {
      let payload = null;
      if (typeof api.syncAll === 'function') {
        payload = await api.syncAll();
      } else if (typeof api.fetchAll === 'function') {
        payload = await api.fetchAll();
      } else if (typeof api.loadAll === 'function') {
        payload = await api.loadAll();
      }

      if (payload && typeof payload === 'object') {
        if (Array.isArray(payload.records)) state.data.records = payload.records;
        if (Array.isArray(payload.activeLots)) state.data.activeLots = payload.activeLots;
        if (Array.isArray(payload.models) && payload.models.length) state.data.models = payload.models;
        if (Array.isArray(payload.resources)) state.data.resources = payload.resources;
        if (Array.isArray(payload.users)) state.data.users = payload.users;
        if (payload.settings && typeof payload.settings === 'object') {
          state.data.settings = { ...state.data.settings, ...payload.settings };
        }
      }

      saveLocalCache();
      setSyncBadge('ok', '● Sincronizado');
      const label = el('lastRefreshLabel');
      if (label) label.textContent = `Atualizado às ${nowTimeStr()}`;
      if (!silent) showToast('✓ Dados sincronizados com sucesso!');
    } catch (err) {
      console.error('Erro na sincronização:', err);
      setSyncBadge('offline', '● Offline (Cache)');
      if (!silent) showToast('⚠️ Falha ao conectar; usando cache local.');
    }

    renderAll();
  }

  /* =========================================================
     AUTENTICAÇÃO E SESSÃO
     ========================================================= */
  function applySessionPermissions() {
    if (!state.session) return;
    const admin = isAdminOrLeader();
    const general = isAdminGeneral();

    document.querySelectorAll('.admin-only').forEach((node) => {
      node.hidden = !admin;
    });
    document.querySelectorAll('.admin-general-only').forEach((node) => {
      node.hidden = !general;
    });

    const navInner = el('navInner');
    if (navInner) {
      navInner.style.gridTemplateColumns = admin ? 'repeat(3, 1fr)' : '1fr';
    }

    const opSummary = el('operatorSummary');
    if (opSummary) {
      opSummary.innerHTML = `${escapeHtml(state.session.name)} <span class="user-role">${escapeHtml(state.session.role)}</span>`;
    }

    const shiftSummary = el('shiftSummary');
    const generalSelect = el('generalShiftSelect');
    if (general) {
      if (shiftSummary) shiftSummary.hidden = true;
      if (generalSelect) {
        generalSelect.hidden = false;
        generalSelect.value = state.activeShift;
      }
    } else {
      if (generalSelect) generalSelect.hidden = true;
      if (shiftSummary) {
        shiftSummary.hidden = false;
        shiftSummary.textContent = state.activeShift;
      }
    }

    const lockHint = el('resourceLockHint');
    if (lockHint) {
      lockHint.textContent = admin
        ? 'Perfil gestão: você pode cadastrar novos motoristas e frotas na aba Cadastros.'
        : 'Selecione o motorista e a frota cadastrados para o seu turno.';
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const matricula = String(el('loginMatricula')?.value || '').trim();
    const pin = String(el('loginPin')?.value || '').trim();
    const chosenShift = normTurn(el('loginShift')?.value || 'Turno B');
    const feedback = el('loginFeedback');
    const btn = el('loginButton');

    if (feedback) feedback.textContent = '';
    if (!matricula || !/^\d{4}$/.test(pin)) {
      if (feedback) feedback.textContent = 'Informe a matrícula e um PIN numérico de 4 dígitos.';
      return;
    }

    if (btn) btn.disabled = true;

    try {
      const api = dbApi();
      let user = null;

      if (api && typeof api.login === 'function') {
        user = await api.login(matricula, pin);
      } else {
        const list = state.data.users || [];
        user = list.find(
          (u) => String(u.Matricula).trim() === matricula && String(u.PIN).trim() === pin
        );
      }

      if (!user) {
        if (feedback) feedback.textContent = 'Matrícula ou PIN inválidos.';
        return;
      }

      if (String(user.Ativo || 'SIM').toUpperCase() === 'NAO') {
        if (feedback) feedback.textContent = 'Acesso bloqueado. Procure a liderança do turno.';
        return;
      }

      const role = String(user.Perfil || user.role || 'OPERADOR').toUpperCase();
      const userShift = normTurn(user.Turno || user.shift || chosenShift);

      if (role !== 'ADMIN_GERAL' && userShift !== 'Geral' && userShift !== 'TODOS' && chosenShift !== userShift) {
        if (feedback) feedback.textContent = `Seu cadastro está vinculado ao ${userShift}.`;
        return;
      }

      state.session = {
        matricula: String(user.Matricula || matricula).trim(),
        name: String(user.Nome || user.name || matricula).trim(),
        role,
        shift: userShift
      };
      state.activeShift = role === 'ADMIN_GERAL' ? chosenShift : (userShift === 'TODOS' ? chosenShift : userShift);

      localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(state.session));
      el('loginView').hidden = true;
      el('appShell').hidden = false;

      applySessionPermissions();
      await syncData(true);
      showToast(`Bem-vindo, ${state.session.name}!`);
    } catch (err) {
      console.error(err);
      if (feedback) feedback.textContent = err?.message || 'Erro ao autenticar no sistema.';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEYS.SESSION);
    state.session = null;
    state.tripItems = [];
    el('appShell').hidden = true;
    el('loginView').hidden = false;
    if (el('loginPin')) el('loginPin').value = '';
    switchView('operation');
  }

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.screen').forEach((sec) => sec.classList.remove('active'));
    document.querySelectorAll('.nav-button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    const target = el(`${viewName}View`);
    if (target) target.classList.add('active');

    if (viewName === 'cockpit') updateCockpitModule();
    if (viewName === 'settings') renderSettings();
  }

  /* =========================================================
     ABA 1: OPERAÇÃO
     ========================================================= */
  function getSelectedLot() {
    const lots = getConsolidatedLots();
    if (!lots.length) {
      state.selectedLotKey = '';
      return null;
    }
    let lot = lots.find((l) => l.key === state.selectedLotKey);
    if (!lot) {
      lot = lots[0];
      state.selectedLotKey = lot.key;
    }
    return lot;
  }

  function renderOperation() {
    const lots = getConsolidatedLots();
    const select = el('activeLotSelect');
    const metaBox = el('batchMeta');
    const deleteBtn = el('deleteBatchButton');

    if (select) {
      if (!lots.length) {
        select.innerHTML = '<option value="">Nenhum lote ativo — clique em + Novo Lote</option>';
        select.disabled = true;
      } else {
        select.disabled = false;
        select.innerHTML = lots
          .map((l) => {
            const sent = l.components.reduce((s, c) => s + c.sent, 0);
            return `<option value="${escapeHtml(l.key)}">${escapeHtml(l.name)} · ${escapeHtml(l.model)} (${sent}/${l.totalMeta} paletes)</option>`;
          })
          .join('');
        select.value = getSelectedLot()?.key || lots[0].key;
      }
    }

    const lot = getSelectedLot();
    if (deleteBtn) {
      deleteBtn.disabled = !lot || lot.hasRecords;
    }

    if (metaBox) {
      if (!lot) {
        metaBox.innerHTML = '<span class="meta-badge">Crie um lote para iniciar os apontamentos</span>';
      } else {
        const sent = lot.components.reduce((s, c) => s + c.sent, 0);
        const saldo = Math.max(0, lot.totalMeta - sent);
        metaBox.innerHTML = `
          <span class="meta-badge">Modelo: <strong>${escapeHtml(lot.model)}</strong></span>
          <span class="meta-badge">Meta: <strong>${lot.totalMeta}</strong></span>
          <span class="meta-badge">Enviado: <strong>${sent}</strong></span>
          <span class="meta-badge">Saldo: <strong>${saldo}</strong></span>
        `;
      }
    }

    renderComponents(lot);
    renderTripItems();
    renderDriversAndFleets();
    renderPendingLots(lots);
    renderShiftHistory();
  }

  function renderComponents(lot) {
    const grid = el('componentGrid');
    const label = el('componentMetaLabel');
    if (!grid) return;

    if (!lot) {
      if (label) label.textContent = 'AGUARDANDO LOTE';
      grid.innerHTML = '<div class="empty-state">Selecione ou crie um lote acima.</div>';
      state.selectedComponent = '';
      updateQuantityControls();
      return;
    }

    if (label) label.textContent = `${lot.model} · ${lot.components.length} ITENS`;

    const validNames = lot.components.map((c) => c.name);
    if (!validNames.includes(state.selectedComponent)) {
      const firstOpen = lot.components.find((c) => c.meta - c.sent - (c.draft || 0) > 0);
      state.selectedComponent = firstOpen ? firstOpen.name : (lot.components[0]?.name || '');
    }

    grid.innerHTML = lot.components
      .map((c) => {
        const used = c.sent + (c.draft || 0);
        const saldo = Math.max(0, c.meta - used);
        const selected = c.name === state.selectedComponent;
        const disabled = c.meta > 0 && saldo === 0;
        return `
          <button type="button" class="component-button ${selected ? 'selected' : ''}" data-comp="${escapeHtml(c.name)}" ${disabled ? 'disabled' : ''}>
            <span class="component-name">${escapeHtml(c.name)}</span>
            <span class="component-target">Enviado: ${used}/${c.meta} · Saldo: ${saldo}</span>
          </button>
        `;
      })
      .join('');

    updateQuantityControls();
  }

  function getSelectedComponentBalance() {
    const lot = getSelectedLot();
    if (!lot || !state.selectedComponent) return 0;
    const comp = lot.components.find((c) => c.name === state.selectedComponent);
    if (!comp) return 0;
    return Math.max(0, comp.meta - comp.sent - (comp.draft || 0));
  }

  function updateQuantityControls() {
    const input = el('quantityInput');
    const completeBtn = el('metaCompleteButton');
    const warning = el('quantityWarning');
    const addBtn = el('addTripItemButton');
    const saldo = getSelectedComponentBalance();

    if (completeBtn) {
      completeBtn.textContent = `✓ COMPLETAR SALDO (${saldo})`;
      completeBtn.disabled = saldo <= 0;
    }

    const qty = Math.max(0, parseInt(input?.value || '0', 10) || 0);
    if (input && String(qty) !== input.value) input.value = String(qty);

    const exceeds = saldo > 0 && qty > saldo;
    if (warning) {
      if (exceeds) {
        warning.textContent = `⚠️ Quantidade (${qty}) excede o saldo disponível (${saldo} paletes).`;
        warning.classList.add('visible');
      } else {
        warning.textContent = '';
        warning.classList.remove('visible');
      }
    }

    if (addBtn) {
      addBtn.disabled = !getSelectedLot() || !state.selectedComponent || qty <= 0 || exceeds;
    }
  }

  function handleAddTripItem() {
    const lot = getSelectedLot();
    const qty = Math.max(0, parseInt(el('quantityInput')?.value || '0', 10) || 0);
    const saldo = getSelectedComponentBalance();

    if (!lot || !state.selectedComponent || qty <= 0) return;
    if (saldo > 0 && qty > saldo) {
      showToast(`⚠️ Saldo máximo disponível: ${saldo} paletes.`);
      return;
    }

    const existing = state.tripItems.find(
      (i) => i.lotKey === lot.key && i.component === state.selectedComponent
    );
    if (existing) {
      existing.quantity += qty;
    } else {
      state.tripItems.push({
        id: `ITEM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        lotKey: lot.key,
        lotName: lot.name,
        model: lot.model,
        component: state.selectedComponent,
        quantity: qty
      });
    }

    if (el('quantityInput')) el('quantityInput').value = '0';
    saveLocalCache();
    renderOperation();
    showToast(`＋ ${qty} palete(s) de ${state.selectedComponent} adicionado(s) à carga.`);
  }

  function renderTripItems() {
    const list = el('tripItemsList');
    const summary = el('tripSummary');
    if (!list) return;

    const totalPallets = state.tripItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    if (summary) {
      summary.textContent = `${state.tripItems.length} ${state.tripItems.length === 1 ? 'item' : 'itens'} | ${totalPallets} paletes`;
    }

    if (!state.tripItems.length) {
      list.innerHTML = '<div class="empty-state">Nenhum material adicionado nesta viagem.</div>';
      return;
    }

    list.innerHTML = state.tripItems
      .map(
        (item, idx) => `
        <div class="trip-item">
          <div>
            <p class="trip-item-title">${escapeHtml(item.lotName)} — ${escapeHtml(item.component)}</p>
            <p class="trip-item-meta">${escapeHtml(item.model)} · <strong>${item.quantity} palete(s)</strong></p>
          </div>
          <button type="button" class="button button-danger" data-remove-trip="${idx}">Remover</button>
        </div>`
      )
      .join('');
  }

  function getActiveResources(type) {
    return (state.data.resources || []).filter((r) => {
      if (String(r.Tipo || '').toUpperCase() !== type) return false;
      if (String(r.Ativo || 'SIM').toUpperCase() === 'NAO') return false;
      if (state.activeShift === 'Geral') return true;
      const t = normTurn(r.Turno);
      return t === 'Geral' || t === 'TODOS' || t === state.activeShift;
    });
  }

  function renderDriversAndFleets() {
    const drivers = getActiveResources('MOTORISTA');
    const fleets = getActiveResources('FROTA');

    const driverSelect = el('driverInput');
    const fleetSelect = el('fleetInput');
    const driverChips = el('driverChips');
    const fleetChips = el('fleetChips');

    const prevDriver = driverSelect?.value || '';
    const prevFleet = fleetSelect?.value || '';

    if (driverSelect) {
      driverSelect.innerHTML = [
        '<option value="">Selecione o motorista…</option>',
        ...drivers.map((d) => `<option value="${escapeHtml(d.Nome)}">${escapeHtml(d.Nome)}</option>`)
      ].join('');
      if (prevDriver && drivers.some((d) => d.Nome === prevDriver)) driverSelect.value = prevDriver;
    }

    if (fleetSelect) {
      fleetSelect.innerHTML = [
        '<option value="">Selecione a frota…</option>',
        ...fleets.map((f) => `<option value="${escapeHtml(f.Nome)}">${escapeHtml(f.Nome)}</option>`)
      ].join('');
      if (prevFleet && fleets.some((f) => f.Nome === prevFleet)) fleetSelect.value = prevFleet;
    }

    if (driverChips) {
      driverChips.innerHTML = drivers
        .slice(0, 8)
        .map(
          (d) =>
            `<button type="button" class="chip ${driverSelect?.value === d.Nome ? 'selected' : ''}" data-pick-driver="${escapeHtml(d.Nome)}">${escapeHtml(d.Nome)}</button>`
        )
        .join('');
    }

    if (fleetChips) {
      fleetChips.innerHTML = fleets
        .slice(0, 8)
        .map(
          (f) =>
            `<button type="button" class="chip ${fleetSelect?.value === f.Nome ? 'selected' : ''}" data-pick-fleet="${escapeHtml(f.Nome)}">${escapeHtml(f.Nome)}</button>`
        )
        .join('');
    }
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const maxSide = 1024;
          let { width, height } = img;
          if (width > maxSide || height > maxSide) {
            if (width > height) {
              height = Math.round((height * maxSide) / width);
              width = maxSide;
            } else {
              width = Math.round((width * maxSide) / height);
              height = maxSide;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleSaveTrip() {
    if (!state.tripItems.length) {
      showToast('⚠️ Adicione pelo menos um material à carga antes de gravar.');
      return;
    }

    const driver = String(el('driverInput')?.value || '').trim();
    const fleet = String(el('fleetInput')?.value || '').trim();
    if (!driver || !fleet) {
      showToast('⚠️ Selecione o Motorista e a Frota.');
      return;
    }

    const btn = el('saveRecordButton');
    if (btn) btn.disabled = true;

    const now = new Date();
    const dateIso = todayIso(now);
    const timeStr = nowTimeStr(now);
    const tripId = `VGM-${Date.now()}`;
    const turno = state.activeShift === 'Geral' ? 'Turno B' : state.activeShift;

    const newRows = state.tripItems.map((item, idx) => ({
      ID_Apontamento: `${tripId}-${idx + 1}`,
      ID_Viagem: tripId,
      Data_Ref: dateIso,
      Hora_Ref: timeStr,
      DataHora: now.toISOString(),
      Turno: turno,
      Nome_Lote: item.lotName,
      Modelo_Base: item.model,
      Componente: item.component,
      Qtd_Enviada: Number(item.quantity),
      Motorista: driver,
      Frota: fleet,
      Operador: state.session?.name || 'Operador',
      Matricula: state.session?.matricula || '',
      Foto_Url: idx === 0 ? state.photoDataUrl : '',
      Status: 'ENTREGUE'
    }));

    try {
      const api = dbApi();
      if (api && typeof api.saveTrip === 'function') {
        await api.saveTrip(newRows);
      } else if (api && typeof api.createRecords === 'function') {
        await api.createRecords(newRows);
      }

      state.data.records.unshift(...newRows);
      const reportText = formatTransportReport({
        items: state.tripItems,
        driver,
        fleet,
        date: formatBrDate(dateIso),
        time: timeStr
      });

      state.tripItems = [];
      state.photoDataUrl = '';
      if (el('photoInput')) el('photoInput').value = '';
      if (el('photoPreview')) {
        el('photoPreview').src = '';
        el('photoPreview').classList.remove('visible');
      }
      if (el('removePhotoButton')) el('removePhotoButton').hidden = true;

      saveLocalCache();
      renderAll();
      showToast('✓ Viagem gravada com sucesso!');
      openWhatsAppWithText(reportText);
    } catch (err) {
      console.error(err);
      showToast(`⚠️ Erro ao gravar: ${err?.message || 'falha de rede'}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function handleShareCurrentDraft() {
    if (!state.tripItems.length) {
      showToast('⚠️ Adicione itens à carga para gerar o texto do WhatsApp.');
      return;
    }
    const driver = String(el('driverInput')?.value || '').trim();
    const fleet = String(el('fleetInput')?.value || '').trim();
    const text = formatTransportReport({
      items: state.tripItems,
      driver,
      fleet,
      date: formatBrDate(todayIso()),
      time: nowTimeStr()
    });
    openWhatsAppWithText(text);
  }

  function renderPendingLots(lots) {
    const container = el('pendingLotsList');
    if (!container) return;

    const pending = lots.filter((l) => {
      const sent = l.components.reduce((s, c) => s + c.sent, 0);
      return l.totalMeta === 0 || sent < l.totalMeta;
    });

    if (!pending.length) {
      container.innerHTML = '<div class="empty-state">Nenhum lote pendente no pátio.</div>';
      return;
    }

    container.innerHTML = pending
      .map(
        (lot) => `
        <div class="pending-lot">
          <p class="pending-lot-title">${escapeHtml(lot.name)} · ${escapeHtml(lot.model)}</p>
          ${lot.components
            .map((c) => {
              const pct = c.meta > 0 ? Math.min(100, Math.round((c.sent / c.meta) * 100)) : 0;
              const saldo = Math.max(0, c.meta - c.sent);
              return `
                <button type="button" class="pending-component" data-jump-lot="${escapeHtml(lot.key)}" data-jump-comp="${escapeHtml(c.name)}">
                  <div class="pending-component-meta">
                    <span>${escapeHtml(c.name)}</span>
                    <span>${c.sent}/${c.meta} (Saldo: ${saldo})</span>
                  </div>
                  <div class="pending-track"><span style="width:${pct}%"></span></div>
                </button>`;
            })
            .join('')}
        </div>`
      )
      .join('');
  }

  function renderShiftHistory() {
    const container = el('historyList');
    if (!container) return;

    const today = todayIso();
    const list = (state.data.records || []).filter((r) => {
      if (normRecordDate(r) !== today) return false;
      if (state.activeShift === 'Geral') return true;
      return normTurn(r.Turno) === state.activeShift;
    });

    if (!list.length) {
      container.innerHTML = '<div class="empty-state">Nenhuma viagem registrada hoje neste turno.</div>';
      return;
    }

    container.innerHTML = list
      .map((r) => {
        const isVoid = String(r.Status || '').toUpperCase() === 'ESTORNADO';
        const id = escapeHtml(r.ID_Apontamento);
        return `
          <div class="history-item">
            <div class="history-top">
              <div>
                <p class="history-name">${escapeHtml(r.Nome_Lote)} — ${escapeHtml(r.Componente)}</p>
                <p class="history-sub">${escapeHtml(String(r.Hora_Ref || '').slice(0, 8))} · Motorista: ${escapeHtml(r.Motorista)} · Frota: ${escapeHtml(r.Frota)}</p>
              </div>
              <div style="text-align:right">
                <span class="history-qty">${r.Qtd_Enviada} paletes</span><br>
                <span class="status-tag ${isVoid ? 'void' : 'ok'}">${isVoid ? 'ESTORNADO' : 'ENTREGUE'}</span>
              </div>
            </div>
            ${
              !isVoid
                ? `<div class="history-actions">
                    <button type="button" class="button button-cyan" data-share-record="${id}">📲 WhatsApp</button>
                    <button type="button" class="button button-ghost" data-edit-record="${id}">✏️ Editar</button>
                    <button type="button" class="button button-danger" data-void-record="${id}">Estornar</button>
                  </div>`
                : `<p class="history-sub" style="margin-top:6px">Motivo: ${escapeHtml(r.Motivo_Estorno || 'Não informado')}</p>`
            }
          </div>`;
      })
      .join('');
  }

  /* =========================================================
     MODAIS (NOVO LOTE, EDITAR, ESTORNAR)
     ========================================================= */
  function openNewBatchModal() {
    const catalog = getModelCatalog();
    const select = el('newLotModel');
    if (select) {
      select.innerHTML = Object.keys(catalog)
        .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
        .join('');
    }
    if (el('newLotName')) el('newLotName').value = '';
    el('batchModal')?.showModal();
  }

  async function handleCreateBatch(e) {
    e.preventDefault();
    const model = normModel(el('newLotModel')?.value);
    const name = String(el('newLotName')?.value || '').trim().toUpperCase();
    if (!model || !name) return;

    const turno = state.activeShift === 'Geral' ? 'Turno B' : state.activeShift;
    const lotObj = {
      Nome_Lote: name,
      Modelo_Base: model,
      Turno_Vinculado: turno,
      Criado_Por: state.session?.name || ''
    };

    try {
      const api = dbApi();
      if (api && typeof api.createLot === 'function') {
        await api.createLot(lotObj);
      }
      state.data.activeLots.push(lotObj);
      state.selectedLotKey = `${model}|${name.toLocaleLowerCase('pt-BR')}`;
      saveLocalCache();
      el('batchModal')?.close();
      renderAll();
      showToast(`✓ Lote ${name} (${model}) criado!`);
    } catch (err) {
      showToast(`⚠️ Erro ao criar lote: ${err?.message || 'falha'}`);
    }
  }

  async function handleDeleteBatch() {
    const lot = getSelectedLot();
    if (!lot || lot.hasRecords) return;
    if (!window.confirm(`Excluir o lote "${lot.name}" (${lot.model})?`)) return;

    try {
      const api = dbApi();
      if (api && typeof api.deleteLot === 'function') {
        await api.deleteLot(lot.name, lot.model);
      }
      state.data.activeLots = (state.data.activeLots || []).filter(
        (l) =>
          !(
            String(l.Nome_Lote || l.name).trim().toLocaleLowerCase('pt-BR') ===
              lot.name.toLocaleLowerCase('pt-BR') &&
            normModel(l.Modelo_Base || l.model) === lot.model
          )
      );
      state.selectedLotKey = '';
      saveLocalCache();
      renderAll();
      showToast('🗑️ Lote removido.');
    } catch (err) {
      showToast(`⚠️ Erro ao remover lote: ${err?.message || 'falha'}`);
    }
  }

  function openEditRecordModal(recordId) {
    const rec = (state.data.records || []).find((r) => String(r.ID_Apontamento) === String(recordId));
    if (!rec) return;

    const catalog = getModelCatalog();
    el('editRecordId').value = rec.ID_Apontamento;
    el('editLotName').value = rec.Nome_Lote || '';
    el('editQuantityInput').value = rec.Qtd_Enviada || 1;

    const modelSel = el('editModelSelect');
    modelSel.innerHTML = Object.keys(catalog)
      .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      .join('');
    modelSel.value = normModel(rec.Modelo_Base);

    populateEditComponents(modelSel.value, rec.Componente);

    const drivers = getActiveResources('MOTORISTA');
    const fleets = getActiveResources('FROTA');
    const dSel = el('editDriverInput');
    const fSel = el('editFleetInput');
    dSel.innerHTML = drivers.map((d) => `<option value="${escapeHtml(d.Nome)}">${escapeHtml(d.Nome)}</option>`).join('');
    if (!drivers.some((d) => d.Nome === rec.Motorista) && rec.Motorista) {
      dSel.innerHTML += `<option value="${escapeHtml(rec.Motorista)}">${escapeHtml(rec.Motorista)}</option>`;
    }
    dSel.value = rec.Motorista || '';

    fSel.innerHTML = fleets.map((f) => `<option value="${escapeHtml(f.Nome)}">${escapeHtml(f.Nome)}</option>`).join('');
    if (!fleets.some((f) => f.Nome === rec.Frota) && rec.Frota) {
      fSel.innerHTML += `<option value="${escapeHtml(rec.Frota)}">${escapeHtml(rec.Frota)}</option>`;
    }
    fSel.value = rec.Frota || '';

    el('editModal')?.showModal();
  }

  function populateEditComponents(modelKey, selectedComp = '') {
    const catalog = getModelCatalog();
    const comps = catalog[normModel(modelKey)]?.Componentes || [];
    const compSel = el('editComponentSelect');
    if (!compSel) return;
    compSel.innerHTML = comps
      .map((c) => `<option value="${escapeHtml(c.Nome)}">${escapeHtml(c.Nome)}</option>`)
      .join('');
    if (selectedComp && !comps.some((c) => c.Nome === selectedComp)) {
      compSel.innerHTML += `<option value="${escapeHtml(selectedComp)}">${escapeHtml(selectedComp)}</option>`;
    }
    if (selectedComp) compSel.value = selectedComp;
  }

  async function handleSaveEditRecord(e) {
    e.preventDefault();
    const id = el('editRecordId').value;
    const rec = (state.data.records || []).find((r) => String(r.ID_Apontamento) === String(id));
    if (!rec) return;

    const updates = {
      Nome_Lote: String(el('editLotName').value || '').trim().toUpperCase(),
      Modelo_Base: normModel(el('editModelSelect').value),
      Componente: String(el('editComponentSelect').value || '').trim(),
      Qtd_Enviada: Math.max(1, parseInt(el('editQuantityInput').value || '1', 10) || 1),
      Motorista: String(el('editDriverInput').value || '').trim(),
      Frota: String(el('editFleetInput').value || '').trim()
    };

    try {
      const api = dbApi();
      if (api && typeof api.updateRecord === 'function') {
        await api.updateRecord(id, updates);
      }
      Object.assign(rec, updates);
      saveLocalCache();
      el('editModal')?.close();
      renderAll();
      showToast('✓ Lançamento atualizado!');
    } catch (err) {
      showToast(`⚠️ Erro ao atualizar: ${err?.message || 'falha'}`);
    }
  }

  function openReverseModal(recordId) {
    el('reverseRecordId').value = recordId;
    el('reverseReasonInput').value = '';
    el('reverseModal')?.showModal();
  }

  async function handleReverseRecord(e) {
    e.preventDefault();
    const id = el('reverseRecordId').value;
    const reason = String(el('reverseReasonInput').value || '').trim();
    const rec = (state.data.records || []).find((r) => String(r.ID_Apontamento) === String(id));
    if (!rec || !reason) return;

    try {
      const api = dbApi();
      if (api && typeof api.reverseRecord === 'function') {
        await api.reverseRecord(id, reason);
      }
      rec.Status = 'ESTORNADO';
      rec.Motivo_Estorno = reason;
      saveLocalCache();
      el('reverseModal')?.close();
      renderAll();
      showToast('✓ Lançamento estornado.');
    } catch (err) {
      showToast(`⚠️ Erro ao estornar: ${err?.message || 'falha'}`);
    }
  }

  /* =========================================================
     ABA 2: INTEGRAÇÃO COM COCKPIT.JS
     ========================================================= */
  function updateCockpitModule() {
    if (!window.Cockpit || typeof window.Cockpit.update !== 'function') return;
    const lots = getConsolidatedLots();
    window.Cockpit.update(state.data.records || [], {
      models: state.data.models || DEFAULT_MODELS,
      activeLots: state.data.activeLots || [],
      progressLots: lots.map((l) => ({
        Nome_Lote: l.name,
        Modelo_Base: l.model,
        Turno_Vinculado: l.shift,
        Total_Meta: l.totalMeta,
        Itens: l.components.map((c) => ({
          Componente: c.name,
          Meta: c.meta,
          Enviado: c.sent
        }))
      })),
      coordinator: state.data.settings?.coordinator || 'Anderson Andrade',
      leadership: state.data.settings?.leadership || 'Daniela Menezes',
      operator: state.session?.name || 'Eric Miranda'
    });
  }

  /* =========================================================
     ABA 3: CADASTROS E CONFIGURAÇÕES
     ========================================================= */
  function renderSettings() {
    if (el('settingsApiUrl')) el('settingsApiUrl').value = state.data.settings?.apiUrl || '';
    if (el('settingsCoordinator')) el('settingsCoordinator').value = state.data.settings?.coordinator || 'Anderson Andrade';
    if (el('settingsLeadership')) el('settingsLeadership').value = state.data.settings?.leadership || 'Daniela Menezes';

    const catalog = getModelCatalog();
    const mSelect = el('settingsModelSelect');
    if (mSelect) {
      const prev = mSelect.value;
      mSelect.innerHTML = Object.keys(catalog)
        .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
        .join('');
      if (prev && catalog[prev]) mSelect.value = prev;
      renderModelEditor(mSelect.value);
    }

    renderResourcesList();
    renderUsersList();
  }

  function renderModelEditor(modelKey) {
    const editor = el('modelComponentsEditor');
    if (!editor) return;
    const catalog = getModelCatalog();
    const model = catalog[normModel(modelKey)];
    if (!model) {
      editor.innerHTML = '';
      return;
    }

    editor.innerHTML = `
      ${model.Componentes.map(
        (c, idx) => `
        <div class="model-editor-grid" data-comp-row="${idx}">
          <input class="control comp-name-input" type="text" value="${escapeHtml(c.Nome)}" placeholder="Nome do componente">
          <input class="control comp-meta-input" type="number" min="0" value="${Number(c.Meta) || 0}" placeholder="Meta">
        </div>`
      ).join('')}
      <button type="button" id="addComponentRowBtn" class="button button-ghost">＋ Adicionar Componente ao Modelo</button>
    `;

    el('addComponentRowBtn')?.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'model-editor-grid';
      row.innerHTML = `
        <input class="control comp-name-input" type="text" placeholder="Nome do novo componente">
        <input class="control comp-meta-input" type="number" min="0" value="0" placeholder="Meta">
      `;
      editor.insertBefore(row, el('addComponentRowBtn'));
    });
  }

  async function handleSaveModelTargets() {
    const modelKey = normModel(el('settingsModelSelect')?.value);
    const rows = [...document.querySelectorAll('#modelComponentsEditor .model-editor-grid')];
    const comps = rows
      .map((row) => ({
        Nome: String(row.querySelector('.comp-name-input')?.value || '').trim(),
        Meta: Math.max(0, parseInt(row.querySelector('.comp-meta-input')?.value || '0', 10) || 0)
      }))
      .filter((c) => c.Nome);

    if (!modelKey || !comps.length) return;
    const totalMeta = comps.reduce((s, c) => s + c.Meta, 0);
    const updatedModel = { Modelo_Base: modelKey, Total_Meta: totalMeta, Componentes: comps };

    try {
      const api = dbApi();
      if (api && typeof api.saveModel === 'function') {
        await api.saveModel(updatedModel);
      }
      const idx = state.data.models.findIndex((m) => normModel(m.Modelo_Base) === modelKey);
      if (idx >= 0) state.data.models[idx] = updatedModel;
      else state.data.models.push(updatedModel);

      saveLocalCache();
      renderAll();
      showToast(`✓ Metas do modelo ${modelKey} salvas (${totalMeta} paletes)!`);
    } catch (err) {
      showToast(`⚠️ Erro ao salvar modelo: ${err?.message || 'falha'}`);
    }
  }

  function renderResourcesList() {
    const list = el('resourcesList');
    if (!list) return;
    const filter = isAdminGeneral() ? (el('resourceShiftFilter')?.value || 'ALL') : state.activeShift;

    const items = (state.data.resources || []).filter((r) => {
      if (filter === 'ALL') return true;
      return normTurn(r.Turno) === filter;
    });

    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Nenhum motorista ou frota cadastrado.</div>';
      return;
    }

    list.innerHTML = items
      .map((r, idx) => {
        const active = String(r.Ativo || 'SIM').toUpperCase() !== 'NAO';
        const isFleet = String(r.Tipo || '').toUpperCase() === 'FROTA';
        return `
          <div class="user-row">
            <div>
              <p class="user-name">${escapeHtml(r.Nome)} <span class="role-tag ${isFleet ? 'fleet' : ''}">${escapeHtml(r.Tipo)}</span></p>
              <p class="user-detail">${escapeHtml(r.Turno || 'Turno B')}</p>
            </div>
            <div class="action-row">
              <span class="user-status ${active ? '' : 'inactive'}">${active ? 'ATIVO' : 'BLOQUEADO'}</span>
              <button type="button" class="button button-ghost" data-toggle-resource="${idx}">Alternar</button>
            </div>
          </div>`;
      })
      .join('');
  }

  async function handleSaveResource(e) {
    e.preventDefault();
    const type = String(el('resourceType')?.value || 'MOTORISTA').toUpperCase();
    const shift = isAdminGeneral() ? normTurn(el('resourceShift')?.value || 'Turno B') : state.activeShift;
    const name = String(el('resourceName')?.value || '').trim().toUpperCase();
    const active = String(el('resourceActive')?.value || 'SIM').toUpperCase();
    if (!name) return;

    const resObj = {
      ID: `RES-${Date.now()}`,
      Tipo: type,
      Turno: shift === 'Geral' ? 'Turno B' : shift,
      Nome: name,
      Ativo: active
    };

    try {
      const api = dbApi();
      if (api && typeof api.saveResource === 'function') {
        await api.saveResource(resObj);
      }
      state.data.resources.push(resObj);
      if (el('resourceName')) el('resourceName').value = '';
      saveLocalCache();
      renderAll();
      showToast(`✓ ${type} "${name}" cadastrado!`);
    } catch (err) {
      showToast(`⚠️ Erro ao cadastrar recurso: ${err?.message || 'falha'}`);
    }
  }

  function renderUsersList() {
    const list = el('usersList');
    if (!list) return;
    const filter = isAdminGeneral() ? (el('userShiftFilter')?.value || 'ALL') : state.activeShift;

    const items = (state.data.users || []).filter((u) => {
      if (filter === 'ALL') return true;
      const t = normTurn(u.Turno);
      return t === 'TODOS' || t === 'Geral' || t === filter;
    });

    if (!items.length) {
      list.innerHTML = '<div class="empty-state">Nenhum colaborador listado para este filtro.</div>';
      return;
    }

    list.innerHTML = items
      .map((u) => {
        const active = String(u.Ativo || 'SIM').toUpperCase() !== 'NAO';
        const isAdmin = String(u.Perfil || '').toUpperCase() === 'ADMIN_GERAL';
        return `
          <div class="user-row">
            <div>
              <p class="user-name">${escapeHtml(u.Nome)} <span class="role-tag ${isAdmin ? 'admin' : ''}">${escapeHtml(u.Perfil)}</span></p>
              <p class="user-detail">Matrícula: ${escapeHtml(u.Matricula)} · ${escapeHtml(u.Turno)}</p>
            </div>
            <span class="user-status ${active ? '' : 'inactive'}">${active ? 'ATIVO' : 'BLOQUEADO'}</span>
          </div>`;
      })
      .join('');
  }

  async function handleSaveUser(e) {
    e.preventDefault();
    const matricula = String(el('newUserMatricula')?.value || '').trim();
    const pin = String(el('newUserPin')?.value || '').trim();
    const name = String(el('newUserName')?.value || '').trim();
    const role = String(el('newUserRole')?.value || 'OPERADOR').toUpperCase();
    const shift = isAdminGeneral() ? String(el('newUserShift')?.value || 'Turno B') : state.activeShift;
    const active = String(el('newUserActive')?.value || 'SIM').toUpperCase();

    if (!matricula || !/^\d{4}$/.test(pin) || !name) {
      showToast('⚠️ Preencha matrícula, nome e PIN de 4 dígitos.');
      return;
    }

    const userObj = {
      Matricula: matricula,
      PIN: pin,
      Nome: name,
      Perfil: role,
      Turno: shift,
      Ativo: active
    };

    try {
      const api = dbApi();
      if (api && typeof api.saveUser === 'function') {
        await api.saveUser(userObj);
      }
      const idx = state.data.users.findIndex((u) => String(u.Matricula) === matricula);
      if (idx >= 0) state.data.users[idx] = userObj;
      else state.data.users.push(userObj);

      el('userForm')?.reset();
      saveLocalCache();
      renderSettings();
      showToast(`✓ Colaborador ${name} salvo!`);
    } catch (err) {
      showToast(`⚠️ Erro ao salvar usuário: ${err?.message || 'falha'}`);
    }
  }

  function renderAll() {
    renderOperation();
    updateCockpitModule();
    if (state.activeView === 'settings') renderSettings();
  }

  /* =========================================================
     EVENTOS GLOBAIS E INICIALIZAÇÃO
     ========================================================= */
  function bindEvents() {
    el('loginForm')?.addEventListener('submit', handleLogin);
    el('logoutButton')?.addEventListener('click', handleLogout);
    el('syncButton')?.addEventListener('click', () => syncData(false));

    el('generalShiftSelect')?.addEventListener('change', (e) => {
      state.activeShift = normTurn(e.target.value);
      renderAll();
    });

    document.querySelectorAll('.nav-button').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    el('activeLotSelect')?.addEventListener('change', (e) => {
      state.selectedLotKey = e.target.value;
      renderOperation();
    });

    el('newBatchButton')?.addEventListener('click', openNewBatchModal);
    el('deleteBatchButton')?.addEventListener('click', handleDeleteBatch);
    el('batchForm')?.addEventListener('submit', handleCreateBatch);

    el('componentGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.component-button');
      if (!btn || btn.disabled) return;
      state.selectedComponent = btn.dataset.comp;
      renderComponents(getSelectedLot());
    });

    document.querySelectorAll('.quantity-arrow, #quantitySteps .step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.dataset.step || '0', 10);
        const input = el('quantityInput');
        if (!input) return;
        const next = Math.max(0, (parseInt(input.value || '0', 10) || 0) + step);
        input.value = String(next);
        updateQuantityControls();
      });
    });

    el('quantityInput')?.addEventListener('input', updateQuantityControls);

    el('metaCompleteButton')?.addEventListener('click', () => {
      const saldo = getSelectedComponentBalance();
      if (el('quantityInput')) el('quantityInput').value = String(saldo);
      updateQuantityControls();
    });

    el('addTripItemButton')?.addEventListener('click', handleAddTripItem);

    el('tripItemsList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-trip]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.removeTrip, 10);
      state.tripItems.splice(idx, 1);
      saveLocalCache();
      renderOperation();
    });

    el('driverInput')?.addEventListener('change', renderDriversAndFleets);
    el('fleetInput')?.addEventListener('change', renderDriversAndFleets);

    el('driverChips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-pick-driver]');
      if (!chip) return;
      if (el('driverInput')) el('driverInput').value = chip.dataset.pickDriver;
      renderDriversAndFleets();
    });

    el('fleetChips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-pick-fleet]');
      if (!chip) return;
      if (el('fleetInput')) el('fleetInput').value = chip.dataset.pickFleet;
      renderDriversAndFleets();
    });

    el('photoInput')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        state.photoDataUrl = await compressImage(file);
        const preview = el('photoPreview');
        if (preview) {
          preview.src = state.photoDataUrl;
          preview.classList.add('visible');
        }
        if (el('removePhotoButton')) el('removePhotoButton').hidden = false;
      } catch (_) {
        showToast('⚠️ Não foi possível processar a imagem.');
      }
    });

    el('removePhotoButton')?.addEventListener('click', () => {
      state.photoDataUrl = '';
      if (el('photoInput')) el('photoInput').value = '';
      if (el('photoPreview')) {
        el('photoPreview').src = '';
        el('photoPreview').classList.remove('visible');
      }
      if (el('removePhotoButton')) el('removePhotoButton').hidden = true;
    });

    el('saveRecordButton')?.addEventListener('click', handleSaveTrip);
    el('shareCurrentButton')?.addEventListener('click', handleShareCurrentDraft);

    el('pendingLotsList')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-jump-lot]');
      if (!btn) return;
      state.selectedLotKey = btn.dataset.jumpLot;
      state.selectedComponent = btn.dataset.jumpComp;
      renderOperation();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    el('historyList')?.addEventListener('click', (e) => {
      const shareBtn = e.target.closest('[data-share-record]');
      if (shareBtn) {
        const id = shareBtn.dataset.shareRecord;
        const target = (state.data.records || []).find((r) => String(r.ID_Apontamento) === String(id));
        if (!target) return;
        const group = (state.data.records || []).filter(
          (r) =>
            String(r.Status || '').toUpperCase() !== 'ESTORNADO' &&
            (target.ID_Viagem ? r.ID_Viagem === target.ID_Viagem : r.ID_Apontamento === target.ID_Apontamento)
        );
        const text = formatTransportReport({
          items: group,
          driver: target.Motorista,
          fleet: target.Frota,
          date: formatBrDate(normRecordDate(target)),
          time: String(target.Hora_Ref || nowTimeStr()).slice(0, 8)
        });
        openWhatsAppWithText(text);
        return;
      }

      const editBtn = e.target.closest('[data-edit-record]');
      if (editBtn) {
        openEditRecordModal(editBtn.dataset.editRecord);
        return;
      }

      const voidBtn = e.target.closest('[data-void-record]');
      if (voidBtn) {
        openReverseModal(voidBtn.dataset.voidRecord);
      }
    });

    el('editModelSelect')?.addEventListener('change', (e) => {
      populateEditComponents(e.target.value);
    });
    el('editForm')?.addEventListener('submit', handleSaveEditRecord);
    el('reverseForm')?.addEventListener('submit', handleReverseRecord);

    // Cadastros & Governança
    el('governanceForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      state.data.settings = {
        apiUrl: String(el('settingsApiUrl')?.value || '').trim(),
        coordinator: String(el('settingsCoordinator')?.value || '').trim() || 'Anderson Andrade',
        leadership: String(el('settingsLeadership')?.value || '').trim() || 'Daniela Menezes'
      };
      const api = dbApi();
      if (api && typeof api.saveSettings === 'function') {
        await api.saveSettings(state.data.settings);
      }
      saveLocalCache();
      renderAll();
      showToast('✓ Governança salva!');
    });

    el('testConnectionButton')?.addEventListener('click', () => syncData(false));
    el('settingsModelSelect')?.addEventListener('change', (e) => renderModelEditor(e.target.value));
    el('loadModelButton')?.addEventListener('click', () => renderModelEditor(el('settingsModelSelect')?.value));
    el('saveModelButton')?.addEventListener('click', handleSaveModelTargets);

    el('resourceForm')?.addEventListener('submit', handleSaveResource);
    el('resourceShiftFilter')?.addEventListener('change', renderResourcesList);
    el('resourcesList')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-toggle-resource]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.toggleResource, 10);
      const item = state.data.resources[idx];
      if (!item) return;
      item.Ativo = String(item.Ativo || 'SIM').toUpperCase() === 'NAO' ? 'SIM' : 'NAO';
      const api = dbApi();
      if (api && typeof api.saveResource === 'function') {
        await api.saveResource(item);
      }
      saveLocalCache();
      renderAll();
    });

    el('userForm')?.addEventListener('submit', handleSaveUser);
    el('userShiftFilter')?.addEventListener('change', renderUsersList);

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => {
        el(btn.dataset.close)?.close();
      });
    });
  }

  function init() {
    loadLocalCache();
    bindEvents();

    try {
      const savedSession = localStorage.getItem(STORAGE_KEYS.SESSION);
      if (savedSession) {
        const parsed = JSON.parse(savedSession);
        if (parsed && parsed.matricula) {
          state.session = parsed;
          state.activeShift =
            parsed.role === 'ADMIN_GERAL'
              ? 'Turno B'
              : normTurn(parsed.shift || 'Turno B');
          el('loginView').hidden = true;
          el('appShell').hidden = false;
          applySessionPermissions();
          syncData(true);
          return;
        }
      }
    } catch (_) {}

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();