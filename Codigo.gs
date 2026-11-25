const SHEET_NAME = 'TB_Apontamentos';
const HEADERS = [
  'ID_Apontamento','DataHora','Data_Ref','Hora_Ref','Operador','Turno',
  'Nome_Lote','Modelo_Base','Componente','Qtd_Enviada','Motorista','Frota',
  'Status','Motivo_Estorno'
];
const TRIP_HEADER = 'ID_Viagem';
const AUDIT_HEADER = 'Observacao_Auditoria';
const OPERATOR_ID_HEADER = 'Matricula_Operador';
const APPOINTMENT_HEADERS = HEADERS.concat([TRIP_HEADER, AUDIT_HEADER, OPERATOR_ID_HEADER]);
const USER_SHEET_NAME = 'Config_Usuarios';
const USER_HEADERS = ['Matricula','Nome','PIN','Perfil','Turno_Vinculado','Ativo'];
const MODEL_SHEET_NAME = 'Cadastro_Modelos';
const MODEL_HEADERS = [
  'Modelo_Base','Componente1','Meta1','Componente2','Meta2',
  'Componente3','Meta3','Total_Meta'
];
const LOT_SHEET_NAME = 'Cadastro_Lista_Lotes';
const LOT_HEADERS = ['ID_Lote','Nome_Lote','Modelo_Base','Turno_Vinculado','Ativo','Data_Criacao'];
const SESSION_TTL_SECONDS = 21600;
const INITIAL_USERS = [
  { Matricula: '1001', Nome: 'Eric Miranda', PIN: '1234', Perfil: 'ADMIN_GERAL', Turno_Vinculado: 'TODOS', Ativo: 'SIM' },
  { Matricula: '1002', Nome: 'Daniela Menezes', PIN: '2026', Perfil: 'LIDER_TURNO', Turno_Vinculado: 'Turno B', Ativo: 'SIM' },
  { Matricula: '1003', Nome: 'Operador Pátio', PIN: '0000', Perfil: 'OPERADOR', Turno_Vinculado: 'Turno B', Ativo: 'SIM' }
];
const INITIAL_MODELS = [
  ['EQE','Aramados baixos',60,'Aramados altos',38,'Caixarias',135,233],
  ['HA2','Aramados baixos',60,'Aramados altos',60,'Escapamentos',120,240],
  ['SA2/SA6','Barcas',40,'Motores / Eixos',40,'Aramados de Caixas',40,120],
  ['SC3','Aramados baixos',30,'Aramados altos',30,'Caixarias',60,120],
  ['PBP','Aramados altos e baixos',60,'Caixarias',87,'Jantes',240,387]
];

function doGet(e) {
  try {
    const parameters = e && e.parameter || {};
    const action = parameters.action || 'list';
    const session = requireSession(parameters.sessionToken);
    if (action === 'sync_read' || action === 'admin_data') {
      if (action === 'admin_data') requireSettingsAccess(session);
      return jsonResponse(syncSnapshot(session));
    }
    if (action !== 'list') throw apiError('Ação não permitida.', 'INVALID_ACTION');
    return jsonResponse(recordsForSession(session));
  } catch (error) {
    return jsonResponse(apiErrorBody(error));
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const action = payload.action || 'salvar_apontamento';
    if (action === 'login') return jsonResponse(login(payload));

    const session = requireSession(payload._sessionToken);
    if (payload._queuedBy && !sessionOwnsQueue(session, String(payload._queuedBy))) {
      throw apiError('A fila pertence a outro usuário autenticado.', 'FORBIDDEN');
    }
    if (action === 'salvar_usuario') {
      requireSettingsAccess(session);
      return jsonResponse(saveUser(payload, session, payload._sessionToken));
    }
    if (action === 'salvar_modelo') {
      requireGeneralAdmin(session);
      return jsonResponse(saveModel(payload));
    }
    if (action === 'salvar_lote' || action === 'criar_lote') {
      return jsonResponse(saveLot(payload, session));
    }
    if (action === 'excluir_lote') {
      return jsonResponse(deleteLot(payload, session));
    }
    if (action === 'criar_viagem') return jsonResponse(createTrip(payload, session));
    if (action === 'editar_apontamento') return jsonResponse(editAppointment(payload, session));
    if (action === 'reverse') return jsonResponse(updateStatus(payload, session));
    if (action === 'test_connection') {
      requireGeneralAdmin(session);
      return jsonResponse({ ok: true, message: 'Conexão autenticada com Google Sheets.' });
    }
    if (!['salvar_apontamento','criar_apontamento'].includes(action)) {
      throw apiError('Ação não permitida.', 'INVALID_ACTION');
    }
    return jsonResponse(appendRecord(payload, session));
  } catch (error) {
    return jsonResponse(apiErrorBody(error));
  } finally {
    lock.releaseLock();
  }
}

function apiError(message, code) {
  const error = new Error(message);
  error.code = code || 'SERVER_ERROR';
  return error;
}

function apiErrorBody(error) {
  return { ok: false, code: error.code || 'SERVER_ERROR', error: error.message || 'Falha inesperada.' };
}

function normalizeMatricula(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeRole(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeTurn(value) {
  const turn = String(value || '').trim().toUpperCase().replace(/^TURNO\s+/, '');
  if (turn === 'TODOS') return 'TODOS';
  if (turn === 'GERAL') return 'Geral';
  return ['A','B','C'].indexOf(turn) >= 0 ? 'Turno ' + turn : '';
}

function turnKey(value) {
  const normalized = normalizeTurn(value);
  return normalized === 'TODOS' || normalized === 'Geral'
    ? 'TODOS'
    : normalized.replace(/^Turno\s+/, '');
}

function requireSession(token) {
  if (!token) throw apiError('Sessão ausente. Faça login novamente.', 'AUTH_REQUIRED');
  const cache = CacheService.getScriptCache();
  const cached = cache.get('session_' + token);
  if (!cached) throw apiError('Sessão expirada. Faça login novamente.', 'AUTH_REQUIRED');
  const stored = JSON.parse(cached);
  const user = findUserByMatricula(stored.Matricula);
  if (!user || user.Ativo !== 'SIM') throw apiError('Usuário bloqueado ou inativo.', 'AUTH_REQUIRED');
  return {
    Matricula: user.Matricula,
    Nome: user.Nome,
    Perfil: user.Perfil,
    Turno: user.Perfil === 'ADMIN_GERAL' ? normalizeTurn(stored.Turno) || 'Turno A' : user.Turno_Vinculado,
    Turno_Vinculado: user.Turno_Vinculado,
    MatriculasAnteriores: stored.MatriculasAnteriores || []
  };
}

function requireGeneralAdmin(session) {
  if (!session || session.Perfil !== 'ADMIN_GERAL') {
    throw apiError('Ação exclusiva para ADMIN_GERAL.', 'FORBIDDEN');
  }
}

function requireSettingsAccess(session) {
  if (!session || !['ADMIN_GERAL','LIDER_TURNO'].includes(session.Perfil)) {
    throw apiError('Ação exclusiva para ADMIN_GERAL ou LIDER_TURNO.', 'FORBIDDEN');
  }
}

function sessionOwnsQueue(session, queuedBy) {
  return queuedBy === session.Matricula ||
    (session.MatriculasAnteriores || []).indexOf(queuedBy) >= 0;
}

function login(payload) {
  const matricula = normalizeMatricula(payload.Matricula);
  const pin = String(payload.PIN === null || payload.PIN === undefined ? '' : payload.PIN);
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(matricula) || !/^\d{4}$/.test(pin)) {
    throw apiError('Matrícula ou PIN inválido.', 'INVALID_CREDENTIALS');
  }

  const cache = CacheService.getScriptCache();
  const attemptKey = 'login_attempts_' + matricula;
  const attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= 5) throw apiError('Muitas tentativas. Aguarde 5 minutos antes de tentar novamente.', 'RATE_LIMITED');
  const user = findUserByMatricula(matricula);
  if (!user || user.Ativo !== 'SIM' || String(user.PIN) !== pin) {
    cache.put(attemptKey, String(attempts + 1), 300);
    throw apiError('Matrícula, PIN ou status inválido.', 'INVALID_CREDENTIALS');
  }
  cache.remove(attemptKey);

  const role = normalizeRole(user.Perfil);
  if (!['ADMIN_GERAL','LIDER_TURNO','OPERADOR'].includes(role)) {
    throw apiError('Perfil de usuário inválido.', 'INVALID_PROFILE');
  }
  let turn = normalizeTurn(user.Turno_Vinculado);
  if (role === 'ADMIN_GERAL') {
    if (turn !== 'TODOS') throw apiError('ADMIN_GERAL deve ter turno vinculado TODOS.', 'INVALID_USER_TURN');
    const requested = String(payload.Turno || '').trim();
    turn = /^GERAL$/i.test(requested) ? 'Geral' : normalizeTurn(requested) || 'Turno A';
  } else if (!turn || turn === 'TODOS') {
    throw apiError('Usuário sem turno vinculado válido.', 'INVALID_USER_TURN');
  }

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const session = {
    Matricula: user.Matricula,
    Nome: user.Nome,
    Perfil: role,
    Turno: turn,
    Turno_Vinculado: user.Turno_Vinculado,
    MatriculasAnteriores: []
  };
  cache.put('session_' + token, JSON.stringify(session), SESSION_TTL_SECONDS);
  return {
    ok: true,
    token: token,
    expiresIn: SESSION_TTL_SECONDS,
    user: publicUser(user),
    Turno: turn
  };
}

function getSpreadsheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Associe este Apps Script à planilha de logística.');
  return spreadsheet;
}

function ensureSheet(sheetName, headers) {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  const currentWidth = Math.max(sheet.getLastColumn(), headers.length);
  if (sheet.getLastRow() === 0 || sheet.getRange(1, 1, 1, currentWidth).getValues()[0].every(function(value) { return value === ''; })) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }

  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  headers.forEach(function(header) {
    if (existing.indexOf(header) === -1) {
      const newColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColumn).setValue(header);
      existing.push(header);
    }
  });
  return sheet;
}

function ensureAppointmentSheet() {
  const sheet = ensureSheet(SHEET_NAME, APPOINTMENT_HEADERS);
  const values = sheet.getDataRange().getValues();
  const currentHeaders = values.length ? values[0].map(String) : [];
  const extraHeaders = currentHeaders.filter(function(header) {
    return header && APPOINTMENT_HEADERS.indexOf(header) === -1;
  });
  const headers = APPOINTMENT_HEADERS.concat(extraHeaders);
  const matches = headers.length === currentHeaders.length &&
    headers.every(function(header, index) { return currentHeaders[index] === header; });
  if (!matches) {
    const columnIndexes = {};
    currentHeaders.forEach(function(header, index) { columnIndexes[header] = index; });
    const migrated = values.slice(1).map(function(source) {
      return headers.map(function(header) {
        const index = columnIndexes[header];
        return index === undefined ? '' : source[index];
      });
    });
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (migrated.length) sheet.getRange(2, 1, migrated.length, headers.length).setValues(migrated);
  }
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('O:O').setNumberFormat('@');
  return sheet;
}

function defaultUserForMatricula(matricula) {
  return INITIAL_USERS.find(function(user) { return user.Matricula === matricula; }) || null;
}

function getUserSheet() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(USER_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(USER_SHEET_NAME);

  const values = sheet.getDataRange().getValues();
  const hasData = values.length > 1 && values.slice(1).some(function(row) {
    return row.some(function(value) { return value !== ''; });
  });
  const currentHeaders = values.length ? values[0].map(String) : [];
  const exactSchema = USER_HEADERS.length === currentHeaders.length &&
    USER_HEADERS.every(function(header, index) { return currentHeaders[index] === header; });

  if (!exactSchema) {
    const index = {};
    currentHeaders.forEach(function(header, position) { index[header] = position; });
    const migrated = [];
    if (hasData) {
      values.slice(1).forEach(function(source) {
        const get = function() {
          for (let i = 0; i < arguments.length; i++) {
            const column = index[arguments[i]];
            if (column !== undefined && source[column] !== '' && source[column] !== null) return source[column];
          }
          return '';
        };
        const matricula = normalizeMatricula(get('Matricula'));
        if (!matricula) return;
        const fallback = defaultUserForMatricula(matricula);
        const oldRole = normalizeRole(get('Perfil'));
        let perfil = oldRole;
        if (perfil === 'ADMIN') perfil = matricula === '1001' ? 'ADMIN_GERAL' : 'LIDER_TURNO';
        if (!['ADMIN_GERAL','LIDER_TURNO','OPERADOR'].includes(perfil)) perfil = fallback ? fallback.Perfil : 'OPERADOR';
        let turno = normalizeTurn(get('Turno_Vinculado','Turno'));
        if (perfil === 'ADMIN_GERAL') turno = 'TODOS';
        else if (!turno || turno === 'TODOS') turno = fallback && fallback.Turno_Vinculado !== 'TODOS' ? fallback.Turno_Vinculado : 'Turno B';
        let pin = String(get('PIN') || '').trim();
        let ativo = String(get('Ativo') || (pin ? 'SIM' : 'NAO')).toUpperCase();
        if (!/^\d{4}$/.test(pin) && fallback) {
          pin = fallback.PIN;
          perfil = fallback.Perfil;
          turno = fallback.Turno_Vinculado;
          ativo = 'SIM';
        }
        if (!/^\d{4}$/.test(pin)) {
          pin = '';
          ativo = 'NAO';
        }
        const migratedUser = [
          matricula,
          String(get('Nome','Nome_Completo') || (fallback && fallback.Nome) || '').trim(),
          pin,
          perfil,
          turno,
          ativo === 'NAO' ? 'NAO' : 'SIM'
        ];
        const duplicateIndex = migrated.findIndex(function(row) { return row[0] === matricula; });
        if (duplicateIndex >= 0) migrated[duplicateIndex] = migratedUser;
        else migrated.push(migratedUser);
      });
    }
    if (!hasData) {
      INITIAL_USERS.forEach(function(user) {
        migrated.push([user.Matricula,user.Nome,user.PIN,user.Perfil,user.Turno_Vinculado,user.Ativo]);
      });
    } else {
      INITIAL_USERS.forEach(function(user) {
        if (!migrated.some(function(row) { return row[0] === user.Matricula; })) {
          migrated.push([user.Matricula,user.Nome,user.PIN,user.Perfil,user.Turno_Vinculado,user.Ativo]);
        }
      });
    }
    sheet.clearContents();
    sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
    if (migrated.length) sheet.getRange(2, 1, migrated.length, USER_HEADERS.length).setValues(migrated);
  } else if (!hasData) {
    sheet.getRange(2, 1, INITIAL_USERS.length, USER_HEADERS.length).setValues(
      INITIAL_USERS.map(function(user) {
        return [user.Matricula,user.Nome,user.PIN,user.Perfil,user.Turno_Vinculado,user.Ativo];
      })
    );
  } else {
    const userRows = values.slice(1).filter(function(row) {
      return row.some(function(value) { return value !== ''; });
    });
    const uniqueRows = [];
    const seen = new Set();
    userRows.forEach(function(row) {
      const matricula = normalizeMatricula(row[0]);
      if (!matricula || seen.has(matricula)) return;
      seen.add(matricula);
      uniqueRows.push([
        matricula,
        String(row[1] || ''),
        normalizePin(row[2]),
        normalizeRole(row[3]),
        normalizeTurn(row[4]),
        String(row[5] || 'NAO').toUpperCase()
      ]);
    });
    if (uniqueRows.length !== userRows.length) {
      sheet.clearContents();
      sheet.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
      if (uniqueRows.length) sheet.getRange(2, 1, uniqueRows.length, USER_HEADERS.length).setValues(uniqueRows);
    }
  }
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('C:C').setNumberFormat('@');
  return sheet;
}

function getModelSheet() {
  const sheet = ensureSheet(MODEL_SHEET_NAME, MODEL_HEADERS);
  if (sheet.getLastRow() < 2) {
    sheet.getRange(2, 1, INITIAL_MODELS.length, MODEL_HEADERS.length).setValues(INITIAL_MODELS);
  }
  return sheet;
}

function getLotSheet() {
  return ensureSheet(LOT_SHEET_NAME, LOT_HEADERS);
}

function rowsAsObjects(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(function(row) {
    return row.some(function(value) { return value !== ''; });
  }).map(function(row) {
    const result = {};
    headers.forEach(function(header, index) {
      if (header) result[header] = row[index] instanceof Date ? row[index].toISOString() : row[index];
    });
    return result;
  });
}

function findUserByMatricula(matricula) {
  const normalized = normalizeMatricula(matricula);
  return listUsersInternal().find(function(user) {
    return normalizeMatricula(user.Matricula) === normalized;
  }) || null;
}

function listUsersInternal() {
  return rowsAsObjects(getUserSheet()).map(function(user) {
    user.Matricula = normalizeMatricula(user.Matricula);
    user.Nome = String(user.Nome || '').trim();
    user.PIN = normalizePin(user.PIN);
    user.Perfil = normalizeRole(user.Perfil);
    user.Turno_Vinculado = normalizeTurn(user.Turno_Vinculado);
    user.Ativo = String(user.Ativo || 'NAO').toUpperCase();
    return user;
  });
}

function publicUser(user) {
  return {
    Matricula: normalizeMatricula(user.Matricula),
    Nome: String(user.Nome || ''),
    PIN: normalizePin(user.PIN),
    Perfil: normalizeRole(user.Perfil),
    Turno_Vinculado: normalizeTurn(user.Turno_Vinculado),
    Ativo: String(user.Ativo || 'NAO').toUpperCase()
  };
}

function normalizePin(value) {
  const pin = String(value === null || value === undefined ? '' : value);
  return pin ? pin.padStart(4, '0') : '';
}

function listUsers() {
  return listUsersInternal().map(publicUser);
}

function listModels() {
  return rowsAsObjects(getModelSheet()).map(function(model) {
    return {
      Modelo_Base: String(model.Modelo_Base || ''),
      Componentes: [
        { Nome: String(model.Componente1 || ''), Meta: Number(model.Meta1) || 0 },
        { Nome: String(model.Componente2 || ''), Meta: Number(model.Meta2) || 0 },
        { Nome: String(model.Componente3 || ''), Meta: Number(model.Meta3) || 0 }
      ],
      Total_Meta: Number(model.Total_Meta) || 0
    };
  });
}

function listLots() {
  return rowsAsObjects(getLotSheet()).map(function(lot) {
    return {
      ID_Lote: String(lot.ID_Lote || ''),
      Nome_Lote: String(lot.Nome_Lote || ''),
      Modelo_Base: String(lot.Modelo_Base || ''),
      Turno_Vinculado: normalizeTurn(lot.Turno_Vinculado),
      Ativo: String(lot.Ativo || 'SIM').toUpperCase(),
      Data_Criacao: lot.Data_Criacao || ''
    };
  });
}

function listRecords() {
  return rowsAsObjects(ensureAppointmentSheet()).map(function(record) {
    HEADERS.forEach(function(header) {
      if (record[header] === undefined) record[header] = '';
    });
    return record;
  });
}

function recordDateKey(record) {
  const dateRef = String(record.Data_Ref || '');
  const dateMatch = dateRef.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateMatch) return dateMatch[0];
  const date = new Date(record.DataHora || record.Data_Ref);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function recordsInLastSevenDays(records) {
  const today = new Date();
  const cutoff = new Date(today.getTime());
  cutoff.setDate(cutoff.getDate() - 6);
  const cutoffKey = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return records.filter(function(record) {
    const key = recordDateKey(record);
    return key && key >= cutoffKey;
  });
}

function recordsForSession(session) {
  const records = recordsInLastSevenDays(listRecords());
  if (session.Perfil === 'ADMIN_GERAL') return records;
  return records.filter(function(record) {
    return turnKey(record.Turno) === turnKey(session.Turno_Vinculado);
  });
}

function lotsForSession(session) {
  return listLots().filter(function(lot) { return lot.Ativo === 'SIM'; });
}

function buildLotProgress(records, lots, models) {
  const modelMap = {};
  models.forEach(function(model) {
    modelMap[String(model.Modelo_Base).toUpperCase()] = model;
  });
  const groups = {};
  function keyFor(name, model) {
    return String(model || '').trim().toUpperCase() + '|' + String(name || '').trim().toLocaleLowerCase();
  }
  function getGroup(name, model, lot) {
    const key = keyFor(name, model);
    if (!groups[key]) {
      const definition = modelMap[String(model || '').trim().toUpperCase()];
      groups[key] = {
        ID_Lote: lot && lot.ID_Lote || '',
        Nome_Lote: String(name || '').trim(),
        Modelo_Base: String(model || '').trim(),
        Turno_Vinculado: lot && lot.Turno_Vinculado || '',
        Data_Criacao: lot && lot.Data_Criacao || '',
        Itens: (definition && definition.Componentes || []).map(function(component) {
          return {
            Componente: component.Nome,
            Meta: Number(component.Meta) || 0,
            Enviado: 0,
            Saldo: Number(component.Meta) || 0
          };
        }),
        MovidoHoje: false
      };
    } else if (lot && !groups[key].ID_Lote) {
      groups[key].ID_Lote = lot.ID_Lote || '';
      groups[key].Turno_Vinculado = lot.Turno_Vinculado || '';
      groups[key].Data_Criacao = lot.Data_Criacao || '';
    }
    return groups[key];
  }

  lots.forEach(function(lot) {
    if (lot.Ativo === 'SIM') getGroup(lot.Nome_Lote, lot.Modelo_Base, lot);
  });
  const todayKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  records.forEach(function(record) {
    const group = getGroup(record.Nome_Lote, record.Modelo_Base, null);
    if (recordDateKey(record) === todayKey) group.MovidoHoje = true;
    if (String(record.Status || '').toUpperCase() === 'ESTORNADO') return;
    const componentName = String(record.Componente || '').trim().toLocaleLowerCase();
    let item = group.Itens.find(function(candidate) {
      return String(candidate.Componente).trim().toLocaleLowerCase() === componentName;
    });
    if (!item) {
      item = { Componente: String(record.Componente || ''), Meta: 0, Enviado: 0, Saldo: 0 };
      group.Itens.push(item);
    }
    item.Enviado += Number(record.Qtd_Enviada) || 0;
  });

  return Object.keys(groups).map(function(key) {
    const group = groups[key];
    group.Itens.forEach(function(item) {
      item.Saldo = Math.max(0, item.Meta - item.Enviado);
    });
    group.Total_Meta = group.Itens.reduce(function(sum, item) { return sum + item.Meta; }, 0);
    group.Total_Enviado = group.Itens.reduce(function(sum, item) { return sum + item.Enviado; }, 0);
    group.Total_Saldo = group.Itens.reduce(function(sum, item) { return sum + item.Saldo; }, 0);
    group.Concluido = group.Total_Meta > 0 && group.Total_Saldo === 0;
    return group;
  });
}

function syncSnapshot(session) {
  const models = listModels();
  const lots = listLots();
  const allRecentRecords = recordsInLastSevenDays(listRecords());
  const snapshot = {
    ok: true,
    Cadastro_Modelos: models,
    Cadastro_Lista_Lotes: lotsForSession(session),
    TB_Apontamentos: recordsForSession(session),
    Progresso_Lotes: buildLotProgress(allRecentRecords, lots, models),
    Sessao: {
      Matricula: session.Matricula,
      Nome: session.Nome,
      Perfil: session.Perfil,
      Turno: session.Turno,
      Turno_Vinculado: session.Turno_Vinculado
    }
  };
  if (session.Perfil !== 'OPERADOR') snapshot.Config_Usuarios = usersVisibleTo(session);
  return snapshot;
}

function usersVisibleTo(session) {
  if (session.Perfil === 'ADMIN_GERAL') return listUsers();
  if (session.Perfil === 'LIDER_TURNO') {
    return listUsers().filter(function(user) {
      return user.Perfil === 'OPERADOR' &&
        turnKey(user.Turno_Vinculado) === turnKey(session.Turno_Vinculado);
    });
  }
  return [];
}

function saveUser(payload, session, token) {
  const original = normalizeMatricula(payload.Matricula_Original);
  const matricula = normalizeMatricula(payload.Matricula);
  const nome = String(payload.Nome || '').trim();
  const pin = String(payload.PIN === null || payload.PIN === undefined ? '' : payload.PIN).trim();
  let perfil = normalizeRole(payload.Perfil);
  let turno = normalizeTurn(payload.Turno_Vinculado);
  const ativo = String(payload.Ativo || '').trim().toUpperCase();
  if (!/^[A-Za-z0-9._-]{3,30}$/.test(matricula) || !nome || !/^\d{4}$/.test(pin)) {
    throw apiError('Matrícula, nome e PIN de 4 dígitos são obrigatórios.', 'INVALID_INPUT');
  }
  if (!['ADMIN_GERAL','LIDER_TURNO','OPERADOR'].includes(perfil) ||
      !['SIM','NAO'].includes(ativo)) {
    throw apiError('Perfil ou status inválido.', 'INVALID_INPUT');
  }
  if (!turno) throw apiError('Turno vinculado inválido.', 'INVALID_INPUT');

  const sheet = getUserSheet();
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1);
  let originalIndex = -1;
  let newMatriculaIndex = -1;
  rows.forEach(function(row, index) {
    const existingMatricula = normalizeMatricula(row[0]);
    if (original && existingMatricula === original) originalIndex = index;
    if (existingMatricula === matricula) newMatriculaIndex = index;
  });
  let targetIndex = -1;
  if (original) {
    if (originalIndex < 0) {
      if (newMatriculaIndex >= 0 && original !== matricula) {
        throw apiError('Matrícula já cadastrada para outro funcionário', 'DUPLICATE_MATRICULA');
      }
      throw apiError('Funcionário original não encontrado.', 'NOT_FOUND');
    }
    if (newMatriculaIndex >= 0 && originalIndex !== newMatriculaIndex) {
      throw apiError('Matrícula já cadastrada para outro funcionário', 'DUPLICATE_MATRICULA');
    }
    targetIndex = originalIndex;
  } else if (newMatriculaIndex >= 0) {
    throw apiError('Matrícula já cadastrada para outro funcionário', 'DUPLICATE_MATRICULA');
  }
  const existing = targetIndex >= 0 ? {
    Matricula: normalizeMatricula(rows[targetIndex][0]),
    Nome: String(rows[targetIndex][1] || ''),
    PIN: String(rows[targetIndex][2] === null || rows[targetIndex][2] === undefined ? '' : rows[targetIndex][2]).padStart(4, '0'),
    Perfil: normalizeRole(rows[targetIndex][3]),
    Turno_Vinculado: normalizeTurn(rows[targetIndex][4]),
    Ativo: String(rows[targetIndex][5] || 'NAO').toUpperCase()
  } : null;

  if (session.Perfil === 'LIDER_TURNO') {
    if (existing && (existing.Perfil !== 'OPERADOR' ||
        turnKey(existing.Turno_Vinculado) !== turnKey(session.Turno_Vinculado))) {
      throw apiError('Líderes só podem gerenciar operadores do próprio turno.', 'FORBIDDEN');
    }
    if (perfil !== 'OPERADOR' || turnKey(turno) !== turnKey(session.Turno_Vinculado)) {
      throw apiError('Líder só pode cadastrar operadores vinculados ao próprio turno.', 'FORBIDDEN');
    }
    perfil = 'OPERADOR';
    turno = session.Turno_Vinculado;
  } else {
    requireGeneralAdmin(session);
    if ((perfil === 'ADMIN_GERAL' && turno !== 'TODOS') ||
        (perfil !== 'ADMIN_GERAL' && !['Turno A','Turno B','Turno C'].includes(turno))) {
      throw apiError('ADMIN_GERAL deve ter turno TODOS; os demais perfis precisam de um turno.', 'INVALID_INPUT');
    }
  }

  const saved = {
    Matricula: matricula,
    Nome: nome,
    PIN: pin,
    Perfil: perfil,
    Turno_Vinculado: turno,
    Ativo: ativo
  };
  const updatedUsers = listUsersInternal();
  const savedUserIndex = existing
    ? updatedUsers.findIndex(function(user) { return user.Matricula === existing.Matricula; })
    : -1;
  if (savedUserIndex >= 0) updatedUsers[savedUserIndex] = saved;
  else updatedUsers.push(saved);
  if (!updatedUsers.some(function(user) {
    return user.Perfil === 'ADMIN_GERAL' && user.Ativo === 'SIM';
  })) {
    throw apiError('É necessário manter ao menos um ADMIN_GERAL ativo.', 'LAST_ADMIN');
  }

  const row = USER_HEADERS.map(function(header) { return saved[header]; });
  if (targetIndex >= 0) {
    sheet.getRange(targetIndex + 2, 1, 1, USER_HEADERS.length).setNumberFormat('@');
    sheet.getRange(targetIndex + 2, 1, 1, USER_HEADERS.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  sheet.getRange('A:A').setNumberFormat('@');
  sheet.getRange('C:C').setNumberFormat('@');

  let updatedSession = null;
  const isSelf = (original && original === session.Matricula) || session.Matricula === matricula;
  if (isSelf) {
    if (saved.Ativo !== 'SIM') {
      CacheService.getScriptCache().remove('session_' + token);
    } else {
      const rawSession = CacheService.getScriptCache().get('session_' + token);
      const stored = rawSession ? JSON.parse(rawSession) : {};
      const aliases = stored.MatriculasAnteriores || [];
      if (original && original !== matricula && aliases.indexOf(original) < 0) aliases.push(original);
      updatedSession = {
        Matricula: matricula,
        Nome: nome,
        Perfil: perfil,
        Turno: perfil === 'ADMIN_GERAL' ? (normalizeTurn(stored.Turno) || 'Turno A') : turno,
        Turno_Vinculado: turno,
        MatriculasAnteriores: aliases
      };
      CacheService.getScriptCache().put('session_' + token, JSON.stringify(updatedSession), SESSION_TTL_SECONDS);
    }
  }

  return {
    status: 'ok',
    mensagem: 'Usuário salvo com sucesso.',
    user: publicUser(saved),
    users: isSelf && saved.Ativo !== 'SIM'
      ? []
      : usersVisibleTo(updatedSession || session),
    session: updatedSession,
    sessionRevoked: isSelf && saved.Ativo !== 'SIM'
  };
}

function saveModel(payload) {
  const modelName = String(payload.Modelo_Base || '').trim().toUpperCase();
  const components = payload.Componentes;
  const allowed = INITIAL_MODELS.map(function(row) { return row[0]; });
  if (allowed.indexOf(modelName) === -1 || !Array.isArray(components) || components.length !== 3) {
    throw apiError('Modelo inválido. Informe exatamente 3 componentes e suas metas.', 'INVALID_INPUT');
  }
  const normalized = components.map(function(component) {
    const name = String(component.Nome || '').trim();
    const meta = Number(component.Meta);
    if (!name || !Number.isInteger(meta) || meta < 0) {
      throw apiError('Componentes devem ter nome e meta inteira não negativa.', 'INVALID_INPUT');
    }
    return { Nome: name, Meta: meta };
  });
  const total = Number(payload.Total_Meta);
  const sum = normalized.reduce(function(value, component) { return value + component.Meta; }, 0);
  if (!Number.isInteger(total) || total < 0 || total !== sum) {
    throw apiError('Total_Meta deve ser igual à soma das metas dos três componentes.', 'INVALID_INPUT');
  }
  const sheet = getModelSheet();
  const rows = sheet.getDataRange().getValues();
  let rowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase() === modelName) {
      rowNumber = i + 1;
      break;
    }
  }
  const row = [
    modelName,
    normalized[0].Nome, normalized[0].Meta,
    normalized[1].Nome, normalized[1].Meta,
    normalized[2].Nome, normalized[2].Meta,
    total
  ];
  if (rowNumber < 0) sheet.appendRow(row);
  else sheet.getRange(rowNumber, 1, 1, MODEL_HEADERS.length).setValues([row]);
  return { ok: true, model: listModels().find(function(item) { return item.Modelo_Base === modelName; }) };
}

function saveLot(payload, session) {
  const name = String(payload.Nome_Lote || '').trim();
  const rawModel = String(payload.Modelo_Base || '').trim();
  const id = String(payload.ID_Lote || '').trim();
  let turn = normalizeTurn(payload.Turno_Vinculado || payload.Turno);
  if (!id || !name || !rawModel) throw apiError('ID, nome e modelo do lote são obrigatórios.', 'INVALID_INPUT');
  if (session.Perfil !== 'ADMIN_GERAL') turn = session.Turno_Vinculado;
  if (!turn || turn === 'TODOS' || turn === 'Geral') {
    throw apiError('Turno do lote inválido.', 'INVALID_INPUT');
  }
  const foundModel = listModels().find(function(item) {
    return item.Modelo_Base.toUpperCase() === rawModel.toUpperCase();
  });
  if (!foundModel) {
    throw apiError('Modelo base não cadastrado.', 'INVALID_INPUT');
  }
  const model = foundModel.Modelo_Base;
  const sheet = getLotSheet();
  const rows = sheet.getDataRange().getValues();
  let rowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    const existingId = String(rows[i][0] || '').trim();
    const existingName = String(rows[i][1] || '').trim();
    const existingModel = String(rows[i][2] || '').trim().toUpperCase();
    if (existingId === id || (existingName.toLocaleLowerCase() === name.toLocaleLowerCase() && existingModel === model.toUpperCase())) {
      rowNumber = i + 1;
      break;
    }
  }
  const row = [id, name, model, turn, 'SIM', payload.Data_Criacao || new Date().toISOString()];
  if (rowNumber < 0) sheet.appendRow(row);
  else sheet.getRange(rowNumber, 1, 1, LOT_HEADERS.length).setValues([row]);
  return { ok: true, lot: { ID_Lote: id, Nome_Lote: name, Modelo_Base: model, Turno_Vinculado: turn, Ativo: 'SIM', Data_Criacao: row[5] } };
}

function deleteLot(payload, session) {
  const id = String(payload.ID_Lote || '').trim();
  const name = String(payload.Nome_Lote || '').trim();
  const model = String(payload.Modelo_Base || '').trim().toUpperCase();
  if (!id && (!name || !model)) {
    throw apiError('Informe o ID ou nome e modelo do lote para excluir.', 'INVALID_INPUT');
  }

  const sheet = getLotSheet();
  const values = sheet.getDataRange().getValues();
  let rowNumber = -1;
  let foundLot = null;

  for (let i = 1; i < values.length; i++) {
    const rowId = String(values[i][0] || '').trim();
    const rowName = String(values[i][1] || '').trim();
    const rowModel = String(values[i][2] || '').trim().toUpperCase();
    const rowTurn = normalizeTurn(values[i][3]);
    const matchById = id && rowId === id;
    const matchByNameModel = name && model &&
      rowName.toLocaleLowerCase() === name.toLocaleLowerCase() &&
      rowModel === model;
    if (matchById || matchByNameModel) {
      rowNumber = i + 1;
      foundLot = {
        ID_Lote: rowId,
        Nome_Lote: rowName,
        Modelo_Base: String(values[i][2] || '').trim(),
        Turno_Vinculado: rowTurn
      };
      break;
    }
  }

  if (rowNumber < 0 || !foundLot) {
    return { ok: true, deleted: false, message: 'Lote já não estava na planilha.' };
  }

  if (session.Perfil !== 'ADMIN_GERAL' &&
      foundLot.Turno_Vinculado &&
      turnKey(foundLot.Turno_Vinculado) !== turnKey(session.Turno_Vinculado)) {
    throw apiError('Você só pode excluir lotes do seu turno vinculado.', 'FORBIDDEN');
  }

  const activeRecords = listRecords().filter(function(record) {
    return String(record.Status || '').toUpperCase() !== 'ESTORNADO' &&
      String(record.Nome_Lote || '').trim().toLocaleLowerCase() === foundLot.Nome_Lote.toLocaleLowerCase() &&
      String(record.Modelo_Base || '').trim().toUpperCase() === foundLot.Modelo_Base.toUpperCase();
  });

  if (activeRecords.length > 0) {
    throw apiError(
      'Este lote possui ' + activeRecords.length + ' lançamento(s) ativo(s). Estorne os lançamentos antes de excluir o lote.',
      'LOT_HAS_RECORDS'
    );
  }

  sheet.deleteRow(rowNumber);
  return { ok: true, deleted: true, ID_Lote: foundLot.ID_Lote, Nome_Lote: foundLot.Nome_Lote };
}

function getHeaderMap(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const map = {};
  headers.forEach(function(header, index) { map[header] = index; });
  return map;
}

function appendRecord(payload, session) {
  const sheet = ensureAppointmentSheet();
  const map = getHeaderMap(sheet);
  const id = String(payload.ID_Apontamento || '').trim();
  if (!id) throw apiError('ID_Apontamento obrigatório.', 'INVALID_INPUT');
  try {
    const existing = findAppointment(sheet, id);
    return { ok: true, ID_Apontamento: id, duplicate: true, rowNumber: existing.rowNumber };
  } catch (error) {
    if (error.code !== 'NOT_FOUND') throw error;
  }
  const row = appointmentRow(payload, session, map, payload.ID_Viagem || '');
  validateTripBalances([payload], {});
  sheet.appendRow(row);
  return { ok: true, ID_Apontamento: id };
}

function appointmentRow(payload, session, map, tripId) {
  const id = String(payload.ID_Apontamento || '').trim();
  const quantity = Number(payload.Qtd_Enviada);
  if (!id || !Number.isInteger(quantity) || quantity <= 0 ||
      !String(payload.Nome_Lote || '').trim() ||
      !String(payload.Componente || '').trim()) {
    throw apiError('ID, lote, componente e quantidade válida são obrigatórios.', 'INVALID_INPUT');
  }
  const record = {};
  HEADERS.forEach(function(header) {
    record[header] = payload[header] !== undefined ? payload[header] : '';
  });
  record.Operador = session.Nome;
  const requestedTurn = session.Perfil === 'ADMIN_GERAL'
    ? normalizeTurn(payload.Turno) || session.Turno
    : session.Turno_Vinculado;
  if (!requestedTurn || requestedTurn === 'TODOS' || requestedTurn === 'Geral') {
    throw apiError('Selecione um turno específico para o lançamento.', 'INVALID_INPUT');
  }
  record.Turno = requestedTurn;
  record.Status = 'ENTREGUE';
  record.Motivo_Estorno = '';
  record[TRIP_HEADER] = String(tripId || '');
  record[AUDIT_HEADER] = '';
  record[OPERATOR_ID_HEADER] = session.Matricula;
  const row = new Array(mapWidth(map)).fill('');
  Object.keys(record).forEach(function(header) {
    if (map[header] !== undefined) row[map[header]] = record[header];
  });
  return row;
}

function mapWidth(map) {
  return Object.keys(map).reduce(function(width, header) {
    return Math.max(width, map[header] + 1);
  }, 0);
}

function createTrip(payload, session) {
  const tripId = String(payload.ID_Viagem || '').trim();
  const items = payload.itens;
  if (!tripId || !Array.isArray(items) || items.length === 0) {
    throw apiError('ID_Viagem e ao menos um item são obrigatórios.', 'INVALID_INPUT');
  }
  const sheet = ensureAppointmentSheet();
  const map = getHeaderMap(sheet);
  const existingIds = {};
  const values = sheet.getDataRange().getValues();
  const idColumn = map.ID_Apontamento;
  for (let i = 1; i < values.length; i++) {
    const existingId = String(values[i][idColumn] || '').trim();
    if (existingId) existingIds[existingId] = true;
  }
  const itemIds = {};
  const rowsToWrite = [];
  const newItems = [];
  let sharedHeader = null;
  items.forEach(function(item) {
    const id = String(item.ID_Apontamento || '').trim();
    if (!id || itemIds[id]) throw apiError('A viagem contém IDs de apontamento vazios ou repetidos.', 'INVALID_INPUT');
    itemIds[id] = true;
    const header = {
      DataHora: String(item.DataHora || ''),
      Data_Ref: String(item.Data_Ref || ''),
      Hora_Ref: String(item.Hora_Ref || ''),
      Motorista: String(item.Motorista || '').trim(),
      Frota: String(item.Frota || '').trim()
    };
    if (!header.DataHora || !header.Data_Ref || !header.Hora_Ref || !header.Motorista || !header.Frota) {
      throw apiError('A viagem exige horário, motorista e frota comuns a todos os itens.', 'INVALID_INPUT');
    }
    if (sharedHeader && Object.keys(header).some(function(key) { return header[key] !== sharedHeader[key]; })) {
      throw apiError('Os itens da viagem devem compartilhar horário, motorista e frota.', 'INVALID_INPUT');
    }
    if (!sharedHeader) sharedHeader = header;
    if (!existingIds[id]) {
      const normalizedItem = Object.assign({}, item, header, { ID_Viagem: tripId });
      rowsToWrite.push(appointmentRow(normalizedItem, session, map, tripId));
      newItems.push(normalizedItem);
    }
  });
  if (newItems.length) validateTripBalances(newItems, existingIds);
  if (rowsToWrite.length) {
    const firstRow = sheet.getLastRow() + 1;
    sheet.getRange(firstRow, 1, rowsToWrite.length, rowsToWrite[0].length).setValues(rowsToWrite);
  }
  return {
    ok: true,
    ID_Viagem: tripId,
    itensGravados: rowsToWrite.length,
    duplicate: rowsToWrite.length === 0
  };
}

function validateTripBalances(items, existingIds, currentProgress) {
  const progress = currentProgress || buildLotProgress(
    recordsInLastSevenDays(listRecords()),
    listLots(),
    listModels()
  );
  const addedByComponent = {};

  items.forEach(function(item) {
    const id = String(item.ID_Apontamento || '').trim();
    if (existingIds[id]) return;

    const name = String(item.Nome_Lote || '').trim();
    const model = String(item.Modelo_Base || '').trim();
    const componentName = String(item.Componente || '').trim();
    const quantity = Number(item.Qtd_Enviada);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw apiError('A quantidade deve ser um número inteiro maior que zero.', 'INVALID_INPUT');
    }

    const lot = progress.find(function(candidate) {
      return String(candidate.Nome_Lote || '').trim().toLocaleLowerCase() === name.toLocaleLowerCase() &&
        String(candidate.Modelo_Base || '').trim().toUpperCase() === model.toUpperCase();
    });
    const component = lot && lot.Itens.find(function(candidate) {
      return String(candidate.Componente || '').trim().toLocaleLowerCase() === componentName.toLocaleLowerCase();
    });
    if (!component || Number(component.Meta) <= 0) {
      throw apiError('Lote ou componente não encontrado no cadastro de engenharia.', 'INVALID_INPUT');
    }

    const balanceKey = JSON.stringify([model.toUpperCase(), name.toLocaleLowerCase(), componentName.toLocaleLowerCase()]);
    const alreadyAdded = addedByComponent[balanceKey] || 0;
    const available = Math.max(0, Number(component.Meta) - Number(component.Enviado) - alreadyAdded);
    if (quantity > available) {
      throw apiError(
        'Saldo insuficiente para ' + name + ' · ' + componentName + '. Disponível: ' + available + ' palete(s).',
        'BALANCE_EXCEEDED'
      );
    }
    addedByComponent[balanceKey] = alreadyAdded + quantity;
  });
}

function findAppointment(sheet, id) {
  const map = getHeaderMap(sheet);
  const idIndex = map.ID_Apontamento;
  if (idIndex === undefined) throw new Error('Coluna ID_Apontamento ausente.');
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(id)) {
      const record = {};
      Object.keys(map).forEach(function(header) { record[header] = values[i][map[header]]; });
      return { rowNumber: i + 1, record: record, map: map };
    }
  }
  throw apiError('Apontamento não encontrado.', 'NOT_FOUND');
}

function authorizeAppointmentMutation(found, session) {
  if (session.Perfil === 'ADMIN_GERAL') return;
  const recordTurn = turnKey(found.record.Turno);
  if (recordTurn !== turnKey(session.Turno_Vinculado)) {
    throw apiError('Ação restrita ao turno vinculado ao usuário.', 'FORBIDDEN');
  }
  if (session.Perfil === 'LIDER_TURNO') return;
  const ownerMatricula = String(found.record[OPERATOR_ID_HEADER] || '');
  const ownerName = String(found.record.Operador || '');
  if ((ownerMatricula && (ownerMatricula === session.Matricula ||
      (session.MatriculasAnteriores || []).indexOf(ownerMatricula) >= 0)) ||
      (!ownerMatricula && ownerName === session.Nome)) return;
  throw apiError('OPERADOR só pode alterar lançamentos próprios.', 'FORBIDDEN');
}

function appendAudit(sheet, found, text) {
  const auditColumn = found.map[AUDIT_HEADER];
  if (auditColumn === undefined) throw new Error('Coluna de auditoria ausente.');
  const previous = String(found.record[AUDIT_HEADER] || '');
  sheet.getRange(found.rowNumber, auditColumn + 1).setValue(previous ? previous + '\n' + text : text);
}

function editAppointment(payload, session) {
  const sheet = ensureAppointmentSheet();
  const found = findAppointment(sheet, payload.ID_Apontamento);
  authorizeAppointmentMutation(found, session);
  const fields = ['Nome_Lote','Modelo_Base','Componente','Qtd_Enviada','Motorista','Frota'];
  const updates = {};
  fields.forEach(function(field) {
    if (payload[field] !== undefined) updates[field] = payload[field];
  });
  if (!String(updates.Nome_Lote || '').trim() || !String(updates.Componente || '').trim()) {
    throw apiError('Lote e componente são obrigatórios.', 'INVALID_INPUT');
  }
  const quantity = Number(updates.Qtd_Enviada);
  if (!Number.isInteger(quantity) || quantity <= 0) throw apiError('Quantidade inválida.', 'INVALID_INPUT');
  Object.keys(updates).forEach(function(field) {
    const column = found.map[field];
    if (column !== undefined) sheet.getRange(found.rowNumber, column + 1).setValue(updates[field]);
  });
  const time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
  appendAudit(sheet, found, 'Editado por ' + session.Nome + ' às ' + time);
  return { ok: true, ID_Apontamento: payload.ID_Apontamento };
}

function updateStatus(payload, session) {
  const sheet = ensureAppointmentSheet();
  const found = findAppointment(sheet, payload.ID_Apontamento);
  authorizeAppointmentMutation(found, session);
  if (String(payload.Status || '') !== 'ESTORNADO') throw apiError('Status de estorno inválido.', 'INVALID_INPUT');
  const reason = String(payload.Motivo_Estorno || '').trim();
  if (!reason) throw apiError('Motivo do estorno obrigatório.', 'INVALID_INPUT');
  sheet.getRange(found.rowNumber, found.map.Status + 1).setValue('ESTORNADO');
  sheet.getRange(found.rowNumber, found.map.Motivo_Estorno + 1).setValue(reason);
  const time = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm:ss');
  appendAudit(sheet, found, 'Estornado por ' + session.Nome + ' às ' + time + ': ' + reason);
  return { ok: true, ID_Apontamento: payload.ID_Apontamento };
}

function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}