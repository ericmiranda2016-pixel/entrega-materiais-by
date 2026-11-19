const Cockpit = (() => {
  'use strict';

  let CATALOG = {
    EQE: { total: 233 },
    HA2: { total: 240 },
    'SA2/SA6': { total: 120 },
    SC3: { total: 120 },
    PBP: { total: 387 }
  };
  const el = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function localDateRef(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function normalizeDate(dateValue, dateTimeValue) {
    const raw = String(dateValue || '');
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const date = new Date(dateTimeValue || dateValue);
    return Number.isNaN(date.getTime()) ? '' : localDateRef(date);
  }

  function modelKey(model) {
    const normalized = String(model || '').trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'SA2' || normalized === 'SA6' || normalized === 'SA2/SA6') return 'SA2/SA6';
    return Object.keys(CATALOG).find((key) => key.toUpperCase() === normalized) || '';
  }

  function applyModels(models) {
    if (!Array.isArray(models)) return;
    const updated = {};
    models.forEach((model) => {
      const key = modelKey(model.Modelo_Base);
      const total = Number(model.Total_Meta);
      if (key && Number.isFinite(total) && total >= 0) updated[key] = { total };
    });
    if (Object.keys(updated).length) CATALOG = { ...CATALOG, ...updated };
  }

  function shiftMatches(recordShift, selectedShift) {
    if (!selectedShift || selectedShift === 'Geral') return true;
    return String(recordShift || '').replace(/^Turno\s+/i, '').toUpperCase() ===
      String(selectedShift).replace(/^Turno\s+/i, '').toUpperCase();
  }

  function shiftKey(value) {
    const shift = String(value || '').replace(/^Turno\s+/i, '').toUpperCase();
    return shift || 'A';
  }

  function formatDate(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
  }

  function formatPercent(value) {
    return `${Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  function uniqueRecords(records) {
    const ids = new Set();
    return records.filter((record) => {
      const id = record.ID_Apontamento;
      if (!id) return true;
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    });
  }

  function buildReportData(records, context) {
    const today = localDateRef();
    const dayRecords = uniqueRecords(records).filter((record) =>
      normalizeDate(record.Data_Ref, record.DataHora) === today &&
      shiftMatches(record.Turno, context.shift)
    );
    const activeRecords = dayRecords.filter((record) => record.Status !== 'ESTORNADO');
    const groups = new Map();
    const plannedKeys = new Set();

    function lotKey(name, model) {
      return `${modelKey(model) || String(model || '').toUpperCase()}|${String(name || '').trim().toLocaleLowerCase('pt-BR')}`;
    }

    function ensureGroup(name, model, shift) {
      const safeName = String(name || 'Lote sem identificação').trim();
      const safeModel = modelKey(model);
      const key = lotKey(safeName, safeModel || model);
      if (!groups.has(key)) {
        groups.set(key, {
          name: safeName,
          model: String(model || '').trim(),
          shift: shiftKey(shift),
          meta: safeModel ? CATALOG[safeModel].total : 0,
          sent: 0,
          balance: 0,
          movedToday: false
        });
      }
      return groups.get(key);
    }

    dayRecords.forEach((record) => {
      const group = ensureGroup(record.Nome_Lote, record.Modelo_Base, record.Turno);
      if (record.Status !== 'ESTORNADO') {
        group.sent += Number(record.Qtd_Enviada) || 0;
        group.movedToday = true;
        plannedKeys.add(lotKey(record.Nome_Lote, record.Modelo_Base));
      }
    });

    (Array.isArray(context.progressLots) ? context.progressLots : []).forEach((progress) => {
      const group = ensureGroup(progress.Nome_Lote, progress.Modelo_Base, progress.Turno_Vinculado);
      group.meta = Number(progress.Total_Meta) || group.meta;
      group.sent = Number(progress.Total_Enviado) || 0;
      group.balance = Number(progress.Total_Saldo) || 0;
      group.movedToday = Boolean(progress.MovidoHoje);
      if (group.balance > 0 || group.movedToday) group.continuityVisible = true;
    });

    (Array.isArray(context.activeLots) ? context.activeLots : []).forEach((lot) => {
      if (normalizeDate(lot.createdAt, lot.createdAt) !== today || !shiftMatches(lot.shift, context.shift)) return;
      const key = lotKey(lot.name, lot.model);
      ensureGroup(lot.name, lot.model, lot.shift);
      plannedKeys.add(key);
    });

    const lots = [...groups.values()]
      .filter((lot) => lot.continuityVisible || lot.movedToday)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    lots.forEach((lot) => {
      if (lot.balance === 0 && !lot.continuityVisible) lot.balance = Math.max(0, lot.meta - lot.sent);
      lot.percent = lot.meta > 0 ? Math.min(100, (lot.sent / lot.meta) * 100) : 0;
      lot.completed = lot.meta > 0 && lot.balance === 0;
    });

    const totalPlanned = [...plannedKeys].reduce((sum, key) => sum + (groups.get(key)?.meta || 0), 0);
    const totalSent = activeRecords.reduce((sum, record) => sum + (Number(record.Qtd_Enviada) || 0), 0);
    const progressRows = Array.isArray(context.progressLots) ? context.progressLots : [];
    const totalBalance = progressRows.length
      ? progressRows.reduce((sum, lot) => sum + (Number(lot.Total_Saldo) || 0), 0)
      : Math.max(0, totalPlanned - totalSent);
    const completed = lots.filter((lot) => lot.completed).length;
    const pendingLots = progressRows.length
      ? progressRows.filter((lot) => !lot.Concluido && Number(lot.Total_Saldo) > 0).length
      : lots.filter((lot) => lot.balance > 0).length;
    const progress = totalPlanned > 0 ? Math.min(100, (totalSent / totalPlanned) * 100) : 0;
    const activeHours = new Set();
    activeRecords.forEach((record) => {
      const time = String(record.Hora_Ref || '');
      const hour = time.match(/^(\d{2}):/)?.[1];
      if (hour) activeHours.add(hour);
    });
    const rate = activeHours.size ? totalSent / activeHours.size : 0;
    return {
      date: new Date(),
      lots,
      totalPlanned,
      totalSent,
      totalBalance,
      completed,
      pendingLots,
      progress,
      rate,
      activeHours: activeHours.size
    };
  }

  function automaticNotes(data) {
    const percent = formatPercent(data.progress);
    return [
      `Atingido: ${percent} do programado (${data.totalSent} de ${data.totalPlanned} paletes).`,
      `Lotes concluídos: ${data.completed} de ${data.lots.length}.`,
      `Lotes com saldo pendente: ${data.pendingLots} (${data.totalBalance} paletes).`,
      '',
      `达成率：${percent}（已发运 ${data.totalSent} / 计划 ${data.totalPlanned} 托盘）。`,
      `已完成批次：${data.completed} / ${data.lots.length}。`,
      `待发批次：${data.pendingLots}，总待发余额：${data.totalBalance} 托盘。`
    ].join('\n');
  }

  function notesKey(context) {
    const shift = String(context.shift || 'Geral').replace(/\s+/g, '-');
    return `byd_cockpit_notes_v1_${localDateRef()}_${shift}`;
  }

  function updateNotesPreview() {
    el('observationText').textContent = el('operatorNotes').value;
  }

  function renderGovernance(context, date) {
    const shift = String(context.shift || 'Geral').replace(/^Turno\s+/i, '');
    const items = [
      ['◷', 'DATA', formatDate(date)],
      ['♙', 'COORDENADOR', context.coordinator || 'Anderson Andrade'],
      ['♧', 'LIDERANÇA', context.leadership || 'Daniela Menezes'],
      ['♟', 'RESPONSÁVEL', context.operator || 'Eric Miranda'],
      ['◉', 'TURNO / 班次', shift || 'Geral']
    ];
    el('governanceGrid').innerHTML = items.map(([icon, label, value]) => `
      <div class="governance-pill">
        <span class="governance-label">${icon} &nbsp; ${escapeHtml(label)}</span>
        <span class="governance-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span>
      </div>`).join('');
  }

  function renderKpis(data) {
    const cards = [
      ['programmed', 'TOTAL PALETES PROGRAMADOS', '计划总托盘数', data.totalPlanned, 'Paletes / 托盘'],
      ['sent', 'ENVIADO PARA O PISO', '已发运至产线', data.totalSent, 'Paletes / 托盘'],
      ['balance', 'SALDO PENDENTE GERAL', '总待发余额', data.totalBalance, 'Paletes / 托盘'],
      ['completed', 'LOTES CONCLUÍDOS', '已完成批次', `${data.completed} de ${data.lots.length}`, 'Lotes / 批次'],
      ['progress', 'PROGRESSO GERAL', '总体进度', formatPercent(data.progress), ''],
      ['rate', 'PALETES / HORA', '每小时发运', data.rate.toLocaleString('pt-BR', { maximumFractionDigits: 1 }), 'Paletes / 小时']
    ];
    el('kpiGrid').innerHTML = cards.map(([tone, title, chinese, value, unit]) => `
      <article class="kpi-card ${tone}">
        <p class="kpi-label">${title}<span>${chinese}</span></p>
        <strong class="kpi-value">${escapeHtml(String(value))}</strong>
        ${unit ? `<span class="kpi-unit">${unit}</span>` : ''}
      </article>`).join('');
  }

  function renderLots(lots, showShift) {
    const body = el('lotTable');
    if (!lots.length) {
      body.innerHTML = '<tr><td colspan="7" style="padding:18px;text-align:center;color:#94A3B8">Nenhum lote encontrado para o dia e turno selecionados.</td></tr>';
      return;
    }
    body.innerHTML = lots.map((lot, index) => {
      const status = lot.completed
        ? '<span class="report-status done">CONCLUÍDO / 已完成</span>'
        : lot.meta > 0
          ? '<span class="report-status running">EM ANDAMENTO / 进行中</span>'
          : '<span class="report-status no-target">META NÃO DEFINIDA</span>';
      return `<tr>
        <td class="table-number">${String(index + 1).padStart(2, '0')}</td>
        <td><strong>${escapeHtml(lot.name)}${showShift ? ` · Turno ${escapeHtml(lot.shift)}` : ''}</strong><br><span style="color:#94A3B8;font-size:8px">${escapeHtml(lot.model || '')}</span></td>
        <td>${lot.meta}</td>
        <td>${lot.sent}</td>
        <td>${lot.balance}</td>
        <td>${formatPercent(lot.percent)}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
  }

  function renderReport(records, context) {
    const data = buildReportData(records, context);
    renderGovernance(context, data.date);
    renderKpis(data);
    renderLots(data.lots, context.shift === 'Geral');

    const notesInput = el('operatorNotes');
    const key = notesKey(context);
    if (notesInput.dataset.notesKey !== key) {
      notesInput.dataset.notesKey = key;
      const saved = localStorage.getItem(key);
      notesInput.value = saved === null ? automaticNotes(data) : saved;
      notesInput.dataset.manual = saved === null ? 'false' : 'true';
    } else if (notesInput.dataset.manual !== 'true') {
      notesInput.value = automaticNotes(data);
    }
    updateNotesPreview();
    el('reportGeneratedAt').textContent = `Gerado em ${new Date().toLocaleString('pt-BR')}`;
    return data;
  }

  function downloadFile(file, filename) {
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem PNG.')), 'image/png');
    });
  }

  async function exportReport() {
    const session = DB.getSession();
    if (!session || !['ADMIN_GERAL','LIDER_TURNO'].includes(session.Perfil)) {
      alert('Somente ADMIN_GERAL ou LIDER_TURNO pode exportar o relatório.');
      return;
    }
    const buttons = [el('exportPngButton'), el('exportShareButton')];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      if (!window.html2canvas) throw new Error('html2canvas não está disponível. Verifique a conexão e tente novamente.');
      const report = el('cockpitContent');
      const canvas = await html2canvas(report, {
        scale: 2,
        backgroundColor: '#0B1324',
        useCORS: true,
        width: report.scrollWidth,
        windowWidth: Math.max(document.documentElement.clientWidth, report.scrollWidth),
        scrollX: 0,
        scrollY: 0
      });
      const blob = await canvasToBlob(canvas);
      const date = localDateRef().replace(/-/g, '');
      const file = new File([blob], `cockpit-byd-${date}.png`, { type: 'image/png', lastModified: Date.now() });
      const shareData = { files: [file], title: 'Relatório diário de expedição BYD', text: 'Cockpit Logístico - Entrega de Materiais' };
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share(shareData);
          return;
        } catch (error) {
          if (error.name === 'AbortError') return;
        }
      }
      downloadFile(file, file.name);
    } catch (error) {
      alert(error.message || 'Falha ao exportar o relatório.');
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function update(records, context = {}) {
    if (!Array.isArray(records)) records = [];
    applyModels(context.models);
    const canManageReport = ['ADMIN_GERAL','LIDER_TURNO'].includes(context.profile);
    el('operatorNotes').disabled = !canManageReport;
    el('resetNotesButton').hidden = !canManageReport;
    el('exportPngButton').hidden = !canManageReport;
    el('exportShareButton').hidden = !canManageReport;
    renderReport(records, {
      operator: context.operator || 'Eric Miranda',
      shift: context.shift || 'Geral',
      coordinator: context.coordinator || 'Anderson Andrade',
      leadership: context.leadership || 'Daniela Menezes',
      activeLots: Array.isArray(context.activeLots) ? context.activeLots : [],
      progressLots: Array.isArray(context.progressLots) ? context.progressLots : [],
      models: Array.isArray(context.models) ? context.models : [],
      profile: context.profile || 'OPERADOR'
    });
  }

  el('operatorNotes').addEventListener('input', () => {
    const input = el('operatorNotes');
    input.dataset.manual = 'true';
    if (input.dataset.notesKey) localStorage.setItem(input.dataset.notesKey, input.value);
    updateNotesPreview();
  });
  el('resetNotesButton').addEventListener('click', () => {
    const input = el('operatorNotes');
    if (input.dataset.notesKey) localStorage.removeItem(input.dataset.notesKey);
    input.dataset.manual = 'false';
    update(input._records || [], input._context || {});
  });
  el('exportPngButton').addEventListener('click', exportReport);
  el('exportShareButton').addEventListener('click', exportReport);

  const originalUpdate = update;
  function updateWithState(records, context = {}) {
    el('operatorNotes')._records = records;
    el('operatorNotes')._context = context;
    originalUpdate(records, context);
  }

  return { update: updateWithState };
})();
