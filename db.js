const DB = (() => {
  'use strict';

  // =========================================================================
  // 1. CONFIGURAÇÃO DO SUPABASE (TEMPO REAL < 0,3s) + ESPELHO GOOGLE SHEETS
  // =========================================================================
  const SUPABASE_URL = 'https://ywwaoyqskngbivvpxgny.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_k64sBffK4f2s6s7K9z8W9Q_24z9z9z9';
  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbxhdG44T6jX-f7_iH1xH28Q0lT-q0y8P1B-3l2gR9s2wK60/exec';

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

  const FALLBACK_USERS = [
    { Matricula: '1001', Nome: 'Anderson Andrade', PIN: '1001', Perfil: 'ADMIN_GERAL', Turno_Vinculado: 'TODOS', Ativo: 'SIM' },
    { Matricula: '1002', Nome: 'Daniela Menezes', PIN: '1002', Perfil: 'LIDER_TURNO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { Matricula: '1003', Nome: 'Eric Miranda', PIN: '1003', Perfil: 'OPERADOR', Turno_Vinculado: 'Turno B', Ativo: 'SIM' }
  ];

  const FALLBACK_RESOURCES = [
    { ID_Recurso: 'seed-m1', Tipo: 'MOTORISTA', Nome: 'JOSE', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
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

  function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 20 } }
    });
    return supabaseClient;
  }

  function isRealtimeConnected() {
    return realtimeConnected;
  }

  function getApiUrl() {
    const savedUrl = localStorage.getItem(CONFIG_KEY);
    if (savedUrl) return savedUrl;
    localStorage.setItem(CONFIG_KEY, DEFAULT_API_URL);
    return DEFAULT_API_URL;
  }

  function setApiUrl(url) {
    const value = String(url || '').trim();
    if (!value) throw new Error('A URL atual foi preservada. Informe uma URL válida para substituí-la.');
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
    const msg = String(err && (err.message || err.details || err.hint) || '');
    if (/invalid api key|jwt|apikey/i.test(msg)) {
      return apiError('Chave do Supabase inválida. Confira no painel Project Settings > API e cole a chave completa no topo do db.js.', 'CONFIG_REQUIRED');
    }
    if (/duplicate key|unique constraint/i.test(msg)) {
      return apiError('Registro duplicado no banco de dados.', 'DUPLICATE_MATRICULA');
    }
    return apiError(msg || 'Erro no banco de dados Supabase.', 'SERVER_ERROR');
  }

  function isAuthorizationError(error) {
    return [
      'AUTH_REQUIRED', 'FORBIDDEN', 'INVALID_CREDENTIALS', 'INVALID_INPUT',
      'NOT_FOUND', 'INVALID_ACTION', 'DUPLICATE_MATRICULA', 'LAST_ADMIN', 'LOT_HAS_RECORDS'
    ].includes(error.code);
  }

  function isNetworkError(error) {
    return !navigator.onLine || error.code === 'NETWORK_ERROR' || error instanceof TypeError;
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

  // =========================================================================
  // 3. SESSÃO E AUTENTICAÇÃO
  // =========================================================================
  function normalizeSession(source) {
    if (!source || typeof source !== 'object') return null;
    const user = source.user && typeof source.user === 'object' ? source.user : {};
    const matricula = String(source.Matricula || user.Matricula || '').trim();
    const nome = String(source.Nome || user.Nome || user.Nome_Completo || '').trim();
    let perfil = String(source.Perfil || user.Perfil || '').toUpperCase();
    if (perfil === 'ADMIN') perfil = matricula === '1001' ? 'ADMIN_GERAL' : 'LIDER_TURNO';
    const normalizeTurn = (value) => {
      const turnValue = String(value || '').trim();
      if (/^TODOS$/i.test(turnValue)) return 'TODOS';
      if (/^GERAL$/i.test(turnValue)) return 'Geral';
      if (/^Turno\s+[ABC]$/i.test(turnValue)) return `Turno ${turnValue.slice(-1).toUpperCase()}`;
      if (/^[ABC]$/i.test(turnValue)) return `Turno ${turnValue.toUpperCase()}`;
      return turnValue || 'Turno A';
    };
    const linkedTurn = normalizeTurn(source.Turno_Vinculado || user.Turno_Vinculado || source.Turno);
    const turn = normalizeTurn(source.Turno || (perfil === 'ADMIN_GERAL' ? 'Turno A' : linkedTurn));
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

  async function authenticate(credentials) {
    const matricula = String(credentials.Matricula || '').trim();
    const pin = String(credentials.PIN === null || credentials.PIN === undefined ? '' : credentials.PIN).trim();
    const turno = String(credentials.Turno || 'Turno A').trim();
    const sb = getSupabase();

    if (sb && navigator.onLine) {
      const { data, error } = await sb
        .from('usuarios')
        .select('*')
        .eq('matricula', matricula)
        .maybeSingle();

      if (error) throw translateSupabaseError(error);
      if (!data) throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');

      const user = mapUserRow(data);
      if (user.PIN !== pin || user.Ativo !== 'SIM') {
        throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');
      }
      if (!['ADMIN_GERAL', 'LIDER_TURNO', 'OPERADOR'].includes(user.Perfil)) {
        throw apiError('Perfil sem permissão de acesso.', 'FORBIDDEN');
      }
      const selectedTurn = user.Perfil === 'ADMIN_GERAL' ? turno : user.Turno_Vinculado;
      refreshGasTokenSilently(matricula, pin, selectedTurn);

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
    }

    const local = getCachedUsers().find((u) => u.Matricula === matricula && u.PIN === pin && u.Ativo === 'SIM');
    if (!local) throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');
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

  // =========================================================================
  // 4. ESPELHO AUTOMÁTICO PARA GOOGLE SHEETS (SEGUNDO PLANO)
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
    const sb = getSupabase();
    if (!sb) return;
    try {
      if (payload.action === 'criar_viagem' && Array.isArray(payload.itens)) {
        const ids = payload.itens.map((i) => i.ID_Apontamento).filter(Boolean);
        if (ids.length) await sb.from('apontamentos').update({ sheets_synced: true }).in('id_apontamento', ids);
      } else if (['editar_apontamento', 'reverse'].includes(payload.action) && payload.ID_Apontamento) {
        await sb.from('apontamentos').update({ sheets_synced: true }).eq('id_apontamento', payload.ID_Apontamento);
      } else if (payload.action === 'salvar_lote' && payload.ID_Lote) {
        await sb.from('lotes').update({ sheets_synced: true }).eq('id_lote', payload.ID_Lote);
      }
    } catch (_) {}
  }

  // =========================================================================
  // 5. OPERAÇÕES DE ESCRITA NO SUPABASE + FILA OFFLINE
  // =========================================================================
  function assertPermission(session, checkFn, message = 'Seu perfil não tem permissão para esta ação.') {
    if (!session) throw apiError('Faça login para continuar.', 'AUTH_REQUIRED');
    if (!checkFn()) throw apiError(message, 'FORBIDDEN');
  }

  function turnKey(value) {
    return String(value || '').replace(/^Turno\s+/i, '').trim().toUpperCase();
  }

  async function executeSupabaseWrite(payload, session) {
    const sb = getSupabase();
    if (!sb) throw apiError('Cliente Supabase não carregado.', 'CONFIG_REQUIRED');

    const role = String(session.Perfil || '').toUpperCase();
    const isAdmin = role === 'ADMIN_GERAL';
    const isLeader = role === 'LIDER_TURNO';

    if (payload.action === 'test_connection') {
      const { error } = await sb.from('usuarios').select('matricula').limit(1);
      if (error) throw translateSupabaseError(error);
      const mirrored = await mirrorToSheets({ action: 'test_connection' });
      return {
        ok: true,
        message: mirrored
          ? 'Supabase Tempo Real (<0,3s) + Espelho Google Sheets conectados com sucesso!'
          : 'Supabase conectado! (Verifique a URL do Apps Script se precisar do espelho na planilha).'
      };
    }

    if (payload.action === 'criar_viagem') {
      const rows = (payload.itens || []).map((item) => ({
        id_apontamento: String(item.ID_Apontamento),
        id_viagem: String(item.ID_Viagem || payload.ID_Viagem || ''),
        data_hora: item.DataHora || new Date().toISOString(),
        data_ref: String(item.Data_Ref),
        hora_ref: String(item.Hora_Ref),
        operador: String(item.Operador || session.Nome),
        matricula_operador: String(session.Matricula || ''),
        turno: String(item.Turno),
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
      const { error } = await sb.from('apontamentos').insert(rows);
      if (error) throw translateSupabaseError(error);
      mirrorToSheets(payload);
      return { ok: true };
    }

    if (payload.action === 'editar_apontamento') {
      const { error } = await sb.from('apontamentos').update({
        nome_lote: String(payload.Nome_Lote),
        modelo_base: String(payload.Modelo_Base),
        componente: String(payload.Componente),
        qtd_enviada: Number(payload.Qtd_Enviada),
        motorista: String(payload.Motorista).trim().toUpperCase(),
        frota: String(payload.Frota).trim().toUpperCase(),
        observacao_auditoria: `Editado por ${session.Nome} (${session.Matricula}) em ${new Date().toLocaleString('pt-BR')}`
      }).eq('id_apontamento', String(payload.ID_Apontamento));
      if (error) throw translateSupabaseError(error);
      mirrorToSheets(payload);
      return { ok: true };
    }

    if (payload.action === 'reverse') {
      const { error } = await sb.from('apontamentos').update({
        status: 'ESTORNADO',
        motivo_estorno: String(payload.Motivo_Estorno),
        observacao_auditoria: `Estornado por ${session.Nome} (${session.Matricula}) em ${new Date().toLocaleString('pt-BR')}`
      }).eq('id_apontamento', String(payload.ID_Apontamento));
      if (error) throw translateSupabaseError(error);
      mirrorToSheets(payload);
      return { ok: true };
    }

    if (payload.action === 'salvar_lote') {
      const row = {
        id_lote: String(payload.ID_Lote),
        nome_lote: String(payload.Nome_Lote).trim(),
        modelo_base: String(payload.Modelo_Base).trim(),
        turno_vinculado: String(payload.Turno_Vinculado),
        ativo: 'SIM',
        data_criacao: payload.Data_Criacao || new Date().toISOString()
      };
      const { error } = await sb.from('lotes').upsert(row, { onConflict: 'id_lote' });
      if (error) throw translateSupabaseError(error);
      mirrorToSheets(payload);
      return { ok: true };
    }

    if (payload.action === 'excluir_lote') {
      let query = sb.from('lotes').delete();
      if (payload.ID_Lote) query = query.eq('id_lote', String(payload.ID_Lote));
      else query = query.eq('nome_lote', String(payload.Nome_Lote)).eq('modelo_base', String(payload.Modelo_Base));
      const { error } = await query;
      if (error) throw translateSupabaseError(error);
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
      const { error } = await sb.from('modelos').upsert(row, { onConflict: 'modelo_base' });
      if (error) throw translateSupabaseError(error);
      mirrorToSheets(payload);
      return { ok: true };
    }

    if (payload.action === 'salvar_usuario') {
      assertPermission(session, () => isAdmin || isLeader);
      const original = String(payload.Matricula_Original || '').trim();
      const targetMatricula = String(payload.Matricula || '').trim();
      const targetPerfil = String(payload.Perfil || 'OPERADOR').toUpperCase();
      const targetTurno = targetPerfil === 'ADMIN_GERAL' ? 'TODOS' : String(payload.Turno_Vinculado || 'Turno B');
      const targetAtivo = String(payload.Ativo || 'SIM').toUpperCase();

      if (isLeader) {
        if (targetPerfil !== 'OPERADOR' || turnKey(targetTurno) !== turnKey(session.Turno_Vinculado)) {
          throw apiError('Líder de turno só pode cadastrar ou editar OPERADOR do seu próprio turno.', 'FORBIDDEN');
        }
      }

      if (original && original !== targetMatricula) {
        const { data: conflict } = await sb.from('usuarios').select('matricula').eq('matricula', targetMatricula).maybeSingle();
        if (conflict) throw apiError('Matrícula já cadastrada para outro funcionário.', 'DUPLICATE_MATRICULA');
        await sb.from('usuarios').delete().eq('matricula', original);
      }

      const row = {
        matricula: targetMatricula,
        nome: String(payload.Nome || '').trim(),
        pin: String(payload.PIN || '').trim(),
        perfil: targetPerfil,
        turno_vinculado: targetTurno,
        ativo: targetAtivo
      };
      const { error } = await sb.from('usuarios').upsert(row, { onConflict: 'matricula' });
      if (error) throw translateSupabaseError(error);

      mirrorToSheets(payload);
      const { data: allUsers } = await sb.from('usuarios').select('*').order('nome');
      const mappedUsers = Array.isArray(allUsers) ? allUsers.map(mapUserRow) : [];
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(mappedUsers));

      return {
        ok: true,
        mensagem: 'Funcionário salvo e sincronizado em tempo real.',
        users: mappedUsers,
        sessionRevoked: targetMatricula === session.Matricula && targetAtivo !== 'SIM'
      };
    }

    if (payload.action === 'salvar_recurso') {
      assertPermission(session, () => isAdmin || isLeader);
      const tipo = String(payload.Tipo || 'MOTORISTA').toUpperCase();
      const nome = String(payload.Nome || '').trim().toUpperCase();
      const ativo = String(payload.Ativo || 'SIM').toUpperCase();
      const turno = isLeader ? session.Turno_Vinculado : String(payload.Turno_Vinculado || 'Turno B');

      if (!nome || !['MOTORISTA', 'FROTA'].includes(tipo)) {
        throw apiError('Informe um tipo e nome válidos.', 'INVALID_INPUT');
      }

      if (payload.ID_Recurso && !String(payload.ID_Recurso).startsWith('seed-')) {
        if (isLeader) {
          const { data: existing } = await sb.from('recursos_turno').select('turno_vinculado').eq('id', payload.ID_Recurso).maybeSingle();
          if (existing && turnKey(existing.turno_vinculado) !== turnKey(session.Turno_Vinculado)) {
            throw apiError('Você só pode editar motoristas e frotas do seu próprio turno.', 'FORBIDDEN');
          }
        }
        const { error } = await sb.from('recursos_turno').update({
          tipo,
          nome,
          turno_vinculado: turno,
          ativo
        }).eq('id', payload.ID_Recurso);
        if (error) throw translateSupabaseError(error);
      } else {
        const { data: dup } = await sb
          .from('recursos_turno')
          .select('id')
          .eq('tipo', tipo)
          .ilike('nome', nome)
          .eq('turno_vinculado', turno)
          .maybeSingle();
        if (dup) {
          const { error: updErr } = await sb.from('recursos_turno').update({ ativo, nome }).eq('id', dup.id);
          if (updErr) throw translateSupabaseError(updErr);
        } else {
          const { error: insErr } = await sb.from('recursos_turno').insert({
            tipo, nome, turno_vinculado: turno, ativo, criado_por: String(session.Matricula || '')
          });
          if (insErr) throw translateSupabaseError(insErr);
        }
      }

      const { data: allResources } = await sb.from('recursos_turno').select('*').order('nome');
      const mapped = Array.isArray(allResources) ? allResources.map(mapResourceRow) : [];
      localStorage.setItem(RESOURCE_CACHE_KEY, JSON.stringify(mapped));
      return { ok: true, mensagem: 'Cadastro atualizado em tempo real.', resources: mapped };
    }

    if (payload.action === 'excluir_recurso') {
      assertPermission(session, () => isAdmin || isLeader);
      if (isLeader) {
        const { data: existing } = await sb.from('recursos_turno').select('turno_vinculado').eq('id', payload.ID_Recurso).maybeSingle();
        if (existing && turnKey(existing.turno_vinculado) !== turnKey(session.Turno_Vinculado)) {
          throw apiError('Você só pode remover cadastros do seu próprio turno.', 'FORBIDDEN');
        }
      }
      const { error } = await sb.from('recursos_turno').delete().eq('id', String(payload.ID_Recurso));
      if (error) throw translateSupabaseError(error);
      const { data: allResources } = await sb.from('recursos_turno').select('*').order('nome');
      const mapped = Array.isArray(allResources) ? allResources.map(mapResourceRow) : [];
      localStorage.setItem(RESOURCE_CACHE_KEY, JSON.stringify(mapped));
      return { ok: true, resources: mapped };
    }

    throw apiError(`Ação desconhecida: ${payload.action}`, 'INVALID_ACTION');
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
    if (id && !['editar_apontamento', 'reverse', 'salvar_recurso'].includes(queueItem.action)) {
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
    if (!navigator.onLine) {
      enqueue(payload);
      throw apiError('Sem internet. Salvo na fila do celular para enviar assim que voltar o sinal.', 'NETWORK_ERROR');
    }
    try {
      return await executeSupabaseWrite(payload, activeSession);
    } catch (error) {
      if (isAuthorizationError(error)) throw error;
      if (isNetworkError(error)) {
        enqueue(payload);
        throw error;
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
        if (['INVALID_ACTION', 'NOT_FOUND'].includes(error.code)) continue;
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
  // 6. LEITURA SINCRONIZADA DO SUPABASE + REALTIME WEBSOCKET (< 0,3s)
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

  async function sincronizarLeitura() {
    const sb = getSupabase();
    if (!sb || !navigator.onLine) {
      return {
        Config_Usuarios: getCachedUsers(),
        Cadastro_Recursos_Turno: getCachedResources(),
        Cadastro_Modelos: readArray(MODEL_CACHE_KEY, []),
        Cadastro_Lista_Lotes: readArray(LOT_CACHE_KEY, []),
        Progresso_Lotes: readArray(LOT_PROGRESS_KEY, []),
        TB_Apontamentos: getCache(),
        offline: true
      };
    }

    const [usersRes, resourcesRes, modelsRes, lotsRes, recordsRes] = await Promise.all([
      sb.from('usuarios').select('*').order('nome'),
      sb.from('recursos_turno').select('*').order('nome'),
      sb.from('modelos').select('*').order('modelo_base'),
      sb.from('lotes').select('*').eq('ativo', 'SIM').order('data_criacao'),
      sb.from('apontamentos').select('*').order('data_hora', { ascending: false }).limit(800)
    ]);

    if (usersRes.error) throw translateSupabaseError(usersRes.error);
    if (resourcesRes.error) throw translateSupabaseError(resourcesRes.error);
    if (modelsRes.error) throw translateSupabaseError(modelsRes.error);
    if (lotsRes.error) throw translateSupabaseError(lotsRes.error);
    if (recordsRes.error) throw translateSupabaseError(recordsRes.error);

    const users = (usersRes.data || []).map(mapUserRow);
    const resources = (resourcesRes.data || []).map(mapResourceRow);
    const models = (modelsRes.data || []).map(mapModelRow);
    const lots = (lotsRes.data || []).map(mapLotRow);
    const records = (recordsRes.data || []).map(mapRecordRow);

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
      offline: false
    };
  }

  function subscribeRealtime(onSnapshotUpdate, onStatusChange) {
    const sb = getSupabase();
    if (!sb) return;
    stopRealtime();

    const triggerFastSync = () => {
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = setTimeout(async () => {
        try {
          const snapshot = await sincronizarLeitura();
          if (typeof onSnapshotUpdate === 'function') onSnapshotUpdate(snapshot);
        } catch (_) {}
      }, 120);
    };

    realtimeChannel = sb
      .channel('byd-entrega-materiais-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'apontamentos' }, triggerFastSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lotes' }, triggerFastSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recursos_turno' }, triggerFastSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usuarios' }, triggerFastSync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'modelos' }, triggerFastSync)
      .subscribe((status) => {
        realtimeConnected = status === 'SUBSCRIBED';
        if (typeof onStatusChange === 'function') onStatusChange(status, realtimeConnected);
      });
  }

  function stopRealtime() {
    realtimeConnected = false;
    clearTimeout(realtimeDebounceTimer);
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
      snapshot = {
        TB_Apontamentos: getCache(),
        Cadastro_Lista_Lotes: readArray(LOT_CACHE_KEY, []),
        Cadastro_Recursos_Turno: getCachedResources()
      };
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
    sincronizarLeitura,
    subscribeRealtime,
    stopRealtime,
    isRealtimeConnected,
    removeLotFromLocal,
    getLotProgress: () => readArray(LOT_PROGRESS_KEY, [])
  };
})();