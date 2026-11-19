const DB = (() => {
  const CONFIG_KEY = 'byd_gas_url';
  const DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyU1it9Fs1X5kgcYuGgaPohXkTEmxjhGd4QgrLiKzxAFWwd8ZBR29gVrVznqPdCSL2I/exec';
  const CACHE_KEY = 'tb_apontamentos_cache';
  const QUEUE_KEY = 'tb_apontamentos_queue';
  const ADMIN_CACHE_KEY = 'byd_admin_data_cache_v1';
  const SESSION_KEY = 'byd_sessao';
  const USER_CACHE_KEY = 'Config_Usuarios';
  const MODEL_CACHE_KEY = 'Cadastro_Modelos';
  const LOT_CACHE_KEY = 'Cadastro_Lista_Lotes';
  const RECORD_CACHE_KEY = 'TB_Apontamentos';
  const LOT_PROGRESS_KEY = 'Progresso_Lotes';
  const LEGACY_SESSION_KEY = 'byd_authenticated_session_v1';
  const FALLBACK_USERS = [
    { Matricula: '1001', Nome: 'Eric Miranda', PIN: '1234', Perfil: 'ADMIN_GERAL', Turno_Vinculado: 'TODOS', Ativo: 'SIM' },
    { Matricula: '1002', Nome: 'Daniela Menezes', PIN: '2026', Perfil: 'LIDER_TURNO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
    { Matricula: '1003', Nome: 'Operador Pátio', PIN: '0000', Perfil: 'OPERADOR', Turno_Vinculado: 'Turno B', Ativo: 'SIM' }
  ];

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
    const records = readArray(RECORD_CACHE_KEY, readArray(CACHE_KEY, []));
    return records;
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
    const normalized = {
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
    return normalized;
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
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
  }

  function getAdminCache() {
    try {
      return JSON.parse(localStorage.getItem(ADMIN_CACHE_KEY) || 'null');
    } catch (_) {
      return null;
    }
  }

  function setAdminCache(data) {
    localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify(data || {}));
  }

  function getCachedUsers() {
    const cached = readArray(USER_CACHE_KEY, []);
    const source = cached.length ? cached : FALLBACK_USERS;
    return source.map((item) => {
      const matricula = String(item.Matricula || '').trim();
      let perfil = String(item.Perfil || '').toUpperCase();
      if (perfil === 'ADMIN') perfil = matricula === '1001' ? 'ADMIN_GERAL' : 'LIDER_TURNO';
      const fallback = FALLBACK_USERS.find((user) => user.Matricula === matricula);
      const pin = String(item.PIN === null || item.PIN === undefined ? '' : item.PIN);
      return {
        Matricula: matricula,
        Nome: String(item.Nome || item.Nome_Completo || ''),
        PIN: pin ? pin.padStart(4, '0') : (fallback ? fallback.PIN : ''),
        Perfil: perfil || (fallback && fallback.Perfil) || 'OPERADOR',
        Turno_Vinculado: item.Turno_Vinculado || (fallback && fallback.Turno_Vinculado) || 'Turno B',
        Ativo: String(item.Ativo || 'NAO').toUpperCase()
      };
    });
  }

  function apiError(message, code) {
    const error = new Error(message || 'Falha ao comunicar com o Google Apps Script.');
    error.code = code || 'SERVER_ERROR';
    return error;
  }

  function isAuthorizationError(error) {
    return [
      'AUTH_REQUIRED','FORBIDDEN','INVALID_CREDENTIALS','INVALID_INPUT',
      'NOT_FOUND','INVALID_ACTION','DUPLICATE_MATRICULA','LAST_ADMIN'
    ].includes(error.code);
  }

  function isNetworkError(error) {
    return !navigator.onLine || !getApiUrl() || error.code === 'NETWORK_ERROR' ||
      error.code === 'CONFIG_REQUIRED' || error instanceof TypeError;
  }

  async function post(payload, options = {}) {
    const url = getApiUrl();
    if (!url) throw apiError('A URL do Google Apps Script não está configurada.', 'CONFIG_REQUIRED');
    const requestBody = { ...payload };
    if (options.auth !== false && payload.action !== 'login') {
      const session = getSession();
      if (session && session.token) requestBody._sessionToken = session.token;
      if (!requestBody._queuedBy && session && session.Matricula) {
        requestBody._queuedBy = String(session.Matricula);
      }
    }

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(requestBody),
        redirect: 'follow'
      });
    } catch (error) {
      error.code = 'NETWORK_ERROR';
      throw error;
    }
    if (!response.ok) {
      throw apiError(`Falha HTTP ${response.status}`, response.status >= 500 ? 'NETWORK_ERROR' : 'HTTP_ERROR');
    }
    const result = await response.json();
    if (result && (result.ok === false || result.status === 'error')) {
      throw apiError(result.error || result.mensagem, result.code);
    }
    return result;
  }

  async function authenticate(credentials) {
    return post({
      action: 'login',
      Matricula: String(credentials.Matricula || '').trim(),
      PIN: String(credentials.PIN === null || credentials.PIN === undefined ? '' : credentials.PIN),
      Turno: String(credentials.Turno || '')
    }, { auth: false });
  }

  function enqueue(payload) {
    const session = getSession();
    const queueItem = { ...payload };
    delete queueItem._sessionToken;
    if (!queueItem._queuedBy && session && session.Matricula) {
      queueItem._queuedBy = String(session.Matricula);
    }
    const queue = getQueue();
    const id = queueItem.ID_Apontamento || queueItem.ID_Lote || queueItem.ID_Viagem;
    if (id && !['editar_apontamento','reverse'].includes(queueItem.action)) {
      const sameItem = queue.some((item) =>
        (item.ID_Apontamento || item.ID_Lote || item.ID_Viagem) === id && item.action === queueItem.action
      );
      if (sameItem) return;
    }
    queue.push(queueItem);
    setQueue(queue);
  }

  async function sendOrQueue(payload) {
    const activeSession = getSession();
    if (!activeSession) throw apiError('Faça login para continuar.', 'AUTH_REQUIRED');
    if (!navigator.onLine || !getApiUrl()) {
      enqueue(payload);
      throw apiError('Sem conexão. A alteração foi salva na fila para sincronização.', 'NETWORK_ERROR');
    }
    if (activeSession.localFallback && !activeSession.token) {
      try {
        const authenticated = await authenticateFallbackSession();
        const current = getSession();
        if (!authenticated || !current || !current.token) {
          throw apiError('Faça login novamente para sincronizar as alterações.', 'AUTH_REQUIRED');
        }
      } catch (error) {
        if (isNetworkError(error)) {
          enqueue(payload);
          throw apiError('Alteração salva na fila para sincronização.', 'NETWORK_ERROR');
        }
        throw error;
      }
    }
    try {
      return await post(payload);
    } catch (error) {
      if (isAuthorizationError(error)) throw error;
      if (isNetworkError(error)) {
        enqueue(payload);
        throw error;
      }
      throw error;
    }
  }

  async function authenticateFallbackSession() {
    const current = getSession();
    if (!current || !current.localFallback || current.token || !getApiUrl() || !navigator.onLine) return false;
    const user = getCachedUsers().find((item) =>
      String(item.Matricula) === current.Matricula && String(item.Ativo).toUpperCase() === 'SIM'
    );
    if (!user || !/^\d{4}$/.test(String(user.PIN || ''))) return false;
    const result = await authenticate({
      Matricula: current.Matricula,
      PIN: String(user.PIN),
      Turno: current.Turno
    });
    const authenticated = normalizeSession({
      ...result,
      expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : 0
    });
    if (!authenticated || !authenticated.token) return false;
    setSession(authenticated);
    return true;
  }

  async function syncQueue() {
    const queue = getQueue();
    if (!queue.length) return 0;
    try {
      await authenticateFallbackSession();
    } catch (error) {
      if (isAuthorizationError(error)) throw error;
      return 0;
    }
    const remaining = [];
    let sent = 0;
    for (let index = 0; index < queue.length; index++) {
      const payload = queue[index];
      try {
        await post(payload);
        sent++;
      } catch (error) {
        if (isAuthorizationError(error)) {
          setQueue(queue.slice(index));
          throw error;
        }
        if (error.code === 'BALANCE_EXCEEDED') {
          setQueue(remaining.concat(queue.slice(index)));
          throw error;
        }
        remaining.push(payload);
      }
    }
    setQueue(remaining);
    return sent;
  }

  async function getJson(url) {
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow'
      });
    } catch (error) {
      error.code = 'NETWORK_ERROR';
      throw error;
    }
    if (!response.ok) {
      throw apiError(`Falha HTTP ${response.status}`, response.status >= 500 ? 'NETWORK_ERROR' : 'HTTP_ERROR');
    }
    const result = await response.json();
    if (result && (result.ok === false || result.status === 'error')) {
      throw apiError(result.error || result.mensagem, result.code);
    }
    return result;
  }

  function authenticatedUrl(action) {
    const url = getApiUrl();
    if (!url) return '';
    const session = getSession();
    if (!session || !session.token) return '';
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}action=${encodeURIComponent(action)}&sessionToken=${encodeURIComponent(session.token)}`;
  }

  function persistSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (Array.isArray(snapshot.Config_Usuarios)) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(snapshot.Config_Usuarios));
    }
    if (Array.isArray(snapshot.Cadastro_Modelos)) {
      localStorage.setItem(MODEL_CACHE_KEY, JSON.stringify(snapshot.Cadastro_Modelos));
    }
    if (Array.isArray(snapshot.Cadastro_Lista_Lotes)) {
      localStorage.setItem(LOT_CACHE_KEY, JSON.stringify(snapshot.Cadastro_Lista_Lotes));
    }
    if (Array.isArray(snapshot.Progresso_Lotes)) {
      localStorage.setItem(LOT_PROGRESS_KEY, JSON.stringify(snapshot.Progresso_Lotes));
    }
    if (Array.isArray(snapshot.TB_Apontamentos)) setCache(snapshot.TB_Apontamentos);
    if (snapshot.Sessao) {
      const current = getSession();
      if (current) {
        const updated = { ...current, ...snapshot.Sessao, user: snapshot.Sessao };
        if (current.Perfil === 'ADMIN_GERAL') updated.Turno = current.Turno;
        setSession(updated);
      }
    }
  }

  async function sincronizarLeitura() {
    try {
      await authenticateFallbackSession();
    } catch (error) {
      if (isAuthorizationError(error)) throw error;
    }
    const url = authenticatedUrl('sync_read');
    if (!url) {
      const cached = {
        Cadastro_Modelos: readArray(MODEL_CACHE_KEY, []),
        Cadastro_Lista_Lotes: readArray(LOT_CACHE_KEY, []),
        Progresso_Lotes: readArray(LOT_PROGRESS_KEY, []),
        TB_Apontamentos: getCache(),
        offline: true
      };
      const session = getSession();
      if (session && ['ADMIN_GERAL','LIDER_TURNO'].includes(session.Perfil)) {
        cached.Config_Usuarios = getCachedUsers();
      }
      return cached;
    }
    const snapshot = await getJson(url);
    if (!snapshot || !Array.isArray(snapshot.TB_Apontamentos)) {
      throw apiError('Resposta inválida ao sincronizar a leitura.', 'INVALID_RESPONSE');
    }
    persistSnapshot(snapshot);
    return snapshot;
  }

  async function fetchAppointments() {
    const session = getSession();
    if (session && session.token) {
      const url = authenticatedUrl('list');
      if (url) {
        try {
          const records = await getJson(url);
          if (!Array.isArray(records)) throw apiError('Resposta inválida ao carregar apontamentos.', 'INVALID_RESPONSE');
          setCache(records);
          return records;
        } catch (error) {
          if (isAuthorizationError(error)) throw error;
        }
      }
    }
    return getCache();
  }

  async function fetchAdminData() {
    const snapshot = await sincronizarLeitura();
    if (!snapshot.offline && !Array.isArray(snapshot.Config_Usuarios) && !Array.isArray(snapshot.Cadastro_Modelos)) {
      throw apiError('Resposta inválida ao carregar Configurações.', 'INVALID_RESPONSE');
    }
    const data = {
      users: Array.isArray(snapshot.Config_Usuarios) ? snapshot.Config_Usuarios : getCachedUsers(),
      models: Array.isArray(snapshot.Cadastro_Modelos) ? snapshot.Cadastro_Modelos : readArray(MODEL_CACHE_KEY, []),
      lots: Array.isArray(snapshot.Cadastro_Lista_Lotes) ? snapshot.Cadastro_Lista_Lotes : readArray(LOT_CACHE_KEY, []),
      progress: Array.isArray(snapshot.Progresso_Lotes) ? snapshot.Progresso_Lotes : readArray(LOT_PROGRESS_KEY, []),
      records: Array.isArray(snapshot.TB_Apontamentos) ? snapshot.TB_Apontamentos : getCache(),
      offline: Boolean(snapshot.offline)
    };
    setAdminCache(data);
    return data;
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
        Cadastro_Lista_Lotes: readArray(LOT_CACHE_KEY, [])
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
    fetchAppointments,
    syncAll,
    authenticate,
    getSession,
    setSession,
    clearSession,
    getAdminCache,
    setAdminCache,
    fetchAdminData,
    testConnection,
    getCachedUsers,
    sincronizarLeitura,
    authenticateFallbackSession,
    getLotProgress: () => readArray(LOT_PROGRESS_KEY, [])
  };
})();
