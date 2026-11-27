const DB = (() => {
  'use strict';

  // =========================================================================
  // 1. CONFIGURAÇÃO DO SUPABASE (TEMPO REAL + REST DIRETO)
  // =========================================================================
  const SUPABASE_URL = 'https://nsyrvgmdkdhznexbsqwz.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_5RdyvbPoKKpDgBMJEiNgcQ_bGxQ7yIz';
  const DEFAULT_API_URL = '';
  const LEGACY_DEAD_SCRIPT_ID = 'AKfycbxhdG44T6jX-f7_iH1xH28Q0lT-q0y8P1B-3l2gR9s2wK60';

  const CONFIG_KEY = 'byd_apps_script_url';
  const CACHE_KEY = 'byd_records_cache_v1';
  const RECORD_CACHE_KEY = 'TB_Apontamentos';
  const QUEUE_KEY = 'byd_pending_queue_v1';
  const SESSION_KEY = 'byd_session_v1';
  const LEGACY_SESSION_KEY = 'byd_auth_session_v1';
  const ADMIN_CACHE_KEY = 'byd_admin_cache_v1';
  const USER_CACHE_KEY = 'Config_Usuarios';
  const RESOURCE_CACHE_KEY = 'Cadastro_Recursos_Turno';
  const MODEL_CACHE_KEY = 'Cadastro_Modelos';
  const LOT_CACHE_KEY = 'Cadastro_Lista_Lotes';
  const LOCAL_LOTS_KEY = 'byd_lotes';
  const LEGACY_LOTS_KEY = 'byd_active_lots_v1';
  const LOT_PROGRESS_KEY = 'Progresso_Lotes';
  const SHIFT_CONTROL_CACHE_KEY = 'Controle_Turnos';

  const ALLOWED_ROLES = ['ADMIN_GERAL', 'LIDER_TURNO', 'SUPORTE_TURNO', 'OPERADOR'];

  const FALLBACK_SHIFT_CONTROLS = [
    { Turno: 'Turno A', Status: 'ABERTO', Atualizado_Por: 'Sistema', Atualizado_Em: '' },
    { Turno: 'Turno B', Status: 'ABERTO', Atualizado_Por: 'Sistema', Atualizado_Em: '' },
    { Turno: 'Turno C', Status: 'ABERTO', Atualizado_Por: 'Sistema', Atualizado_Em: '' }
  ];

  const FALLBACK_USERS = [
    { Matricula: '9165', Nome: 'Eric Miranda', PIN: '9165', Perfil: 'ADMIN_GERAL', Turno_Vinculado: 'TODOS', Ativo: 'SIM' },
    { Matricula: '1001', Nome: 'Admin Reserva', PIN: '1234', Perfil: 'ADMIN_GERAL', Turno_Vinculado: 'TODOS', Ativo: 'SIM' },
    { Matricula: '1002', Nome: 'Daniela Menezes', PIN: '2026', Perfil: 'LIDER_TURNO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { Matricula: '1003', Nome: 'Operador Pátio', PIN: '0000', Perfil: 'OPERADOR', Turno_Vinculado: 'Turno B', Ativo: 'SIM' }
  ];

  const FALLBACK_RESOURCES = [
    { ID_Recurso: 'seed-m1', Tipo: 'MOTORISTA', Nome: 'ANGELO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m2', Tipo: 'MOTORISTA', Nome: 'GENILSON', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m3', Tipo: 'MOTORISTA', Nome: 'ELIVALDO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m4', Tipo: 'MOTORISTA', Nome: 'JUCIE', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m5', Tipo: 'MOTORISTA', Nome: 'SIDNEI', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m6', Tipo: 'MOTORISTA', Nome: 'CLEITON', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m7', Tipo: 'MOTORISTA', Nome: 'EDVALDO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-m8', Tipo: 'MOTORISTA', Nome: 'CARLEUSON', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-f1', Tipo: 'FROTA', Nome: 'FROTA-17', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-f2', Tipo: 'FROTA', Nome: 'FROTA-19', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { ID_Recurso: 'seed-f3', Tipo: 'FROTA', Nome: 'REBOCADOR', Turno_Vinculado: 'Turno B', Ativo: 'SIM' }
  ];

  let supabaseClient = null;
  let realtimeChannel = null;
  let realtimeConnected = false;
  let realtimeDebounceTimer = null;
  let realtimePollingTimer = null;
  let lifecycleListenersBound = false;
  let lastRealtimeHandlers = { onSnapshotUpdate: null, onStatusChange: null };
  let syncInFlight = null;

  function hasValidSupabaseConfig() {
    const url = String(SUPABASE_URL || '').trim();
    const key = String(SUPABASE_ANON_KEY || '').trim();
    return url.startsWith('https://') && /^(eyJ|sb_publishable_)/.test(key);
  }

  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (!hasValidSupabaseConfig()) return null;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        },
        realtime: { params: { eventsPerSecond: 20 } }
      });
    } catch (_) {
      supabaseClient = null;
    }
    return supabaseClient;
  }

  function withTimeout(promise, ms = 7000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SUPABASE')), ms))
    ]);
  }

  async function restRequest(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 8000);
    try {
      const headers = {
        apikey: SUPABASE_ANON_KEY.trim(),
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      const response = await fetch(`${SUPABASE_URL.trim()}/rest/v1/${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      if (!response.ok) {
        const msg = (data && (data.message || data.details || data.hint)) || `HTTP ${response.status}`;
        throw new Error(msg);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  function isRealtimeConnected() {
    return realtimeConnected;
  }

  function getApiUrl() {
    const savedUrl = String(localStorage.getItem(CONFIG_KEY) || '').trim();
    if (savedUrl && savedUrl.includes(LEGACY_DEAD_SCRIPT_ID)) {
      localStorage.removeItem(CONFIG_KEY);
      return DEFAULT_API_URL;
    }
    return savedUrl || DEFAULT_API_URL;
  }

  function setApiUrl(url) {
    const value = String(url || '').trim();
    if (!value) {
      localStorage.removeItem(CONFIG_KEY);
      return;
    }
    localStorage.setItem(CONFIG_KEY, value);
  }

  function readArray(key, fallback = []) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function getCache() {
    return readArray(RECORD_CACHE_KEY, readArray(CACHE_KEY, []));
  }

  function setCache(records) {
    const value = Array.isArray(records) ? records : [];
    localStorage.setItem(CACHE_KEY, JSON.stringify(value));
    localStorage.setItem(RECORD_CACHE_KEY, JSON.stringify(value));
  }

  function getQueue() {
    return readArray(QUEUE_KEY, []);
  }

  function setQueue(queue) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(Array.isArray(queue) ? queue : []));
  }

  function apiError(message, code) {
    const error = new Error(message || 'Falha ao comunicar com o servidor.');
    error.code = code || 'SERVER_ERROR';
    return error;
  }

  function translateSupabaseError(err) {
    const msg = String((err && (err.message || err.details || err.hint)) || '');
    if (/invalid api key|jwt|apikey/i.test(msg)) {
      return apiError('Chave do Supabase inválida. Confira Project Settings > API Keys no painel.', 'CONFIG_REQUIRED');
    }
    if (/duplicate key|unique constraint/i.test(msg)) {
      return apiError('Registro duplicado no banco de dados.', 'DUPLICATE_MATRICULA');
    }
    if (/violates check constraint|violates foreign key|invalid input syntax/i.test(msg)) {
      return apiError(`Dados rejeitados pelo banco: ${msg}`, 'INVALID_INPUT');
    }
    if (/load failed|failed to fetch|networkerror|fetch|abort|timeout/i.test(msg)) {
      return apiError('Falha de rede ao conectar com o Supabase.', 'NETWORK_ERROR');
    }
    return apiError(msg || 'Erro no banco de dados Supabase.', 'SERVER_ERROR');
  }

  function isAuthorizationError(error) {
    return [
      'AUTH_REQUIRED', 'FORBIDDEN', 'SHIFT_CLOSED', 'INVALID_CREDENTIALS', 'INVALID_INPUT',
      'NOT_FOUND', 'INVALID_ACTION', 'DUPLICATE_MATRICULA', 'LAST_ADMIN', 'LOT_HAS_RECORDS', 'CONFIG_REQUIRED'
    ].includes(error.code);
  }

  // =========================================================================
  // 2. MAPEAMENTO DE LINHAS SQL <-> FORMATO DO APLICATIVO
  // =========================================================================
  function mapUserRow(row) {
    return {
      Matricula: String(row.matricula || row.Matricula || '').trim(),
      Nome: String(row.nome || row.Nome || '').trim(),
      PIN: String(row.pin || row.PIN || '').padStart(4, '0'),
      Perfil: String(row.perfil || row.Perfil || 'OPERADOR').toUpperCase(),
      Turno_Vinculado: String(row.turno_vinculado || row.Turno_Vinculado || 'Turno B'),
      Ativo: String(row.ativo || row.Ativo || 'SIM').toUpperCase()
    };
  }

  function mapResourceRow(row) {
    return {
      ID_Recurso: String(row.id || row.ID_Recurso || ''),
      Tipo: String(row.tipo || row.Tipo || 'MOTORISTA').toUpperCase(),
      Nome: String(row.nome || row.Nome || '').trim().toUpperCase(),
      Turno_Vinculado: String(row.turno_vinculado || row.Turno_Vinculado || 'Turno B'),
      Ativo: String(row.ativo || row.Ativo || 'SIM').toUpperCase(),
      Criado_Por: String(row.criado_por || row.Criado_Por || '')
    };
  }

  function mapModelRow(row) {
    const components = [
      { Nome: String(row.componente1 || '').trim(), Meta: Number(row.meta1) || 0 },
      { Nome: String(row.componente2 || '').trim(), Meta: Number(row.meta2) || 0 },
      { Nome: String(row.componente3 || '').trim(), Meta: Number(row.meta3) || 0 }
    ];
    if (String(row.componente4 || '').trim()) {
      components.push({ Nome: String(row.componente4).trim(), Meta: Number(row.meta4) || 0 });
    }
    return {
      Modelo_Base: String(row.modelo_base || '').trim(),
      Componentes: components,
      Total_Meta: Number(row.total_meta) || components.reduce((s, c) => s + c.Meta, 0)
    };
  }

  function mapLotRow(row) {
    return {
      ID_Lote: String(row.id_lote || row.ID_Lote || ''),
      Nome_Lote: String(row.nome_lote || row.Nome_Lote || '').trim(),
      Modelo_Base: String(row.modelo_base || row.Modelo_Base || '').trim(),
      Turno_Vinculado: String(row.turno_vinculado || row.Turno_Vinculado || 'Turno B'),
      Ativo: String(row.ativo || row.Ativo || 'SIM').toUpperCase(),
      Data_Criacao: String(row.data_criacao || row.Data_Criacao || '')
    };
  }

  function mapRecordRow(row) {
    return {
      ID_Apontamento: String(row.id_apontamento || row.ID_Apontamento || ''),
      ID_Viagem: String(row.id_viagem || row.ID_Viagem || ''),
      DataHora: String(row.data_hora || row.DataHora || ''),
      Data_Ref: String(row.data_ref || row.Data_Ref || ''),
      Hora_Ref: String(row.hora_ref || row.Hora_Ref || ''),
      Operador: String(row.operador || row.Operador || ''),
      Matricula_Operador: String(row.matricula_operador || row.Matricula_Operador || ''),
      Turno: String(row.turno || row.Turno || ''),
      Nome_Lote: String(row.nome_lote || row.Nome_Lote || ''),
      Modelo_Base: String(row.modelo_base || row.Modelo_Base || ''),
      Componente: String(row.componente || row.Componente || ''),
      Qtd_Enviada: Number(row.qtd_enviada ?? row.Qtd_Enviada) || 0,
      Motorista: String(row.motorista || row.Motorista || ''),
      Frota: String(row.frota || row.Frota || ''),
      Status: String(row.status || row.Status || 'ENTREGUE').toUpperCase(),
      Motivo_Estorno: String(row.motivo_estorno || row.Motivo_Estorno || ''),
      Observacao_Auditoria: String(row.observacao_auditoria || row.Observacao_Auditoria || '')
    };
  }

  function mapShiftControlRow(row) {
    const rawTurn = String(row.turno || row.Turno || '').trim();
    const key = rawTurn.replace(/^Turno\s+/i, '').trim().toUpperCase();
    const turno = ['A', 'B', 'C'].includes(key) ? `Turno ${key}` : (rawTurn || 'Turno B');
    const status = String(row.status || row.Status || 'ABERTO').trim().toUpperCase();
    return {
      Turno: turno,
      Status: status === 'ENCERRADO' ? 'ENCERRADO' : 'ABERTO',
      Atualizado_Por: String(row.atualizado_por || row.Atualizado_Por || '').trim(),
      Atualizado_Em: String(row.atualizado_em || row.Atualizado_Em || '').trim()
    };
  }

  function mergeShiftControls(rows) {
    const mapped = Array.isArray(rows) ? rows.map(mapShiftControlRow) : [];
    return ['Turno A', 'Turno B', 'Turno C'].map((turnName) => {
      const found = mapped.find((item) => item.Turno === turnName);
      return found || { Turno: turnName, Status: 'ABERTO', Atualizado_Por: 'Sistema', Atualizado_Em: '' };
    });
  }

  function getCachedShiftControls() {
    const cached = readArray(SHIFT_CONTROL_CACHE_KEY, []);
    return mergeShiftControls(cached.length ? cached : FALLBACK_SHIFT_CONTROLS);
  }

  function isShiftClosedForOperator(shiftName, controls = getCachedShiftControls()) {
    const key = turnKey(shiftName);
    if (!['A', 'B', 'C'].includes(key)) return false;
    const found = controls.find((item) => turnKey(item.Turno) === key);
    return Boolean(found && found.Status === 'ENCERRADO');
  }

  // =========================================================================
  // 3. SESSÃO E AUTENTICAÇÃO
  // =========================================================================
  function normalizeSession(source) {
    if (!source || typeof source !== 'object') return null;
    const user = source.user && typeof source.user === 'object' ? source.user : {};
    const matricula = String(source.Matricula || user.Matricula || '').trim();
    const nome = String(source.Nome || user.Nome || user.Nome_Completo || '').trim();
    let perfil = String(source.Perfil || user.Perfil || '').toUpperCase();
    if (perfil === 'ADMIN') perfil = ['9165', '1001'].includes(matricula) ? 'ADMIN_GERAL' : 'LIDER_TURNO';
    const normalizeTurn = (value) => {
      const turnValue = String(value || '').trim();
      if (/^TODOS$/i.test(turnValue)) return 'TODOS';
      if (/^GERAL$/i.test(turnValue)) return 'Geral';
      if (/^Turno\s+[ABC]$/i.test(turnValue)) return `Turno ${turnValue.slice(-1).toUpperCase()}`;
      if (/^[ABC]$/i.test(turnValue)) return `Turno ${turnValue.toUpperCase()}`;
      return turnValue || 'Turno B';
    };
    const linkedTurn = normalizeTurn(source.Turno_Vinculado || user.Turno_Vinculado || source.Turno);
    const turn = normalizeTurn(source.Turno || (perfil === 'ADMIN_GERAL' ? 'Turno B' : linkedTurn));
    return {
      ...source,
      Matricula: matricula,
      Nome: nome,
      Perfil: perfil,
      Turno: turn,
      Turno_Vinculado: linkedTurn,
      user: {
        ...user,
        Matricula: matricula,
        Nome: nome,
        Nome_Completo: nome,
        Perfil: perfil,
        Turno_Vinculado: linkedTurn,
        Ativo: String(source.Ativo || user.Ativo || 'SIM')
      }
    };
  }

  function getSession() {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) return normalizeSession(JSON.parse(stored));
      const legacy = sessionStorage.getItem(LEGACY_SESSION_KEY);
      if (!legacy) return null;
      const migrated = normalizeSession(JSON.parse(legacy));
      if (migrated) setSession(migrated);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      return migrated;
    } catch (_) {
      return null;
    }
  }

  function setSession(session) {
    const normalized = normalizeSession(session);
    if (!normalized) throw apiError('Sessão inválida.', 'AUTH_REQUIRED');
    localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    return normalized;
  }

  function clearSession() {
    stopRealtime();
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  }

  function getAdminCache() {
    try { return JSON.parse(localStorage.getItem(ADMIN_CACHE_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function setAdminCache(data) {
    localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(data || {}));
  }

  function getCachedUsers() {
    const cached = readArray(USER_CACHE_KEY, []);
    const source = cached.length ? cached : FALLBACK_USERS;
    return source.map(mapUserRow);
  }

  function getCachedResources() {
    const cached = readArray(RESOURCE_CACHE_KEY, []);
    const source = cached.length ? cached : FALLBACK_RESOURCES;
    return source.map(mapResourceRow);
  }

  async function refreshGasTokenSilently(matricula, pin, turno) {
    const url = getApiUrl();
    if (!url || !navigator.onLine) return '';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'login', Matricula: matricula, PIN: pin, Turno: turno }),
        redirect: 'follow'
      });
      if (!response.ok) return '';
      const result = await response.json();
      if (result && result.token) {
        const current = getSession();
        if (current && current.Matricula === matricula) {
          setSession({ ...current, gasToken: result.token });
        }
        return result.token;
      }
    } catch (_) {}
    return '';
  }

  function authenticateLocal(matricula, pin, turno) {
    const local = getCachedUsers().find((u) => u.Matricula === matricula && u.PIN === pin && u.Ativo === 'SIM');
    if (!local) throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');
    if (!ALLOWED_ROLES.includes(local.Perfil)) {
      throw apiError('Perfil sem permissão de acesso.', 'FORBIDDEN');
    }
    const selectedTurn = local.Perfil === 'ADMIN_GERAL' ? turno : local.Turno_Vinculado;
    return {
      token: `offline-${matricula}-${Date.now()}`,
      localFallback: true,
      expiresIn: 8 * 3600,
      Matricula: local.Matricula,
      Nome: local.Nome,
      Perfil: local.Perfil,
      Turno: selectedTurn,
      Turno_Vinculado: local.Turno_Vinculado,
      user: local
    };
  }

  async function fetchUserRowRemote(matricula) {
    const sb = getSupabase();
    if (sb) {
      try {
        const { data, error } = await withTimeout(
          sb.from('usuarios').select('*').eq('matricula', matricula).maybeSingle(),
          6000
        );
        if (error) throw error;
        return data;
      } catch (_) {}
    }
    const rows = await restRequest(`usuarios?select=*&matricula=eq.${encodeURIComponent(matricula)}&limit=1`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async function authenticate(credentials) {
    const matricula = String(credentials.Matricula || '').trim();
    const pin = String(credentials.PIN === null || credentials.PIN === undefined ? '' : credentials.PIN).trim();
    const turno = String(credentials.Turno || 'Turno B').trim();

    if (!navigator.onLine) {
      return authenticateLocal(matricula, pin, turno);
    }

    try {
      const data = await fetchUserRowRemote(matricula);
      if (!data) throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');

      const user = mapUserRow(data);
      if (user.PIN !== pin || user.Ativo !== 'SIM') {
        throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');
      }
      if (!ALLOWED_ROLES.includes(user.Perfil)) {
        throw apiError('Perfil sem permissão de acesso.', 'FORBIDDEN');
      }
      const selectedTurn = user.Perfil === 'ADMIN_GERAL' ? turno : user.Turno_Vinculado;
      if (getApiUrl()) {
        refreshGasTokenSilently(matricula, pin, selectedTurn);
      }

      return {
        token: `sb-${matricula}-${Date.now()}`,
        expiresIn: 12 * 3600,
        Matricula: user.Matricula,
        Nome: user.Nome,
        Perfil: user.Perfil,
        Turno: selectedTurn,
        Turno_Vinculado: user.Turno_Vinculado,
        user
      };
    } catch (err) {
      if (isAuthorizationError(err)) throw err;
      const translated = translateSupabaseError(err);
      if (translated.code === 'NETWORK_ERROR') {
        return authenticateLocal(matricula, pin, turno);
      }
      throw translated;
    }
  }

  // =========================================================================
  // 4. ESPELHO OPCIONAL PARA GOOGLE SHEETS (SOMENTE SE CONFIGURADO)
  // =========================================================================
  async function mirrorToSheets(payload) {
    const url = getApiUrl();
    if (!url || !navigator.onLine) return false;
    const session = getSession();
    if (!session) return false;

    let gasToken = session.gasToken || '';
    if (!gasToken) {
      const cachedUser = getCachedUsers().find((u) => u.Matricula === session.Matricula);
      if (cachedUser && cachedUser.PIN) {
        gasToken = await refreshGasTokenSilently(session.Matricula, cachedUser.PIN, session.Turno);
      }
    }
    if (!gasToken) return false;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, _sessionToken: gasToken, _queuedBy: session.Matricula }),
        redirect: 'follow'
      });
      if (!response.ok) return false;
      const result = await response.json();
      if (result && result.ok !== false && result.status !== 'error') {
        markSheetsSyncedInSupabase(payload);
        return true;
      }
    } catch (_) {}
    return false;
  }

  async function markSheetsSyncedInSupabase(payload) {
    try {
      if (['criar_viagem', 'criar_apontamento'].includes(payload.action) && Array.isArray(payload.itens)) {
        const ids = payload.itens.map((i) => i.ID_Apontamento).filter(Boolean);
        if (ids.length) {
          await restRequest(`apontamentos?id_apontamento=in.(${ids.map(encodeURIComponent).join(',')})`, {
            method: 'PATCH',
            body: { sheets_synced: true }
          });
        }
      } else if (['editar_apontamento', 'reverse', 'estornar_apontamento'].includes(payload.action) && payload.ID_Apontamento) {
        await restRequest(`apontamentos?id_apontamento=eq.${encodeURIComponent(payload.ID_Apontamento)}`, {
          method: 'PATCH',
          body: { sheets_synced: true }
        });
      } else if (['salvar_lote', 'criar_lote'].includes(payload.action) && payload.ID_Lote) {
        await restRequest(`lotes?id_lote=eq.${encodeURIComponent(payload.ID_Lote)}`, {
          method: 'PATCH',
          body: { sheets_synced: true }
        });
      }
    } catch (_) {}
  }

  // =========================================================================
  // 5. OPERAÇÕES DE ESCRITA NO SUPABASE (REST DIRETO) + FILA OFFLINE
  // =========================================================================
  function assertPermission(session, checkFn, message = 'Seu perfil não tem permissão para esta ação.') {
    if (!session) throw apiError('Faça login para continuar.', 'AUTH_REQUIRED');
    if (!checkFn()) throw apiError(message, 'FORBIDDEN');
  }

  function turnKey(value) {
    return String(value || '').replace(/^Turno\s+/i, '').trim().toUpperCase();
  }

  function normalizeShiftForSql(value) {
    const key = turnKey(value);
    if (key === 'A') return 'Turno A';
    if (key === 'B') return 'Turno B';
    if (key === 'C') return 'Turno C';
    return 'Turno B';
  }

  async function assertShiftOpenForOperator(session, targetShift, checkRemote = true) {
    if (String(session.Perfil || '').toUpperCase() !== 'OPERADOR') return;
    const shiftToCheck = normalizeShiftForSql(targetShift || session.Turno || session.Turno_Vinculado);
    let controls = getCachedShiftControls();
    if (checkRemote && navigator.onLine && hasValidSupabaseConfig()) {
      try {
        const remote = await restRequest('controle_turnos?select=*');
        controls = mergeShiftControls(remote);
        localStorage.setItem(SHIFT_CONTROL_CACHE_KEY, JSON.stringify(controls));
      } catch (_) {}
    }
    if (isShiftClosedForOperator(shiftToCheck, controls)) {
      throw apiError(
        `${shiftToCheck} encerrado pela liderança. Lançamentos bloqueados para operadores.`,
        'SHIFT_CLOSED'
      );
    }
  }

  async function executeSupabaseWrite(payload, session) {
    if (!hasValidSupabaseConfig()) {
      throw apiError('Configuração do Supabase ausente.', 'CONFIG_REQUIRED');
    }

    const role = String(session.Perfil || '').toUpperCase();
    const isAdmin = role === 'ADMIN_GERAL';
    const isLeader = role === 'LIDER_TURNO';
    const isSupport = role === 'SUPORTE_TURNO';

    try {
      if (payload.action === 'test_connection') {
        await restRequest('usuarios?select=matricula&limit=1');
        const mirrored = await mirrorToSheets({ action: 'test_connection' });
        return {
          ok: true,
          message: mirrored
            ? 'Supabase + Espelho Google Sheets conectados com sucesso!'
            : 'Supabase conectado e sincronizado com sucesso!'
        };
      }

      if (payload.action === 'alterar_status_turno') {
        assertPermission(
          session,
          () => isAdmin || isLeader || isSupport,
          'Apenas Liderança, Suporte ou Admin Geral podem abrir ou encerrar turnos.'
        );
        const targetTurn = normalizeShiftForSql(payload.Turno || session.Turno);
        const nextStatus = String(payload.Status || '').trim().toUpperCase();
        if (!['ABERTO', 'ENCERRADO'].includes(nextStatus)) {
          throw apiError('Status de turno inválido.', 'INVALID_INPUT');
        }
        if ((isLeader || isSupport) && turnKey(targetTurn) !== turnKey(session.Turno_Vinculado)) {
          throw apiError('Você só pode abrir ou encerrar o seu próprio turno.', 'FORBIDDEN');
        }

        const nowIso = new Date().toISOString();
        const actor = `${session.Nome} (${session.Matricula})`;
        await restRequest('controle_turnos?on_conflict=turno', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: {
            turno: targetTurn,
            status: nextStatus,
            atualizado_por: actor,
            atualizado_em: nowIso
          }
        });

        const allControls = await restRequest('controle_turnos?select=*&order=turno.asc');
        const mergedControls = mergeShiftControls(allControls);
        localStorage.setItem(SHIFT_CONTROL_CACHE_KEY, JSON.stringify(mergedControls));

        return {
          ok: true,
          mensagem: nextStatus === 'ENCERRADO'
            ? `🔒 ${targetTurn} encerrado! Operadores bloqueados.`
            : `🔓 ${targetTurn} aberto! Operadores liberados.`,
          shiftControls: mergedControls
        };
      }

      if (['criar_viagem', 'criar_apontamento'].includes(payload.action)) {
        const sourceItems = Array.isArray(payload.itens) ? payload.itens : [payload];
        const firstTurn = sourceItems[0]?.Turno || session.Turno;
        await assertShiftOpenForOperator(session, firstTurn, true);

        const rows = sourceItems.map((item) => ({
          id_apontamento: String(item.ID_Apontamento),
          id_viagem: String(item.ID_Viagem || payload.ID_Viagem || ''),
          data_hora: item.DataHora || new Date().toISOString(),
          data_ref: String(item.Data_Ref),
          hora_ref: String(item.Hora_Ref),
          operador: String(item.Operador || session.Nome),
          matricula_operador: String(session.Matricula || ''),
          turno: normalizeShiftForSql(item.Turno),
          nome_lote: String(item.Nome_Lote),
          modelo_base: String(item.Modelo_Base),
          componente: String(item.Componente),
          qtd_enviada: Number(item.Qtd_Enviada),
          motorista: String(item.Motorista).trim().toUpperCase(),
          frota: String(item.Frota).trim().toUpperCase(),
          status: 'ENTREGUE',
          motivo_estorno: '',
          observacao_auditoria: ''
        }));
        await restRequest('apontamentos?on_conflict=id_apontamento', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: rows
        });
        mirrorToSheets(payload);
        return { ok: true };
      }

      if (payload.action === 'editar_apontamento') {
        await restRequest(`apontamentos?id_apontamento=eq.${encodeURIComponent(String(payload.ID_Apontamento))}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: {
            nome_lote: String(payload.Nome_Lote),
            modelo_base: String(payload.Modelo_Base),
            componente: String(payload.Componente),
            qtd_enviada: Number(payload.Qtd_Enviada),
            motorista: String(payload.Motorista).trim().toUpperCase(),
            frota: String(payload.Frota).trim().toUpperCase(),
            observacao_auditoria: `Editado por ${session.Nome} (${session.Matricula}) em ${new Date().toLocaleString('pt-BR')}`
          }
        });
        mirrorToSheets(payload);
        return { ok: true };
      }

      if (['reverse', 'estornar_apontamento'].includes(payload.action)) {
        await restRequest(`apontamentos?id_apontamento=eq.${encodeURIComponent(String(payload.ID_Apontamento))}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: {
            status: 'ESTORNADO',
            motivo_estorno: String(payload.Motivo_Estorno),
            observacao_auditoria: `Estornado por ${session.Nome} (${session.Matricula}) em ${new Date().toLocaleString('pt-BR')}`
          }
        });
        mirrorToSheets(payload);
        return { ok: true };
      }

      if (['salvar_lote', 'criar_lote'].includes(payload.action)) {
        await assertShiftOpenForOperator(session, payload.Turno_Vinculado || session.Turno, true);
        const row = {
          id_lote: String(payload.ID_Lote),
          nome_lote: String(payload.Nome_Lote).trim(),
          modelo_base: String(payload.Modelo_Base).trim(),
          turno_vinculado: normalizeShiftForSql(payload.Turno_Vinculado),
          ativo: 'SIM',
          data_criacao: payload.Data_Criacao || new Date().toISOString()
        };
        await restRequest('lotes?on_conflict=id_lote', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: row
        });
        mirrorToSheets(payload);
        return { ok: true };
      }

      if (['excluir_lote', 'deletar_lote'].includes(payload.action)) {
        await assertShiftOpenForOperator(session, session.Turno, true);
        const query = payload.ID_Lote
          ? `lotes?id_lote=eq.${encodeURIComponent(String(payload.ID_Lote))}`
          : `lotes?nome_lote=eq.${encodeURIComponent(String(payload.Nome_Lote))}&modelo_base=eq.${encodeURIComponent(String(payload.Modelo_Base))}`;
        await restRequest(query, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
        mirrorToSheets(payload);
        return { ok: true };
      }

      if (payload.action === 'salvar_modelo') {
        assertPermission(session, () => isAdmin, 'Somente ADMIN_GERAL pode alterar modelos e metas.');
        const c = payload.Componentes || [];
        const row = {
          modelo_base: String(payload.Modelo_Base).trim(),
          componente1: c[0]?.Nome || '',
          meta1: Number(c[0]?.Meta) || 0,
          componente2: c[1]?.Nome || '',
          meta2: Number(c[1]?.Meta) || 0,
          componente3: c[2]?.Nome || '',
          meta3: Number(c[2]?.Meta) || 0,
          componente4: c[3]?.Nome || '',
          meta4: Number(c[3]?.Meta) || 0,
          total_meta: Number(payload.Total_Meta) || 0,
          updated_at: new Date().toISOString()
        };
        await restRequest('modelos?on_conflict=modelo_base', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: row
        });
        mirrorToSheets(payload);
        return { ok: true };
      }

      if (payload.action === 'salvar_usuario') {
        assertPermission(session, () => isAdmin || isLeader);
        const original = String(payload.Matricula_Original || '').trim();
        const targetMatricula = String(payload.Matricula || '').trim();
        const targetPerfil = String(payload.Perfil || 'OPERADOR').toUpperCase();
        const targetTurno = targetPerfil === 'ADMIN_GERAL' ? 'TODOS' : normalizeShiftForSql(payload.Turno_Vinculado);
        const targetAtivo = String(payload.Ativo || 'SIM').toUpperCase();

        if (!ALLOWED_ROLES.includes(targetPerfil)) {
          throw apiError('Perfil de acesso inválido.', 'INVALID_INPUT');
        }

        if (isLeader) {
          if (!['OPERADOR', 'SUPORTE_TURNO'].includes(targetPerfil) || turnKey(targetTurno) !== turnKey(session.Turno_Vinculado)) {
            throw apiError('Líder de turno só pode cadastrar ou editar OPERADOR ou SUPORTE_TURNO do seu próprio turno.', 'FORBIDDEN');
          }
        }

        if (original && original !== targetMatricula) {
          const conflicts = await restRequest(`usuarios?select=matricula&matricula=eq.${encodeURIComponent(targetMatricula)}&limit=1`);
          if (Array.isArray(conflicts) && conflicts.length) {
            throw apiError('Matrícula já cadastrada para outro funcionário.', 'DUPLICATE_MATRICULA');
          }
          await restRequest(`usuarios?matricula=eq.${encodeURIComponent(original)}`, { method: 'DELETE' });
        }

        const row = {
          matricula: targetMatricula,
          nome: String(payload.Nome || '').trim(),
          pin: String(payload.PIN || '').trim(),
          perfil: targetPerfil,
          turno_vinculado: targetTurno,
          ativo: targetAtivo
        };
        await restRequest('usuarios?on_conflict=matricula', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: row
        });

        mirrorToSheets(payload);
        const allUsers = await restRequest('usuarios?select=*&order=nome.asc');
        const mappedUsers = Array.isArray(allUsers) ? allUsers.map(mapUserRow) : [];
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(mappedUsers));

        return {
          ok: true,
          mensagem: 'Funcionário salvo e sincronizado.',
          users: mappedUsers,
          sessionRevoked: targetMatricula === session.Matricula && targetAtivo !== 'SIM'
        };
      }

      if (['excluir_usuario', 'deletar_usuario'].includes(payload.action)) {
        assertPermission(session, () => isAdmin, 'Somente ADMIN_GERAL pode remover usuários.');
        const targetMatricula = String(payload.Matricula || '').trim();
        if (!targetMatricula || targetMatricula === session.Matricula) {
          throw apiError('Não é permitido excluir o usuário atualmente logado.', 'FORBIDDEN');
        }
        await restRequest(`usuarios?matricula=eq.${encodeURIComponent(targetMatricula)}`, { method: 'DELETE' });
        const allUsers = await restRequest('usuarios?select=*&order=nome.asc');
        const mappedUsers = Array.isArray(allUsers) ? allUsers.map(mapUserRow) : [];
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(mappedUsers));
        return { ok: true, users: mappedUsers };
      }

      if (payload.action === 'salvar_recurso') {
        assertPermission(session, () => isAdmin || isLeader);
        const tipo = String(payload.Tipo || 'MOTORISTA').toUpperCase();
        const nome = String(payload.Nome || '').trim().toUpperCase();
        const ativo = String(payload.Ativo || 'SIM').toUpperCase();
        const rawTurno = isLeader ? session.Turno_Vinculado : String(payload.Turno_Vinculado || 'Turno B');
        const turno = turnKey(rawTurno) === 'TODOS' ? 'TODOS' : normalizeShiftForSql(rawTurno);

        if (!nome || !['MOTORISTA', 'FROTA'].includes(tipo)) {
          throw apiError('Informe um tipo e nome válidos.', 'INVALID_INPUT');
        }

        if (payload.ID_Recurso && !String(payload.ID_Recurso).startsWith('seed-')) {
          if (isLeader) {
            const existing = await restRequest(`recursos_turno?select=turno_vinculado&id=eq.${encodeURIComponent(payload.ID_Recurso)}&limit=1`);
            if (Array.isArray(existing) && existing[0] && turnKey(existing[0].turno_vinculado) !== turnKey(session.Turno_Vinculado)) {
              throw apiError('Você só pode editar motoristas e frotas do seu próprio turno.', 'FORBIDDEN');
            }
          }
          await restRequest(`recursos_turno?id=eq.${encodeURIComponent(payload.ID_Recurso)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: { tipo, nome, turno_vinculado: turno, ativo }
          });
        } else {
          const dup = await restRequest(
            `recursos_turno?select=id&tipo=eq.${encodeURIComponent(tipo)}&nome=ilike.${encodeURIComponent(nome)}&turno_vinculado=eq.${encodeURIComponent(turno)}&limit=1`
          );
          if (Array.isArray(dup) && dup.length) {
            await restRequest(`recursos_turno?id=eq.${encodeURIComponent(dup[0].id)}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: { ativo, nome }
            });
          } else {
            await restRequest('recursos_turno', {
              method: 'POST',
              headers: { Prefer: 'return=minimal' },
              body: { tipo, nome, turno_vinculado: turno, ativo, criado_por: String(session.Matricula || '') }
            });
          }
        }

        const allResources = await restRequest('recursos_turno?select=*&order=nome.asc');
        const mapped = Array.isArray(allResources) ? allResources.map(mapResourceRow) : [];
        localStorage.setItem(RESOURCE_CACHE_KEY, JSON.stringify(mapped));
        return { ok: true, mensagem: 'Cadastro atualizado e sincronizado.', resources: mapped };
      }

      if (payload.action === 'excluir_recurso') {
        assertPermission(session, () => isAdmin || isLeader);
        if (isLeader) {
          const existing = await restRequest(`recursos_turno?select=turno_vinculado&id=eq.${encodeURIComponent(payload.ID_Recurso)}&limit=1`);
          if (Array.isArray(existing) && existing[0] && turnKey(existing[0].turno_vinculado) !== turnKey(session.Turno_Vinculado)) {
            throw apiError('Você só pode remover cadastros do seu próprio turno.', 'FORBIDDEN');
          }
        }
        await restRequest(`recursos_turno?id=eq.${encodeURIComponent(String(payload.ID_Recurso))}`, { method: 'DELETE' });
        const allResources = await restRequest('recursos_turno?select=*&order=nome.asc');
        const mapped = Array.isArray(allResources) ? allResources.map(mapResourceRow) : [];
        localStorage.setItem(RESOURCE_CACHE_KEY, JSON.stringify(mapped));
        return { ok: true, resources: mapped };
      }

      throw apiError(`Ação desconhecida: ${payload.action}`, 'INVALID_ACTION');
    } catch (error) {
      if (isAuthorizationError(error)) throw error;
      throw translateSupabaseError(error);
    }
  }

  function enqueue(payload) {
    const session = getSession();
    const queueItem = { ...payload };
    delete queueItem._sessionToken;
    if (!queueItem._queuedBy && session && session.Matricula) {
      queueItem._queuedBy = String(session.Matricula);
    }
    const queue = getQueue();
    const id = queueItem.ID_Apontamento || queueItem.ID_Lote || queueItem.ID_Viagem || queueItem.ID_Recurso;
    if (id && !['editar_apontamento', 'reverse', 'estornar_apontamento', 'salvar_recurso'].includes(queueItem.action)) {
      const sameItem = queue.some((item) =>
        (item.ID_Apontamento || item.ID_Lote || item.ID_Viagem || item.ID_Recurso) === id && item.action === queueItem.action
      );
      if (sameItem) return;
    }
    queue.push(queueItem);
    setQueue(queue);
  }

  async function sendOrQueue(payload) {
    const activeSession = getSession();
    if (!activeSession) throw apiError('Faça login para continuar.', 'AUTH_REQUIRED');

    if (['criar_viagem', 'criar_apontamento', 'salvar_lote', 'criar_lote', 'excluir_lote', 'deletar_lote'].includes(payload.action)) {
      const targetTurn = payload.Turno_Vinculado || (Array.isArray(payload.itens) && payload.itens[0]?.Turno) || activeSession.Turno;
      await assertShiftOpenForOperator(activeSession, targetTurn, false);
    }

    if (!navigator.onLine) {
      enqueue(payload);
      throw apiError('Sem internet. Salvo na fila offline para envio automático ao reconectar.', 'NETWORK_ERROR');
    }

    try {
      return await executeSupabaseWrite(payload, activeSession);
    } catch (error) {
      if (error.code === 'NETWORK_ERROR') {
        enqueue(payload);
      }
      throw error;
    }
  }

  async function syncQueue() {
    const queue = getQueue();
    const session = getSession();
    if (!queue.length || !session || !navigator.onLine) return 0;

    const remaining = [];
    let sent = 0;
    for (let index = 0; index < queue.length; index++) {
      const payload = queue[index];
      try {
        await executeSupabaseWrite(payload, session);
        sent++;
      } catch (error) {
        if (['INVALID_ACTION', 'NOT_FOUND', 'INVALID_INPUT', 'DUPLICATE_MATRICULA', 'SHIFT_CLOSED'].includes(error.code)) {
          continue;
        }
        if (isAuthorizationError(error)) {
          setQueue(remaining.concat(queue.slice(index)));
          throw error;
        }
        remaining.push(payload);
      }
    }
    setQueue(remaining);
    return sent;
  }

  // =========================================================================
  // 6. LEITURA SINCRONIZADA DO SUPABASE + REALTIME / POLLING SILENCIOSO
  // =========================================================================
  function normalizeLotRowLocal(lot) {
    const source = lot || {};
    return {
      ...source,
      ID_Lote: String(source.ID_Lote || source.id || ''),
      Nome_Lote: String(source.Nome_Lote || source.name || '').trim(),
      Modelo_Base: String(source.Modelo_Base || source.model || '').trim(),
      Turno_Vinculado: source.Turno_Vinculado || source.shift || '',
      Ativo: String(source.Ativo || 'SIM').trim().toUpperCase(),
      Data_Criacao: source.Data_Criacao || source.createdAt || ''
    };
  }

  function sameLot(left, right) {
    if (left.ID_Lote && right.ID_Lote && left.ID_Lote === right.ID_Lote) return true;
    return left.Nome_Lote.toLocaleLowerCase('pt-BR') === right.Nome_Lote.toLocaleLowerCase('pt-BR') &&
      left.Modelo_Base.toUpperCase() === right.Modelo_Base.toUpperCase();
  }

  function removeLotFromLocal(lot) {
    const target = normalizeLotRowLocal(lot);
    const filterList = (list) => list.filter((item) => !sameLot(normalizeLotRowLocal(item), target));
    localStorage.setItem(LOT_CACHE_KEY, JSON.stringify(filterList(readArray(LOT_CACHE_KEY, []))));
    localStorage.setItem(LOCAL_LOTS_KEY, JSON.stringify(filterList(readArray(LOCAL_LOTS_KEY, []))));
    localStorage.setItem(LEGACY_LOTS_KEY, JSON.stringify(filterList(readArray(LEGACY_LOTS_KEY, []))));
    localStorage.setItem(LOT_PROGRESS_KEY, JSON.stringify(filterList(readArray(LOT_PROGRESS_KEY, []))));
    setQueue(getQueue().filter((item) => {
      if (!['criar_lote', 'salvar_lote'].includes(item.action)) return true;
      return !sameLot(normalizeLotRowLocal(item), target);
    }));
  }

  function offlineSnapshot() {
    return {
      Config_Usuarios: getCachedUsers(),
      Cadastro_Recursos_Turno: getCachedResources(),
      Cadastro_Modelos: readArray(MODEL_CACHE_KEY, []),
      Cadastro_Lista_Lotes: readArray(LOT_CACHE_KEY, []),
      Progresso_Lotes: readArray(LOT_PROGRESS_KEY, []),
      TB_Apontamentos: getCache(),
      Controle_Turnos: getCachedShiftControls(),
      offline: true
    };
  }

  async function sincronizarLeitura() {
    if (syncInFlight) return syncInFlight;

    syncInFlight = (async () => {
      if (!navigator.onLine || !hasValidSupabaseConfig()) {
        return offlineSnapshot();
      }

      try {
        const shiftControlsPromise = restRequest('controle_turnos?select=*&order=turno.asc').catch(() => null);
        const shiftControlsRaw = await shiftControlsPromise;
        const shiftControls = shiftControlsRaw
          ? mergeShiftControls(shiftControlsRaw)
          : getCachedShiftControls();
        localStorage.setItem(SHIFT_CONTROL_CACHE_KEY, JSON.stringify(shiftControls));

        if (getQueue().length) {
          await syncQueue().catch(() => 0);
        }

        const [usersData, resourcesData, modelsData, lotsData, recordsData] = await Promise.all([
          restRequest('usuarios?select=*&order=nome.asc'),
          restRequest('recursos_turno?select=*&order=nome.asc'),
          restRequest('modelos?select=*&order=modelo_base.asc'),
          restRequest('lotes?select=*&ativo=eq.SIM&order=data_criacao.asc'),
          restRequest('apontamentos?select=*&order=data_hora.desc&limit=800')
        ]);

        const users = (usersData || []).map(mapUserRow);
        const resources = (resourcesData || []).map(mapResourceRow);
        const models = (modelsData || []).map(mapModelRow);
        const lots = (lotsData || []).map(mapLotRow);
        const records = (recordsData || []).map(mapRecordRow);

        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(users));
        localStorage.setItem(RESOURCE_CACHE_KEY, JSON.stringify(resources));
        localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(models));
        localStorage.setItem(LOT_CACHE_KEY, JSON.stringify(lots));
        localStorage.setItem(LOCAL_LOTS_KEY, JSON.stringify(lots));
        setCache(records);

        return {
          Config_Usuarios: users,
          Cadastro_Recursos_Turno: resources,
          Cadastro_Modelos: models,
          Cadastro_Lista_Lotes: lots,
          TB_Apontamentos: records,
          Controle_Turnos: shiftControls,
          offline: false
        };
      } catch (err) {
        if (isAuthorizationError(err)) throw err;
        return offlineSnapshot();
      } finally {
        syncInFlight = null;
      }
    })();

    return syncInFlight;
  }

  function startFallbackPolling() {
    if (realtimePollingTimer) return;
    realtimePollingTimer = setInterval(async () => {
      if (!getSession() || !navigator.onLine || realtimeConnected || document.hidden) return;
      try {
        const snapshot = await sincronizarLeitura();
        if (typeof lastRealtimeHandlers.onSnapshotUpdate === 'function') {
          lastRealtimeHandlers.onSnapshotUpdate(snapshot);
        }
      } catch (_) {}
    }, 8000);
  }

  function stopFallbackPolling() {
    if (realtimePollingTimer) {
      clearInterval(realtimePollingTimer);
      realtimePollingTimer = null;
    }
  }

  function bindLifecycleListeners() {
    if (lifecycleListenersBound) return;
    lifecycleListenersBound = true;

    const refreshNow = async () => {
      if (!getSession() || !navigator.onLine || document.hidden) return;
      try {
        const snapshot = await sincronizarLeitura();
        if (typeof lastRealtimeHandlers.onSnapshotUpdate === 'function') {
          lastRealtimeHandlers.onSnapshotUpdate(snapshot);
        }
      } catch (_) {}
    };

    window.addEventListener('online', refreshNow);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshNow();
    });
  }

  async function subscribeRealtime(onSnapshotUpdate, onStatusChange) {
    stopRealtime();
    lastRealtimeHandlers = { onSnapshotUpdate, onStatusChange };
    bindLifecycleListeners();
    startFallbackPolling();

    const sb = getSupabase();
    if (!sb) return;

    const triggerFastSync = () => {
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = setTimeout(async () => {
        try {
          const snapshot = await sincronizarLeitura();
          if (typeof lastRealtimeHandlers.onSnapshotUpdate === 'function') {
            lastRealtimeHandlers.onSnapshotUpdate(snapshot);
          }
        } catch (_) {}
      }, 150);
    };

    try {
      realtimeChannel = sb
        .channel(`byd-entrega-live-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'controle_turnos' }, triggerFastSync)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'apontamentos' }, triggerFastSync)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lotes' }, triggerFastSync)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'recursos_turno' }, triggerFastSync)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, triggerFastSync)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'modelos' }, triggerFastSync)
        .subscribe((status) => {
          realtimeConnected = status === 'SUBSCRIBED';
          if (realtimeConnected) {
            stopFallbackPolling();
          } else {
            startFallbackPolling();
          }
          if (typeof lastRealtimeHandlers.onStatusChange === 'function') {
            lastRealtimeHandlers.onStatusChange(status, realtimeConnected);
          }
        });
    } catch (_) {
      startFallbackPolling();
    }
  }

  function stopRealtime() {
    realtimeConnected = false;
    clearTimeout(realtimeDebounceTimer);
    stopFallbackPolling();
    if (realtimeChannel && supabaseClient) {
      try { supabaseClient.removeChannel(realtimeChannel); } catch (_) {}
    }
    realtimeChannel = null;
  }

  async function testConnection() {
    return sendOrQueue({ action: 'test_connection' });
  }

  async function syncAll() {
    const sent = await syncQueue();
    let snapshot;
    try {
      snapshot = await sincronizarLeitura();
    } catch (error) {
      if (isAuthorizationError(error)) throw error;
      snapshot = offlineSnapshot();
    }
    return { sent, records: getCache(), snapshot };
  }

  return {
    getApiUrl,
    setApiUrl,
    getCache,
    setCache,
    getQueue,
    sendOrQueue,
    syncQueue,
    syncAll,
    authenticate,
    getSession,
    setSession,
    clearSession,
    getAdminCache,
    setAdminCache,
    testConnection,
    getCachedUsers,
    getCachedResources,
    getCachedShiftControls,
    isShiftClosedForOperator,
    sincronizarLeitura,
    subscribeRealtime,
    stopRealtime,
    isRealtimeConnected,
    removeLotFromLocal,
    getLotProgress: () => readArray(LOT_PROGRESS_KEY, [])
  };
})();