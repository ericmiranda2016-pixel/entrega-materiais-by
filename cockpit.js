const Cockpit = (() => {
  'use strict';

  let lastRecords = [];
  let lastContext = {};
  let listenersAttached = false;

  const el = (id) => document.getElementById(id);

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

  function todayIso() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function normalizeDate(dateValue, dateTimeValue) {
    const match = String(dateValue || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(dateTimeValue || dateValue);
    if (Number.isNaN(parsed.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  function formatDateBr(isoDate) {
    const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDate;
  }

  function formatTime(record) {
    const raw = String(record.Hora_Ref || '').trim();
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 5 ? `${raw}:00` : raw.slice(0, 8);
    const parsed = new Date(record.DataHora);
    if (Number.isNaN(parsed.getTime())) return '--:--:--';
    return [parsed.getHours(), parsed.getMinutes(), parsed.getSeconds()]
      .map((n) => String(n).padStart(2, '0')).join(':');
  }

  function turnKey(value) {
    return String(value || '').replace(/^Turno\s+/i, '').trim().toUpperCase();
  }

  function shiftToChinese(shift) {
    const key = turnKey(shift);
    if (key === 'A') return 'A班 (Turno A)';
    if (key === 'B') return 'B班 (Turno B)';
    if (key === 'C') return 'C班 (Turno C)';
    return '全部班次 (Todos os Turnos)';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    textarea.remove();
    return ok;
  }

  function ensureControls(context) {
    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    const copyBtn = el('copyChineseReportButton');

    if (dateInput && !dateInput.value) {
      dateInput.value = todayIso();
    }

    if (shiftSelect) {
      const isLeader = String(context.profile || '').toUpperCase() === 'LIDER_TURNO';
      if (isLeader && context.shift && context.shift !== 'Geral') {
        shiftSelect.value = context.shift;
        shiftSelect.disabled = true;
      } else {
        shiftSelect.disabled = false;
      }
    }

    if (!listenersAttached) {
      listenersAttached = true;
      if (dateInput) dateInput.addEventListener('change', () => render());
      if (shiftSelect) shiftSelect.addEventListener('change', () => render());
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const box = el('cockpitBilingualCard');
          if (!box || !box.textContent.trim()) return;
          const copied = await copyText(box.textContent);
          const originalLabel = copyBtn.textContent;
          copyBtn.textContent = copied ? '✓ Relatório Copiado!' : '⚠️ Falha ao copiar';
          setTimeout(() => { copyBtn.textContent = originalLabel; }, 2200);
        });
      }
    }
  }

  function renderHeader(context, selectedDate, selectedShift) {
    const metaEl = el('cockpitHeaderMeta');
    if (!metaEl) return;
    const coord = context.coordinator || 'Anderson Andrade';
    const leader = context.leadership || 'Daniela Menezes';
    const shiftText = selectedShift === 'ALL' ? 'Todos os Turnos' : selectedShift;
    metaEl.textContent = `Setor: Entrega de Materiais · Coordenador: ${coord} · Liderança: ${leader} · Filtro: ${formatDateBr(selectedDate)} (${shiftText})`;
  }

  function renderKpis(validRecords, voidedRecords, lots) {
    const grid = el('cockpitKpiGrid');
    if (!grid) return;

    const totalPallets = validRecords.reduce((sum, r) => sum + (Number(r.Qtd_Enviada) || 0), 0);
    const uniqueTrips = new Set(
      validRecords.map((r) => r.ID_Viagem || `${r.Data_Ref}|${r.Hora_Ref}|${r.Motorista}|${r.Frota}`)
    ).size;

    const totalMeta = lots.reduce((sum, l) => sum + (Number(l.Total_Meta) || 0), 0);
    const totalSentLots = lots.reduce((sum, l) => sum + (Number(l.Total_Enviado) || 0), 0);
    const pendingLotsCount = lots.filter((l) => !l.Concluido).length;
    const avgProgress = totalMeta > 0 ? Math.min(100, Math.round((totalSentLots / totalMeta) * 100)) : 0;

    const voidedPallets = voidedRecords.reduce((sum, r) => sum + (Number(r.Qtd_Enviada) || 0), 0);

    grid.innerHTML = `
      <article class="kpi-card">
        <div class="kpi-label">Paletes Entregues</div>
        <div class="kpi-value">${totalPallets}</div>
        <div class="kpi-sub">${validRecords.length} apontamento(s) ativo(s)</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Viagens Realizadas</div>
        <div class="kpi-value">${uniqueTrips}</div>
        <div class="kpi-sub">Média ${uniqueTrips ? (totalPallets / uniqueTrips).toFixed(1) : '0.0'} paletes/viagem</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Lotes no Pátio</div>
        <div class="kpi-value">${pendingLotsCount}</div>
        <div class="kpi-sub">Avanço geral dos lotes: ${avgProgress}%</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Estornos</div>
        <div class="kpi-value" style="color:var(--danger-text)">${voidedRecords.length}</div>
        <div class="kpi-sub">${voidedPallets} palete(s) estornado(s)</div>
      </article>
    `;
  }

  function renderLotsProgress(lots) {
    const container = el('cockpitLotsGrid');
    if (!container) return;

    if (!lots.length) {
      container.innerHTML = '<div class="empty-state">Nenhum lote cadastrado ou movimentado para este turno.</div>';
      return;
    }

    container.innerHTML = lots.map((lot) => {
      const meta = Number(lot.Total_Meta) || 0;
      const sent = Number(lot.Total_Enviado) || 0;
      const balance = Math.max(0, meta - sent);
      const pct = meta > 0 ? Math.min(100, Math.round((sent / meta) * 100)) : 0;
      const done = Boolean(lot.Concluido) || (meta > 0 && sent >= meta);
      const items = Array.isArray(lot.Itens) ? lot.Itens : [];

      return `
        <article class="pending-lot">
          <div class="history-top" style="align-items:center;margin-bottom:6px">
            <h4 class="pending-lot-title" style="margin:0">
              ${escapeHtml(lot.Nome_Lote)} · ${escapeHtml(lot.Modelo_Base)}
              ${lot.Turno_Vinculado ? `<span class="muted-small">(${escapeHtml(lot.Turno_Vinculado)})</span>` : ''}
            </h4>
            <span class="status-tag ${done ? 'ok' : ''}" style="${done ? '' : 'background:var(--byd-cyan-soft);color:var(--byd-cyan-text)'}">
              ${done ? 'CONCLUÍDO · 100%' : `${pct}% · FALTAM ${balance}`}
            </span>
          </div>

          <div class="pending-component-meta" style="margin-bottom:5px">
            <span>Entregue: ${sent} / ${meta} paletes</span>
            <span>Saldo: ${balance} paletes</span>
          </div>
          <div class="pending-track" style="margin-bottom:8px">
            <span style="width:${pct}%"></span>
          </div>

          <div class="meta-row" style="margin-top:4px">
            ${items.map((item) => `
              <span class="meta-badge">
                ${escapeHtml(item.Componente)}: <strong>${Number(item.Enviado) || 0}/${Number(item.Meta) || 0}</strong>
              </span>
            `).join('')}
          </div>
        </article>
      `;
    }).join('');
  }

  function renderModelsVolume(validRecords) {
    const container = el('cockpitModelsGrid');
    if (!container) return;

    const map = new Map();
    validRecords.forEach((r) => {
      const model = String(r.Modelo_Base || 'OUTROS').trim();
      map.set(model, (map.get(model) || 0) + (Number(r.Qtd_Enviada) || 0));
    });

    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, qty]) => sum + qty, 0);

    if (!entries.length) {
      container.innerHTML = '<div class="empty-state">Sem movimentação por modelo na data/turno selecionados.</div>';
      return;
    }

    container.innerHTML = entries.map(([model, qty]) => {
      const pct = total > 0 ? Math.round((qty / total) * 100) : 0;
      return `
        <div class="pending-lot" style="padding:10px 12px">
          <div class="pending-component-meta" style="margin-bottom:6px">
            <span><strong>${escapeHtml(model)}</strong></span>
            <span>${qty} paletes (${pct}%)</span>
          </div>
          <div class="pending-track">
            <span style="width:${pct}%"></span>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderDriversProductivity(validRecords) {
    const container = el('cockpitDriversList');
    if (!container) return;

    const byDriver = new Map();
    validRecords.forEach((r) => {
      const name = String(r.Motorista || 'NÃO INFORMADO').trim().toUpperCase();
      if (!byDriver.has(name)) {
        byDriver.set(name, { name, pallets: 0, trips: new Set(), fleets: new Set() });
      }
      const entry = byDriver.get(name);
      entry.pallets += Number(r.Qtd_Enviada) || 0;
      entry.trips.add(r.ID_Viagem || `${r.Data_Ref}|${r.Hora_Ref}|${r.Frota}`);
      if (r.Frota) entry.fleets.add(String(r.Frota).trim().toUpperCase());
    });

    const list = [...byDriver.values()].sort((a, b) => b.pallets - a.pallets);
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">Nenhuma entrega registrada por motorista neste filtro.</div>';
      return;
    }

    container.innerHTML = list.map((item, idx) => `
      <div class="user-row">
        <div>
          <div class="user-name">#${idx + 1} · ${escapeHtml(item.name)}</div>
          <div class="user-detail">
            ${item.trips.size} viagem(ns) · Frota(s): ${escapeHtml([...item.fleets].join(', ') || '—')}
          </div>
        </div>
        <div class="history-qty">${item.pallets} paletes</div>
      </div>
    `).join('');
  }

  function renderBilingualSummary(context, selectedDate, selectedShift, validRecords, voidedRecords, lots) {
    const box = el('cockpitBilingualCard');
    if (!box) return;

    const coord = context.coordinator || 'Anderson Andrade';
    const leader = context.leadership || 'Daniela Menezes';
    const totalPallets = validRecords.reduce((sum, r) => sum + (Number(r.Qtd_Enviada) || 0), 0);
    const uniqueTrips = new Set(
      validRecords.map((r) => r.ID_Viagem || `${r.Data_Ref}|${r.Hora_Ref}|${r.Motorista}|${r.Frota}`)
    ).size;

    const modelMap = new Map();
    validRecords.forEach((r) => {
      const m = String(r.Modelo_Base || 'OUTROS').trim();
      modelMap.set(m, (modelMap.get(m) || 0) + (Number(r.Qtd_Enviada) || 0));
    });
    const modelLines = modelMap.size
      ? [...modelMap.entries()].sort((a, b) => b[1] - a[1]).map(([m, q]) => `• ${m}: ${q} paletes (托盘)`).join('\n')
      : '• Sem movimentação / 暂无配送记录';

    const lotLines = lots.length
      ? lots.map((l) => {
          const sent = Number(l.Total_Enviado) || 0;
          const meta = Number(l.Total_Meta) || 0;
          const pct = meta > 0 ? Math.min(100, Math.round((sent / meta) * 100)) : 0;
          const statusZh = sent >= meta && meta > 0 ? '已完成' : '进行中';
          return `• ${l.Nome_Lote} [${l.Modelo_Base}]: ${sent}/${meta} (${pct}% · ${statusZh})`;
        }).join('\n')
      : '• Nenhum lote ativo / 暂无活跃批次';

    box.textContent = [
      '📊 BYD AUTO BRASIL · ENTREGA DE MATERIAIS / 物料配送日报',
      `📅 Data / 日期: ${formatDateBr(selectedDate)}`,
      `🕒 Turno / 班次: ${shiftToChinese(selectedShift)}`,
      `👔 Coordenador / 协调员: ${coord} | Liderança / 班长: ${leader}`,
      '--------------------------------------------------',
      `📦 Total Entregue / 总配送托盘数: ${totalPallets} paletes`,
      `🚛 Viagens / 总运输趟次: ${uniqueTrips} | Estornos / 冲销: ${voidedRecords.length}`,
      '',
      '🚗 VOLUME POR MODELO / 按车型统计:',
      modelLines,
      '',
      '📋 STATUS DOS LOTES / 批次进度:',
      lotLines
    ].join('\n');
  }

  function renderAuditTable(filteredRecords) {
    const tbody = el('cockpitTableBody');
    if (!tbody) return;

    if (!filteredRecords.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px">Nenhum lançamento encontrado para esta data/turno.</td></tr>';
      return;
    }

    const sorted = filteredRecords.slice().sort((a, b) =>
      String(b.DataHora || '').localeCompare(String(a.DataHora || ''))
    );

    tbody.innerHTML = sorted.map((r) => {
      const voided = String(r.Status || '').toUpperCase() === 'ESTORNADO';
      return `
        <tr>
          <td>${escapeHtml(formatTime(r))}</td>
          <td>${escapeHtml(r.Turno || '')}</td>
          <td>
            <strong>${escapeHtml(r.Nome_Lote || '')}</strong> · ${escapeHtml(r.Componente || '')}
            ${voided && r.Motivo_Estorno ? `<div class="muted-small" style="color:var(--danger-text)">Motivo: ${escapeHtml(r.Motivo_Estorno)}</div>` : ''}
          </td>
          <td><strong>${Number(r.Qtd_Enviada) || 0}</strong></td>
          <td>${escapeHtml(r.Motorista || '')} · ${escapeHtml(r.Frota || '')}</td>
          <td>${escapeHtml(r.Operador || '')}</td>
          <td><span class="status-tag ${voided ? 'void' : 'ok'}">${voided ? 'ESTORNADO' : 'ENTREGUE'}</span></td>
        </tr>
      `;
    }).join('');
  }

  function render() {
    const dateInput = el('cockpitDateFilter');
    const shiftSelect = el('cockpitShiftFilter');
    const selectedDate = (dateInput && dateInput.value) || todayIso();
    const selectedShift = (shiftSelect && shiftSelect.value) || 'ALL';

    const filteredRecords = lastRecords.filter((r) => {
      const sameDate = normalizeDate(r.Data_Ref, r.DataHora) === selectedDate;
      const sameShift = selectedShift === 'ALL' || turnKey(r.Turno) === turnKey(selectedShift);
      return sameDate && sameShift;
    });

    const validRecords = filteredRecords.filter((r) => String(r.Status || '').toUpperCase() !== 'ESTORNADO');
    const voidedRecords = filteredRecords.filter((r) => String(r.Status || '').toUpperCase() === 'ESTORNADO');

    const allLots = Array.isArray(lastContext.progressLots) ? lastContext.progressLots : [];
    const filteredLots = selectedShift === 'ALL'
      ? allLots
      : allLots.filter((l) => !l.Turno_Vinculado || turnKey(l.Turno_Vinculado) === turnKey(selectedShift));

    renderHeader(lastContext, selectedDate, selectedShift);
    renderKpis(validRecords, voidedRecords, filteredLots);
    renderLotsProgress(filteredLots);
    renderModelsVolume(validRecords);
    renderDriversProductivity(validRecords);
    renderBilingualSummary(lastContext, selectedDate, selectedShift, validRecords, voidedRecords, filteredLots);
    renderAuditTable(filteredRecords);
  }

  function update(records = [], context = {}) {
    lastRecords = Array.isArray(records) ? records : [];
    lastContext = context || {};
    ensureControls(lastContext);
    render();
  }

  return { update };
})();